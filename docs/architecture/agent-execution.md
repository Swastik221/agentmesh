# Agent Execution Layer Architecture

## Overview

The Agent Execution Layer models the execution lifecycle of tasks assigned to responsible agents. It establishes an extensible executor abstraction (`AgentExecutor`) that simulates or manages task runs, manages lifecycle state transitions, updates task progress/result statuses, and updates agent BUSY/ONLINE availability statuses.

## Data Model

Task executions are stored in PostgreSQL via Prisma:

```prisma
enum ExecutionStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

model TaskExecution {
  id          String          @id @default(cuid())
  taskId      String
  agentId     String
  status      ExecutionStatus @default(QUEUED)
  input       Json?
  output      Json?
  error       String?
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  task  Task  @relation(fields: [taskId], references: [id], onDelete: Cascade)
  agent Agent @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@index([taskId])
  @@index([agentId])
  @@index([status])
  @@map("task_executions")
}
```

## State Transitions & Validation

Execution state transitions are strictly governed by state transition rules:

- `QUEUED` ➔ `RUNNING` or `CANCELLED`
- `RUNNING` ➔ `COMPLETED`, `FAILED`, or `CANCELLED`
- Terminal states (`COMPLETED`, `FAILED`, `CANCELLED`) cannot transition to any other state. Attempting invalid transitions throws a `ConflictError` (`409 Conflict`).

```
           ┌──────────┐
           │  QUEUED  │
           └────┬─────┘
                │
                ├───► CANCELLED (Terminal)
                │
                ▼
           ┌──────────┐
           │ RUNNING  │
           └────┬─────┘
                │
      ┌─────────┼─────────┐
      │         │         │
      ▼         ▼         ▼
  COMPLETED   FAILED  CANCELLED
  (Terminal) (Terminal)(Terminal)
```

## Task & Agent State Synchronization

1. **Task State Sync**:
   - Starting execution (`QUEUED` ➔ `RUNNING`) updates Task status to `IN_PROGRESS`.
   - Completion (`COMPLETED`) updates Task status to `COMPLETED`.
   - Failure (`FAILED`) updates Task status to `FAILED`.
   - **Stale Execution Protection**: Only the latest execution created for a task can update the task's final state, preventing older out-of-order execution completions from corrupting newer task states.

2. **Agent Status Sync**:
   - Starting execution updates Agent status to `BUSY`.
   - When an agent's last active execution (`QUEUED` or `RUNNING`) finishes, Agent status returns to `ONLINE`.

## Executor Abstraction (`AgentExecutor`)

```ts
export interface AgentExecutionRequest {
  executionId: string;
  taskId: string;
  agentId: string;
  input?: Record<string, unknown> | null;
}

export interface AgentExecutionResult {
  status: 'COMPLETED' | 'FAILED';
  output?: Record<string, unknown> | null;
  error?: string | null;
}

export interface AgentExecutor {
  execute(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
}
```

### `MockAgentExecutor`

Provides deterministic mock execution suitable for tests without calling external AI providers. Real AI providers (Claude, Codex, Gemini, custom agents) plug directly into this `AgentExecutor` interface in future PRDs.

## Security & Isolation

- **SIWE Authorization**: Demands valid session authentication.
- **Project Membership**: Verified for all requests (`403 Forbidden` if not a member).
- **Project Scope**: Task and Agent must belong to the requested project.
- **Responsibility Check**: Agent must be assigned responsibility for the task (`403 Forbidden` if not responsible).

## API Endpoints

All endpoints support both `/projects/:projectId/tasks/:taskId/executions...` and `/api/projects/:projectId/tasks/:taskId/executions...` path prefixes.

- `POST /projects/:projectId/tasks/:taskId/executions`: Start task execution (body: `agentId`, `input?`) -> `201 Created`
- `GET /projects/:projectId/tasks/:taskId/executions`: List executions for a task (paginated `{ items, page, limit, total }`) -> `200 OK`
- `GET /projects/:projectId/tasks/:taskId/executions/:executionId`: Get execution details -> `200 OK`
