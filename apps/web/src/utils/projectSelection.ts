import { liveProjectAdapter, type Project } from '../adapters/live/project.adapter';
import { authSessionService } from '../services/auth-session';
import { navigate } from '../routes/AppRouter';

const STORAGE_PREFIX = 'agentmesh_selected_project_';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const memoryStorage = new MemoryStorage();

function getStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return memoryStorage;
}

/** In-memory set of project IDs that returned 404 / 403 or were invalidated during the session. */
const invalidatedProjectIds = new Set<string>();

/**
 * Gets the persisted project ID for a specific user from storage.
 */
export function getPersistedProjectId(userId: string | null): string | null {
  if (!userId) {
    return null;
  }
  return getStorage().getItem(`${STORAGE_PREFIX}${userId}`) || null;
}

/**
 * Persists the selected project ID for a specific user to storage.
 */
export function setPersistedProjectId(userId: string | null, projectId: string | null): void {
  if (!userId) {
    return;
  }
  const key = `${STORAGE_PREFIX}${userId}`;
  if (projectId) {
    getStorage().setItem(key, projectId);
  } else {
    getStorage().removeItem(key);
  }
}

/**
 * Clears the persisted project ID for a specific user.
 */
export function clearPersistedProjectId(userId: string | null): void {
  if (!userId) {
    return;
  }
  getStorage().removeItem(`${STORAGE_PREFIX}${userId}`);
}

/**
 * Marks a project ID as invalidated (e.g. returned 404).
 */
export function markProjectInvalidated(projectId: string): void {
  if (projectId) {
    invalidatedProjectIds.add(projectId);
  }
}

/**
 * Checks if a project ID has been marked as invalidated.
 */
export function isProjectInvalidated(projectId: string | null): boolean {
  if (!projectId) return false;
  return invalidatedProjectIds.has(projectId);
}

/**
 * Clears memory of invalidated project IDs and test storage (useful for tests or user switches).
 */
export function resetInvalidatedProjects(): void {
  invalidatedProjectIds.clear();
  memoryStorage.clear();
}

export interface SelectionResolution {
  selectedProjectId: string | null;
  shouldNavigate: boolean;
  isStale: boolean;
}

/**
 * Core decision logic for project selection.
 * Given:
 * - `projects`: list of projects owned by / member of for the authenticated user
 * - `candidateId`: the project ID from URL or active state
 * - `userId`: ID of the authenticated user
 *
 * Returns:
 * - `SelectionResolution`: `{ selectedProjectId, shouldNavigate, isStale }`
 */
export function resolveProjectSelection(
  projects: Project[],
  candidateId: string | null,
  userId: string | null,
): SelectionResolution {
  const validProjects = projects.filter((p) => !invalidatedProjectIds.has(p.id));

  // If no authenticated user or no valid non-invalidated projects available
  if (validProjects.length === 0) {
    if (userId && candidateId) {
      clearPersistedProjectId(userId);
    }
    return {
      selectedProjectId: null,
      shouldNavigate: Boolean(candidateId),
      isStale: Boolean(candidateId),
    };
  }

  const validProjectIds = new Set(validProjects.map((p) => p.id));

  // Case A: candidateId exists in the user's project list and has not been marked 404/invalidated
  if (candidateId && validProjectIds.has(candidateId)) {
    setPersistedProjectId(userId, candidateId);
    return {
      selectedProjectId: candidateId,
      shouldNavigate: false,
      isStale: false,
    };
  }

  // Case B: candidateId is stale, missing, or invalidated
  const isStale = Boolean(candidateId && !validProjectIds.has(candidateId));
  if (isStale && userId) {
    clearPersistedProjectId(userId);
  }

  // Prefer a previously persisted valid project for this user if candidate was not set/valid
  const persisted = getPersistedProjectId(userId);
  if (persisted && validProjectIds.has(persisted)) {
    return {
      selectedProjectId: persisted,
      shouldNavigate: candidateId !== persisted,
      isStale,
    };
  }

  // Fallback: Pick the first available non-invalidated project
  const fallbackId = validProjects[0].id;
  setPersistedProjectId(userId, fallbackId);
  return {
    selectedProjectId: fallbackId,
    shouldNavigate: candidateId !== fallbackId,
    isStale,
  };
}

/**
 * Triggers 404 recovery for a stale/nonexistent project ID:
 * 1. Marks `staleProjectId` as invalidated in memory.
 * 2. Fetches the current user's project list.
 * 3. Resolves and navigates to a valid project (or /workspaces if no projects exist).
 */
export async function recoverFromStaleProject(staleProjectId: string): Promise<string | null> {
  if (!staleProjectId || isProjectInvalidated(staleProjectId)) {
    return null;
  }
  markProjectInvalidated(staleProjectId);

  const userId = authSessionService.getCurrentUser()?.id ?? null;
  if (userId) {
    clearPersistedProjectId(userId);
  }

  try {
    const list = await liveProjectAdapter.listProjects();
    const resolution = resolveProjectSelection(list, staleProjectId, userId);

    if (resolution.selectedProjectId) {
      navigate(`/workspace/${resolution.selectedProjectId}`);
    } else {
      navigate('/workspaces');
    }
    return resolution.selectedProjectId;
  } catch {
    navigate('/workspaces');
    return null;
  }
}
