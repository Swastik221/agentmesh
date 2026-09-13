import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveProjectSelection,
  getPersistedProjectId,
  setPersistedProjectId,
  clearPersistedProjectId,
  markProjectInvalidated,
  isProjectInvalidated,
  resetInvalidatedProjects,
} from '../projectSelection';
import type { Project } from '../../adapters/live/project.adapter';

describe('PRD P0 Stale Project Selection Fix Unit & Integration Tests', () => {
  const userA = 'user-a-1111';
  const userB = 'user-b-2222';

  const projectA: Project = {
    id: 'project-a-id',
    name: 'Project A',
    description: null,
    ownerId: userA,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const projectB: Project = {
    id: 'project-b-id',
    name: 'Project B',
    description: null,
    ownerId: userB,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const staleProjectId = 'cmtzgko0s00010z0ld6i94w1l';

  beforeEach(() => {
    clearPersistedProjectId(userA);
    clearPersistedProjectId(userB);
    resetInvalidatedProjects();
  });

  it('Test 1 — Valid persisted project remains unchanged', () => {
    setPersistedProjectId(userA, projectA.id);
    const projects = [projectA];

    const result = resolveProjectSelection(projects, projectA.id, userA);

    expect(result.selectedProjectId).toBe(projectA.id);
    expect(result.shouldNavigate).toBe(false);
    expect(result.isStale).toBe(false);
    expect(getPersistedProjectId(userA)).toBe(projectA.id);
  });

  it('Test 2 — Stale persisted project is cleared and valid project selected', () => {
    setPersistedProjectId(userA, staleProjectId);
    const projects = [projectA];

    const result = resolveProjectSelection(projects, staleProjectId, userA);

    expect(result.selectedProjectId).toBe(projectA.id);
    expect(result.shouldNavigate).toBe(true);
    expect(result.isStale).toBe(true);
    // Verify stale ID was cleared from storage and replaced with valid project A
    expect(getPersistedProjectId(userA)).toBe(projectA.id);
  });

  it('Test 3 — No projects returns currentProjectId = null and clears stale ID', () => {
    setPersistedProjectId(userA, staleProjectId);
    const projects: Project[] = [];

    const result = resolveProjectSelection(projects, staleProjectId, userA);

    expect(result.selectedProjectId).toBeNull();
    expect(result.shouldNavigate).toBe(true);
    expect(result.isStale).toBe(true);
    expect(getPersistedProjectId(userA)).toBeNull();
  });

  it('Test 4 — User switch: User A project is NOT restored for User B', () => {
    // User A selects Project A
    setPersistedProjectId(userA, projectA.id);
    expect(getPersistedProjectId(userA)).toBe(projectA.id);

    // User B logs in and has Project B
    const userBProjects = [projectB];

    // Attempting to resolve for User B should ignore User A's persisted project
    const result = resolveProjectSelection(userBProjects, null, userB);

    expect(result.selectedProjectId).toBe(projectB.id);
    expect(result.isStale).toBe(false);
    expect(getPersistedProjectId(userB)).toBe(projectB.id);
    // User A's storage remains distinct
    expect(getPersistedProjectId(userA)).toBe(projectA.id);
  });

  it('Test 5 — Project 404 recovery invalidates active project and selects valid project without infinite retry', () => {
    const projects = [projectA, projectB];

    // Mark projectA as 404 / invalidated
    markProjectInvalidated(projectA.id);
    expect(isProjectInvalidated(projectA.id)).toBe(true);

    // When resolving projectA for userA, it detects invalidation and recovers to projectB
    const result = resolveProjectSelection(projects, projectA.id, userA);

    expect(result.selectedProjectId).toBe(projectB.id);
    expect(result.shouldNavigate).toBe(true);
    expect(result.isStale).toBe(true);
    expect(getPersistedProjectId(userA)).toBe(projectB.id);

    // Subsequent call for projectA still sees it as invalidated and won't retry projectA
    const repeatResult = resolveProjectSelection(projects, projectA.id, userA);
    expect(repeatResult.selectedProjectId).toBe(projectB.id);
  });

  it('Test 6 — Refresh: valid project is restored on refresh', () => {
    setPersistedProjectId(userA, projectA.id);
    const projects = [projectA, projectB];

    // Refresh simulation: candidateId is null (e.g. landing on route)
    const result = resolveProjectSelection(projects, null, userA);

    expect(result.selectedProjectId).toBe(projectA.id);
    expect(result.shouldNavigate).toBe(true); // Navigates to /workspace/project-a-id from /
    expect(result.isStale).toBe(false);
    expect(getPersistedProjectId(userA)).toBe(projectA.id);
  });
});
