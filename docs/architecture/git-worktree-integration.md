# Architecture — Git / Worktree Integration

The Git / Worktree Integration layer upgrades AgentMesh to provision real, physically isolated Git worktrees for agent task executions.

---

## 1. Overview

```text
Project
   ↓
ProjectWorkspace (gitRepoPath)
   ↓
Git Repository
   ↓
Task Execution
   ↓
GitWorktree (path: .worktrees/:executionId, branch: agentmesh/execution/:executionId)
   ↓
ExecutionContext (workingDirectory ⊆ rootPath)
```

---

## 2. Security & Path Containment

- **No Shell Execution**: `GitService` strictly invokes Node's `execFile('git', args, { shell: false })` using fixed argument arrays — zero command string concatenation or shell syntax.
- **Server-Controlled Paths & Branches**: Worktrees are created exclusively at `${workspace.rootPath}/.worktrees/${executionId}` with server-generated branch names `agentmesh/execution/${executionId}`. Client-supplied filesystem paths or branch names are strictly rejected.
- **Path Containment Checks**: `assertPathContained` uses `path.resolve` containment checks to guarantee that all worktree and repository paths stay strictly within the workspace root.

---

## 3. Worktree Lifecycle & Concurrency

- **Unique Execution Constraint**: `executionId` has a unique database constraint (`@unique`). Concurrent creation requests for the same execution produce a deterministic `409 GIT_WORKTREE_ALREADY_EXISTS` response.
- **Explicit Cleanup**: Worktree removal (`POST /projects/:projectId/worktrees/:worktreeId/remove`) physically removes the worktree directory and branch via Git, updating the database status to `REMOVED` for auditing and history.
