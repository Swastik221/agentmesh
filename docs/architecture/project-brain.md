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
  id        String                @id @default(uuid())
  projectId String
  authorId  String
  type      ProjectBrainEntryType
  title     String
  content   String                @db.Text
  tags      String[]              @default([])
  createdAt DateTime              @default(now())
  updatedAt DateTime              @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  author  User    @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@index([projectId, createdAt])
  @@index([projectId, type])
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

- `POST /api/projects/:projectId/brain/entries`: Create a new entry
- `GET /api/projects/:projectId/brain/entries`: List entries with filtering, pagination, and search
- `GET /api/projects/:projectId/brain/entries/:entryId`: Get details of a single entry
- `PUT /api/projects/:projectId/brain/entries/:entryId`: Update an entry
- `DELETE /api/projects/:projectId/brain/entries/:entryId`: Delete an entry
- `GET /api/projects/:projectId/brain`: Get aggregated Project Brain view with breakdown statistics

## Filtering & Pagination

- **Filtering**: By `type` (`REQUIREMENT`, `DECISION`, `NOTE`, `CONSTRAINT`) and `tag`.
- **Search**: Case-insensitive search across `title` and `content`.
- **Pagination**: Default `page: 1`, `limit: 20` (max 100). Default ordering `createdAt DESC`.
