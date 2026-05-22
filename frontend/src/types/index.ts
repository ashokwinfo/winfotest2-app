export type WorkspaceRole = 'owner' | 'contributor' | 'operator' | 'viewer';
export type Environment = 'dev' | 'qa' | 'uat';
export type TeamRole = 'lead' | 'member' | 'viewer';
export type TestCaseType = 'standard' | 'customized';
export type RunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export type ValidationTypeEnum = 'validation_from_application' | 'format_expression' | 'not_applicable';
export type UniqueMandatory = 'mandatory' | 'not_applicable';
export type DataType = 'alpha_numeric' | 'numeric' | 'date' | 'text' | 'not_applicable';
export type TestingType = 'not_applicable' | 'positive' | 'negative';

export type StepAction =
  | 'login_into_application'
  | 'click_icon'
  | 'click_link'
  | 'click_button'
  | 'enter_value_text_field'
  | 'enter_value_text_field_oj'
  | 'key_enter'
  | 'key_tab'
  | 'wait_till_load'
  | 'date_picker'
  | 'select_dropdown'
  | 'scroll_down'
  | 'navigate_to_url'
  | 'validate_text'
  | 'validate_element';

export interface Workspace {
  id: string;
  name: string;
  members: WorkspaceMember[];
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  avatarUrl?: string;
}

export interface Application {
  id: string;
  name: string;
  workspaceId: string;
  description?: string;
  createdAt: string;
}

export interface Release {
  id: string;
  name: string;
  applicationId: string;
  version: string;
  createdAt: string;
  /** Soft-delete timestamp (ISO). When set, hidden from default lists. */
  deletedAt?: string;
}

export interface Module {
  id: string;
  name: string;
  /** App-level home of this module. Modules now belong to an Application; releases are tags. */
  applicationId?: string;
  /** @deprecated kept for backward compatibility — modules are no longer scoped per-release. */
  releaseId?: string;
  /** Soft-delete timestamp (ISO). */
  deletedAt?: string;
}

/**
 * A Business Process is an end-to-end flow (Order-to-Cash, Hire-to-Retire, etc.)
 * that can span multiple modules. Test cases are tagged into one or more processes.
 */
export interface Process {
  id: string;
  name: string;
  description?: string;
  /** Optional anchor application; null = cross-app. */
  applicationId?: string;
  /** Soft-delete timestamp (ISO). */
  deletedAt?: string;
}

export interface Feature {
  id: string;
  name: string;
  moduleId: string;
  /** Soft-delete timestamp (ISO). */
  deletedAt?: string;
}
export interface CreateTestCasePayload {
  module_id: string;
  feature_id: string;
  process_ids: string | string[];
  name: string;
  description?: string;
  role: string;
  script_type: string;
  labels?: string[];
}
export interface TestCase {
  id: string;
  caseNumber: string;
  testCaseName: string;
  featureId: string;
  moduleId: string;
  /** Primary / "home" release. Use `releaseIds` for the full set of tagged versions. */
  releaseId: string;
  /** All releases this test case applies to. Should always include `releaseId`. */
  releaseIds?: string[];
  /** Business processes this test case is tagged into (e.g., 'proc-1' for Hire-to-Retire). */
  processIds?: string[];
  /** Free-form labels (e.g., 'smoke', 'regression', 'critical-path'). */
  labels?: string[];
  role: string;
  description?: string;
  expectedResult?: string;
  dependency?: string;
  type: TestCaseType;
  status: 'valid' | 'draft' | 'archived';
  order: number;
  parentCaseId?: string;
  version?: number;
  createdAt: string;
  updatedAt: string;
  /** Soft-delete timestamp (ISO). When set, the case is hidden from default views. */
  deletedAt?: string;
}

export interface TestStep {
  id: string;
  testCaseId: string;
  lineNumber: number;
  stepDescription: string;
  inputParameter: string;
  action: StepAction;
  validationType: ValidationTypeEnum;
  validationName: string;
  uniqueMandatory: UniqueMandatory;
  dataType: DataType;
  testingType: TestingType;
  capturedData?: string;
}

export interface TestRun {
  id: string;
  name: string;
  releaseId: string;
  moduleId: string;
  environment: Environment;
  status: RunStatus;
  createdBy: string;
  startedAt: string;
  completedAt?: string;
  progress: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  selectedCaseIds?: string[];
  iterationCounts?: Record<string, number>;
  teamId?: string;
}

