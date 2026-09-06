# Project Brain — Shared Context & Intelligence Layer Architecture

## Overview

Project Brain provides a shared, persistent context layer for AgentMesh projects. It allows human users and agents within a project to store, search, and update structured intelligence entries.

## Data Model

Project Brain entries are stored in PostgreSQL using Prisma under the `project_brain_entries` table.

```prisma
enum ProjectBrainEntryType {
  REQUIREMENT
  DECISION
  NOTE
  CONSTRAINT
}

model ProjectBrainEntry {
  id        String                @id @default(cuid())
  projectId String
  authorId  String
  type      ProjectBrainEntryType
  title     String
  content   String
  metadata  Json?
  createdAt DateTime              @default(now())
  updatedAt DateTime              @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  author  User    @relation(fields: [authorId], references: [id], onDelete: Restrict)

  @@index([projectId])
  @@index([projectId, type])
  @@index([authorId])
  @@map("project_brain_entries")
}
```

## Security & Identity Invariants

1. **SIWE Session Authorization**:
   - `authorId` is strictly derived from `req.auth.userId` established via SIWE wallet login session.
   - Client-provided `authorId` in HTTP payloads is ignored to prevent impersonation.
2. **Project Scope Isolation**:
   - Non-members attempting to access or modify project brain entries receive `403 Forbidden`.
   - Accessing an entry with a mismatching `projectId` returns `404 Not Found`.

## API Endpoints

- `POST /projects/:projectId/brain`: Create a new entry (accepts `type`, `title`, `content`, `metadata`)
- `GET /projects/:projectId/brain`: List entries with filtering by `type` and pagination (`page`, `limit`)
- `GET /projects/:projectId/brain/:entryId`: Get details of a single entry
- `PATCH /projects/:projectId/brain/:entryId`: Partial update of an entry (supports `type`, `title`, `content`, `metadata`)
- `DELETE /projects/:projectId/brain/:entryId`: Delete an entry (returns HTTP `204 No Content`)

All routes are also accessible with the `/api` prefix (`/api/projects/:projectId/brain`).

## Response Schemas

### List Entries (`GET /projects/:projectId/brain`)

```json
{
  "items": [
    {
      "id": "entry-uuid",
      "projectId": "project-uuid",
      "authorId": "user-uuid",
      "type": "DECISION",
      "title": "Architecture Standard",
      "content": "Description content",
      "metadata": { "env": "production" },
      "createdAt": "2026-09-07T04:00:00.000Z",
      "updatedAt": "2026-09-07T04:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 42
}
```
