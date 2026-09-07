# Task / Responsibility Engine Architecture

## Overview

The Task / Responsibility Engine provides a structured work-management graph for AgentMesh. It allows project tasks to be created, categorized by status and priority, assigned to responsible agents with explicit roles, and linked together via task dependencies.

## Data Model

Tasks, responsibilities, and dependencies are stored in PostgreSQL via Prisma:

```prisma
enum TaskStatus {
  TODO
  IN_PROGRESS
  BLOCKED
  COMPLETED
  FAILED
  CANCELLED
}

enum TaskPriority {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

model Task {
  id          String       @id @default(cuid())
  projectId   String
  creatorId   String
  title       String
  description String       @db.Text
  status      TaskStatus   @default(TODO)
  priority    TaskPriority @default(MEDIUM)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  project          Project              @relation(fields: [projectId], references: [id], onDelete: Cascade)
  creator          User                 @relation(fields: [creatorId], references: [id], onDelete: Restrict)
  responsibilities TaskResponsibility[]
  dependencies     TaskDependency[]     @relation("TaskDependencies")
  dependents       TaskDependency[]     @relation("TaskDependents")

  @@index([projectId])
  @@index([projectId, status])
  @@index([projectId, priority])
  @@index([creatorId])
  @@map("tasks")
}

model TaskResponsibility {
  id        String   @id @default(cuid())
  taskId    String
  agentId   String
  role      String?
  createdAt DateTime @default(now())

  task  Task  @relation(fields: [taskId], references: [id], onDelete: Cascade)
  agent Agent @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@unique([taskId, agentId])
  @@index([taskId])
  @@index([agentId])
  @@map("task_responsibilities")
}

model TaskDependency {
  id              String   @id @default(cuid())
  taskId          String
  dependsOnTaskId String
  createdAt       DateTime @default(now())

  task          Task @relation("TaskDependencies", fields: [taskId], references: [id], onDelete: Cascade)
  dependsOnTask Task @relation("TaskDependents", fields: [dependsOnTaskId], references: [id], onDelete: Cascade)

  @@unique([taskId, dependsOnTaskId])
  @@index([taskId])
  @@index([dependsOnTaskId])
  @@map("task_dependencies")
}
```

## Security & Isolation Rules

1. **SIWE Session Authorization**:
   - `creatorId` is strictly derived from `req.auth.userId` established via SIWE wallet login session.
   - Client-provided `creatorId` in HTTP payloads is ignored to prevent impersonation.
2. **Project Membership Verification**:
   - Only authenticated users who are members of the requested project can create, view, update, or delete tasks/responsibilities/dependencies. Non-members receive `403 Forbidden`.
3. **Agent Project Alignment**:
   - An agent can only be assigned to a task if the agent belongs to the *same* project. Cross-project agent assignment returns `403 Forbidden`.
4. **Self-Dependency Prevention**:
   - A task cannot depend on itself. Attempts to create self-dependencies return `400 Bad Request`.
5. **Duplicate Prevention**:
   - Assigning the same agent to the same task twice returns `409 Conflict`.
   - Creating the same dependency link twice returns `409 Conflict`.

## API Endpoints

All endpoints support both canonical `/projects/:projectId/tasks...` and `/api/projects/:projectId/tasks...` path prefixes.

### Task Management

- `POST /projects/:projectId/tasks`: Create a new task (body: `title`, `description`, `priority?`) -> `201 Created`
- `GET /projects/:projectId/tasks`: List project tasks with pagination (`page`, `limit`) and filtering (`status`, `priority`) -> `200 OK`
- `GET /projects/:projectId/tasks/:taskId`: Get task details -> `200 OK`
- `PATCH /projects/:projectId/tasks/:taskId`: Update task fields (`title?`, `description?`, `status?`, `priority?`) -> `200 OK`
- `DELETE /projects/:projectId/tasks/:taskId`: Delete task (cascade removes responsibilities and dependencies) -> `204 No Content`

### Task Responsibilities

- `POST /projects/:projectId/tasks/:taskId/responsibilities`: Assign agent to task (body: `agentId`, `role?`) -> `201 Created`
- `GET /projects/:projectId/tasks/:taskId/responsibilities`: List agents responsible for a task -> `200 OK`
- `DELETE /projects/:projectId/tasks/:taskId/responsibilities/:agentId`: Remove responsibility -> `204 No Content`

### Task Dependencies

- `POST /projects/:projectId/tasks/:taskId/dependencies`: Add dependency (body: `dependsOnTaskId`) -> `201 Created`
- `GET /projects/:projectId/tasks/:taskId/dependencies`: List dependencies for a task -> `200 OK`
- `DELETE /projects/:projectId/tasks/:taskId/dependencies/:dependsOnTaskId`: Remove dependency -> `204 No Content`

## Why Task Execution Is Separate

This PRD establishes the structured task graph and responsibility assignment system without executing tasks. Real-time WebSocket task event synchronization and AI agent execution are handled by subsequent protocol and orchestration layers.
