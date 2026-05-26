/**
 * Centralised permission helpers. Backed by the (mocked) workspace member
 * role; replace the role source when real auth lands.
 *
 * Roles:
 *  - owner       — everything, incl. taxonomy + publish + delete
 *  - contributor — create/edit cases, bulk ops, can publish, can manage taxonomy
 *  - operator    — execute / triage; can edit cases; cannot publish or manage taxonomy
 *  - viewer      — read-only
 */
import type { WorkspaceRole } from '@/types';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export function useCurrentRole(): WorkspaceRole {
  const { currentWorkspace } = useWorkspace();
  // Pick the first member; in a real app this would be the signed-in user.
  return currentWorkspace.members[0]?.role ?? 'viewer';
}

export interface Capabilities {
  canEditCase: boolean;
  canDeleteCase: boolean;
  canPublish: boolean;
  canManageTaxonomy: boolean;
  canManageClients: boolean;
}

export function capabilitiesFor(role: WorkspaceRole): Capabilities {
  switch (role) {
    case 'owner':
      return { canEditCase: true, canDeleteCase: true, canPublish: true, canManageTaxonomy: true, canManageClients: true };
    case 'contributor':
      return { canEditCase: true, canDeleteCase: true, canPublish: true, canManageTaxonomy: true, canManageClients: false };
    case 'operator':
      return { canEditCase: true, canDeleteCase: false, canPublish: false, canManageTaxonomy: false, canManageClients: false };
    case 'viewer':
    default:
      return { canEditCase: false, canDeleteCase: false, canPublish: false, canManageTaxonomy: false, canManageClients: false };
  }
}

export function useCapabilities(): Capabilities {
  return capabilitiesFor(useCurrentRole());
}
