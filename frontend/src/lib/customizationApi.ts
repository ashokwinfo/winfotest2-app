/**
 * Customization API seam.
 *
 * Today: thin wrappers over the in-memory mock stores in `src/data/mock.ts`.
 * Tomorrow: swap each function body for a real `fetch(...)` call. Callers
 * should never touch `clientOverrides` / `clientTombstones` / `clientRepos`
 * / `publishHistory` directly — they go through this module.
 */
import type {
  TestCaseOverride, TestCaseTombstone, PublishPreview, PublishRecord, CaseDiffEntry,
} from '@/types';
import {
  clientOverrides,
  clientTombstones,
  clientRepos,
  testCases as masterCases,
  publishHistory,
  appendPublishRecord,
  diffRepo,
  customizeCase as mockCustomize,
  revertCase as mockRevert,
  deleteInheritedCase as mockDeleteInherited,
  snapshotClientState,
  restorePublishSnapshot,
  removePublishRecord,
} from '@/data/mock';

export interface ClientCustomizationsSnapshot {
  overrides: TestCaseOverride[];
  tombstones: TestCaseTombstone[];
}

export type CustomizationChange =
  | { kind: 'customize'; masterCaseId: string }
  | { kind: 'revert'; caseId: string }
  | { kind: 'delete-inherited'; masterCaseId: string };

/** Pull the full set of customizations for a client. */
export async function fetchClientCustomizations(
  clientId: string,
): Promise<ClientCustomizationsSnapshot> {
  return {
    overrides: clientOverrides[clientId] ?? [],
    tombstones: clientTombstones[clientId] ?? [],
  };
}

/** Push a single customization change. Returns the resulting override (if any). */
export async function pushCustomization(
  clientId: string,
  change: CustomizationChange,
): Promise<TestCaseOverride | undefined> {
  switch (change.kind) {
    case 'customize':
      return mockCustomize(clientId, change.masterCaseId);
    case 'revert':
      mockRevert(clientId, change.caseId);
      return undefined;
    case 'delete-inherited':
      mockDeleteInherited(clientId, change.masterCaseId);
      return undefined;
  }
}

/**
 * Compute what a publish from master to a single client *would* do, without
 * applying it. The admin sees this in the preview step.
 *
 * Semantics for the demo:
 *  - "Added"     = master cases not visible in the client (would appear after publish).
 *                  In our mock model, all uncustomized master cases ARE already
 *                  inherited live, so we approximate "added since last publish"
 *                  as cases whose `version` is greater than the client's
 *                  current `baselineVersion` and that the client has NOT
 *                  customized or tombstoned. For the seed data where master
 *                  versions == 1, this falls back to zero — which still
 *                  correctly conveys "no pending master changes".
 *  - "Removed"   = master tombstones the client tombstoned the same case for.
 *                  We approximate as zero in the demo since we never actually
 *                  remove master cases. (Hook left for real backend.)
 *  - "Protected" = client overrides whose origin master case has advanced.
 *                  These are skipped — the client keeps their custom version.
 */
export async function previewPublish(clientId: string): Promise<PublishPreview> {
  const repo = clientRepos.find(c => c.id === clientId);
  if (!repo) throw new Error(`Unknown client repo: ${clientId}`);

  const overrides = clientOverrides[clientId] ?? [];
  const tombstones = new Set((clientTombstones[clientId] ?? []).map(t => t.originCaseId));
  const overrideOrigins = new Set(overrides.map(o => o.originCaseId).filter(Boolean) as string[]);

  // 1) Added: master cases newer than the client's baseline that the client
  //    has neither customized nor tombstoned.
  const added: CaseDiffEntry[] = [];
  for (const m of masterCases) {
    const v = m.version ?? 1;
    if (v <= repo.baselineVersion) continue;
    if (overrideOrigins.has(m.id)) continue;
    if (tombstones.has(m.id)) continue;
    added.push({
      status: 'new',
      caseNumber: m.caseNumber,
      testCaseName: m.testCaseName,
      rowId: m.id,
      masterCase: m,
    });
  }

  // 2) Removed: in this mock, master cases never get hard-deleted, so this is
  //    always empty. Real backend will diff master snapshots.
  const removed: CaseDiffEntry[] = [];

  // 3) Protected: customized cases whose master version moved.
  const protectedItems: CaseDiffEntry[] = [];
  const driftAfter: CaseDiffEntry[] = [];
  for (const o of overrides) {
    if (!o.originCaseId) continue;
    const master = masterCases.find(tc => tc.id === o.originCaseId);
    if (!master) continue;
    const masterV = master.version ?? 1;
    const originV = o.originVersion ?? 1;
    if (masterV > originV) {
      const entry: CaseDiffEntry = {
        status: 'modified',
        caseNumber: master.caseNumber,
        testCaseName: o.testCase.testCaseName,
        rowId: master.id,
        masterCase: master,
        clientCase: o.testCase,
        driftFromMaster: true,
      };
      protectedItems.push(entry);
      driftAfter.push(entry);
    }
  }

  return {
    clientRepoId: clientId,
    clientName: repo.name,
    added,
    removed,
    protected: protectedItems,
    driftAfter,
  };
}