export interface TestRunStepResult {
  stepId: string;
  status: RunStatus;
  duration: number; // ms
  error?: string;
  output?: string;
  screenshotUrl?: string;
}

export interface TestRunCaseResult {
  testCaseId: string;
  iteration?: number;
  status: RunStatus;
  duration: number; // ms
  error?: string;
  stepResults: TestRunStepResult[];
}

export interface TestRunResult {
  runId: string;
  testCaseId: string;
  stepId: string;
  status: RunStatus;
  output?: string;
  timestamp: string;
}

// ===========================================================================
// Multi-tenant repositories: Master library (provider) + Client repos (tenants)
// ===========================================================================

/** A client tenant repository — a per-customer copy of the master library. */
export interface ClientRepo {
  id: string;          // 'client-globex'
  name: string;        // 'Globex Corp'
  workspaceId: string;
  /** Last master baseline version published to this client. */
  baselineVersion: number;
  createdAt: string;
}

/** 'master' for the canonical library, otherwise a ClientRepo.id. */
export type RepoId = 'master' | string;

/**
 * A client-side override of a master case OR a brand-new client-only case.
 * - originCaseId set + originVersion set → "Modified" (forked from master)
 * - originCaseId undefined → "New" (client-only)
 */
export interface TestCaseOverride {
  id: string;
  clientRepoId: string;
  originCaseId?: string;
  originVersion?: number;
  testCase: TestCase;
  /** Steps for this override. Replaces the inherited steps entirely. */
  steps: TestStep[];
}

/** Marker that a client deleted an inherited master case. */
export interface TestCaseTombstone {
  clientRepoId: string;
  originCaseId: string;
  deletedAt: string;
}

export type DiffStatus = 'new' | 'modified' | 'deleted' | 'unchanged';

export interface CaseDiffEntry {
  status: DiffStatus;
  caseNumber: string;
  testCaseName: string;
  /** Stable id for routing — master id when present, else override id. */
  rowId: string;
  masterCase?: TestCase;
  clientCase?: TestCase;
  /** True when master.version has advanced past the override's originVersion. */
  driftFromMaster?: boolean;
}

/** A snapshot of a single "publish master → client" event. */
export interface PublishRecord {
  id: string;
  clientRepoId: string;
  clientName: string;
  /** Master baseline version after publish (i.e. the new client baselineVersion). */
  toBaselineVersion: number;
  /** Baseline version this publish replaced — used by rollback. */
  fromBaselineVersion?: number;
  /** Counts shown in the receipt + history. */
  added: number;
  removed: number;
  protectedCount: number;
  /** When it happened, ISO. */
  at: string;
  /** Who did it. */
  by: string;
  /** Persisted snippet of the preview at publish time, used for the changelog view. */
  changelog?: {
    added: { caseNumber: string; testCaseName: string }[];
    removed: { caseNumber: string; testCaseName: string }[];
    protected: { caseNumber: string; testCaseName: string }[];
  };
  /** Snapshot tokens for rollback (overrides + tombstones at publish time). */
  prevSnapshotToken?: string;
}

/** What a publish would do for a single client — used by the preview step. */
export interface PublishPreview {
  clientRepoId: string;
  clientName: string;
  /** Master cases that don't exist in the client repo and would be added. */
  added: CaseDiffEntry[];
  /** Master cases that have been deleted in master but still exist (inherited) in the client. */
  removed: CaseDiffEntry[];
  /** Cases the client has customized — they will be skipped (preserved). */
  protected: CaseDiffEntry[];
  /** Customizations whose origin master case has advanced — they'll be flagged as drift. */
  driftAfter: CaseDiffEntry[];
}

export interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  entityName: string;
  action: 'created' | 'updated' | 'deleted' | 'executed';
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  userId: string;
  userName: string;
  timestamp: string;
}

export interface HierarchyNode {
  id: string;
  name: string;
  type: 'application' | 'release' | 'module' | 'feature' | 'testcase';
  /** Optional count badge (e.g., test count). */
  count?: number;
  children?: HierarchyNode[];
}

export interface RunScreenshot {
  id: string;
  runId: string;
  testCaseId: string;
  stepId: string;
  url: string;
  label: string;
  timestamp: string;
  teamId?: string;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  description?: string;
  workspaceId: string;
  members: TeamMember[];
  createdAt: string;
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
}

export interface RunTemplate {
  id: string;
  name: string;
  description?: string;
  releaseId: string;
  moduleId: string;
  environment: Environment;
  selectedCaseIds: string[];
  teamId?: string;
  createdBy: string;
  createdAt: string;
}
