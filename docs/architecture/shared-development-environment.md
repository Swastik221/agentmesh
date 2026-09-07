# Architecture — Shared Development Environment

The Shared Development Environment layer establishes a project-level workspace that agents reason about and execute within. It forms the foundation for token minimization and conflict-free multi-agent execution.

---

## 1. Overview

```text
Project
   │
   └── ProjectWorkspace
        │
        ├── Environment Metadata (rootPath: workspaces/:projectId)
        ├── Active Tasks
        ├── File Ownership Metadata (filePaths: string[])
        └── Workspace State Snapshot
                │
                ▼
          Agent Execution
                │
                ▼
        Task-Specific Execution Context
```

---

## 2. Core Principles & Token Minimization

1. **Deterministic Backend State**: The backend maintains workspace state, file path ownership, and active task conflicts deterministically rather than relying on LLMs to coordinate.
2. **Compact Workspace State Snapshots**: Agents receive lightweight snapshots (`GET /projects/:projectId/workspace/state`) containing only essential workspace fields (`id`, `title`, `status`, `priority`, `responsibleAgentIds`, `filePaths`). Chat history, LLM prompts, execution outputs, and heavy artifacts are omitted.
3. **Execution Context**: Executors receive `ExecutionContext` (`projectId`, `workspaceId`, `rootPath`, `workingDirectory`) where `workingDirectory ⊆ workspace root`.

---

## 3. File Ownership & Conflict Detection

- Tasks declare workspace-relative file paths (`filePaths: string[]`).
- Paths are validated against directory traversal (`..`), absolute path injections (`/etc/passwd`), empty paths, and length limits.
- Two tasks conflict if:
  - `filePaths` overlap
  - AND existing task status is `IN_PROGRESS`
- Concurrency Protection: PostgreSQL row-locking (`SELECT ... FOR UPDATE`) guarantees atomic conflict verification during status transitions (`IN_PROGRESS`) and responsibility assignment. Conflicting requests receive `409 Conflict` with `FILE_CONFLICT` payload.