/**
 * Apply the publish: bump the client baseline and append a record to history.
 * Customized cases are preserved (we never touch `clientOverrides`).
 */
export async function publishMasterToClient(
  clientId: string,
  by = 'you',
): Promise<{ baselineVersion: number; record: PublishRecord }> {
  const repo = clientRepos.find(c => c.id === clientId);
  if (!repo) throw new Error(`Unknown client repo: ${clientId}`);

  const preview = await previewPublish(clientId);
  const fromBaseline = repo.baselineVersion;
  // Snapshot overrides/tombstones/baseline so we can roll back.
  const snapToken = snapshotClientState(clientId);

  // Bump baseline to the highest master version we know about (so subsequent
  // previews stop showing the same "added" rows).
  const targetVersion = Math.max(
    repo.baselineVersion + 1,
    ...masterCases.map(m => m.version ?? 1),
  );
  repo.baselineVersion = targetVersion;

  const slim = (e: CaseDiffEntry) => ({
    caseNumber: e.caseNumber,
    testCaseName: e.testCaseName,
  });
  const record: PublishRecord = {
    id: `ph-${Date.now()}-${clientId}`,
    clientRepoId: clientId,
    clientName: repo.name,
    fromBaselineVersion: fromBaseline,
    toBaselineVersion: targetVersion,
    added: preview.added.length,
    removed: preview.removed.length,
    protectedCount: preview.protected.length,
    at: new Date().toISOString(),
    by,
    changelog: {
      added: preview.added.map(slim),
      removed: preview.removed.map(slim),
      protected: preview.protected.map(slim),
    },
    prevSnapshotToken: snapToken,
  };
  appendPublishRecord(record);

  return { baselineVersion: targetVersion, record };
}

/**
 * Roll back a previous publish: restore overrides/tombstones/baseline from the
 * snapshot captured at publish time, and remove the history entry.
 */
export async function rollbackPublish(recordId: string): Promise<boolean> {
  const rec = publishHistory.find(r => r.id === recordId);
  if (!rec || !rec.prevSnapshotToken) return false;
  const ok = restorePublishSnapshot(rec.prevSnapshotToken);
  if (!ok) return false;
  removePublishRecord(recordId);
  return true;
}

/** Read the publish history (newest first), optionally filtered to one client. */
export async function listPublishHistory(clientId?: string): Promise<PublishRecord[]> {
  return clientId ? publishHistory.filter(r => r.clientRepoId === clientId) : publishHistory.slice();
}

/**
 * Per-client summary used by the Clients hub: drift count, customizations, last publish.
 */
export interface ClientHealth {
  clientRepoId: string;
  customizations: number;
  deletions: number;
  /** How many master changes haven't been published to this client yet. */
  behindMaster: number;
  /** Last publish entry, if any. */
  lastPublishAt: string | null;
}

export async function getClientHealth(clientId: string): Promise<ClientHealth> {
  const overrides = clientOverrides[clientId] ?? [];
  const tombs = clientTombstones[clientId] ?? [];
  const preview = await previewPublish(clientId);
  const last = publishHistory.find(p => p.clientRepoId === clientId);
  // Use diffRepo to also count modified-with-drift as "behind".
  const drift = diffRepo(clientId).filter(e => e.driftFromMaster).length;
  return {
    clientRepoId: clientId,
    customizations: overrides.length,
    deletions: tombs.length,
    behindMaster: preview.added.length + preview.removed.length + drift,
    lastPublishAt: last?.at ?? null,
  };
}
