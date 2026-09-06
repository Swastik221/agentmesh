# AgentMesh

Multiplayer workspace for humans + AI agents.

## Repository Structure

```text
agentmesh/
├── apps/
│   ├── web/            # React + Vite frontend application
│   └── server/         # Express + Node.js TypeScript backend application (with Prisma ORM)
├── packages/
│   ├── shared/         # Shared TypeScript interfaces & types
│   ├── agent-protocol/ # Protocol definition package foundation
│   ├── config/         # Shared TypeScript configuration
│   └── ui/             # Shared UI component library foundation
├── contracts/          # Smart contract placeholders
├── docs/               # Technical documentation
└── scripts/            # Repository utility scripts
```

## Prerequisites

- **Node.js**: `>= 20.0.0`
- **pnpm**: `>= 9.0.0` (Recommended: `12.3.4`)
- **PostgreSQL**: `>= 14` (Recommended: `16`)

## Installation

```bash
pnpm install
```

## Environment Configuration

Copy the example environment configuration file to `.env`:

```bash
cp .env.example .env
```

Default variables:

```env
PORT=3001
WEB_ORIGIN=http://localhost:5173
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/agentmesh?schema=public"
```

## Core Models Overview

- **User**: Represents a human or system user (`id` CUID, `walletAddress` unique, `displayName`).
- **Project**: Collaboration workspace (`id` CUID, `name`, `description`, `ownerId` -> User).
- **ProjectMember**: Membership association with composite constraint `(projectId, userId)` and roles (`OWNER`, `MEMBER`).
- **Agent**: AI agent representation (`id` CUID, `projectId`, `ownerId`, `name`, `provider`, `status` enum `OFFLINE` | `ONLINE` | `BUSY`).

## API Endpoints (PRD #8)

### Health Check

- `GET /health` -> `200 OK`
  ```json
  {
    "status": "ok",
    "service": "agentmesh-server",
    "database": "connected"
  }
  ```

### Wallet Authentication API (PRD #8)

- `GET /auth/nonce` -> Generate single-use cryptographic SIWE nonce (`200 OK`)
  ```json
  { "nonce": "random-nonce-string" }
  ```
- `POST /auth/verify` -> Verify EIP-4361 SIWE signature, create/find user with lowercased address, issue session cookie (`200 OK`, `401 Unauthorized` if invalid signature/nonce/domain)
  ```json
  { "message": "SIWE message", "signature": "0x..." }
  ```
- `GET /auth/me` -> Get authenticated user from session cookie or Bearer token (`200 OK` or `401 Unauthorized`)
- `POST /auth/logout` -> Invalidate session and clear session cookie (`204 No Content`)

### Users API

- `POST /users` -> Create user (`201 Created`)
  ```json
  { "walletAddress": "0x123...", "displayName": "Swastik" }
  ```
- `GET /users/:userId` -> Get user by ID (`200 OK` or `404 Not Found`)
- `GET /users/wallet/:walletAddress` -> Lookup user by wallet (`200 OK` or `404 Not Found`)
- `PATCH /users/:userId` -> Update display name (`200 OK` or `404 Not Found`)
  ```json
  { "displayName": "New Name" }
  ```
- `GET /users/:userId/projects` -> List user's project memberships (`200 OK` or `404 Not Found`)

### Projects API

- `POST /projects` -> Create project (`201 Created`)
  - Automatically creates a `ProjectMember` record with role `OWNER` inside a transaction.
  ```json
  { "name": "AgentMesh", "description": "Collaborative AI workspace", "ownerId": "user-id" }
  ```
- `GET /projects/:projectId` -> Get project details with owner, members, agents (`200 OK` or `404 Not Found`)
- `PATCH /projects/:projectId` -> Update project name or description (`200 OK` or `404 Not Found`)
  ```json
  { "name": "Updated Name", "description": "Updated Description" }
  ```
- `DELETE /projects/:projectId` -> Delete project and cascade members/agents (`200 OK` or `404 Not Found`)

### Project Membership API

- `POST /projects/:projectId/members` -> Add member to project (`201 Created`, `404 Not Found` if user/project missing, `409 Conflict` if duplicate)
  ```json
  { "userId": "user-id", "role": "MEMBER" }
  ```
- `GET /projects/:projectId/members` -> List members for project (`200 OK` or `404 Not Found`)
- `PATCH /projects/:projectId/members/:userId` -> Update member role (`200 OK`, `409 Conflict` if attempting to demote the only OWNER)
  ```json
  { "role": "OWNER" }
  ```
- `DELETE /projects/:projectId/members/:userId` -> Remove member from project (`200 OK`, `409 Conflict` if attempting to remove the only OWNER)

### Agent Registry API (PRD #4)

- `POST /projects/:projectId/agents` -> Register agent (`201 Created`, `404 Not Found` if project or owner missing, `403 Forbidden` if owner isn't a project member, `400 Bad Request` if invalid body)
  - Agent is always initialized with `status = OFFLINE`.
  ```json
  { "ownerId": "user-id", "name": "Claude Dev", "provider": "claude" }
  ```
- `GET /projects/:projectId/agents` -> List project agents (`200 OK` or `404 Not Found` if project missing)
  - Supports optional capability query filter: `GET /projects/:projectId/agents?capability=backend`
- `GET /agents/:agentId` -> Get individual agent details (`200 OK` or `404 Not Found`)
- `PATCH /agents/:agentId` -> Update agent (`200 OK`, `400 Bad Request` if invalid status or empty update payload, `404 Not Found`)
  ```json
  { "name": "Claude Backend", "provider": "claude", "status": "ONLINE" }
  ```
  Valid status values: `OFFLINE`, `ONLINE`, `BUSY`.
- `DELETE /agents/:agentId` -> Delete agent (`204 No Content` or `404 Not Found`)

### Agent Capabilities API (PRD #5)

- `POST /agents/:agentId/capabilities` -> Add capability to agent (`201 Created`, `409 Conflict` if duplicate capability, `400 Bad Request` if invalid capability format, `404 Not Found` if agent missing)
  - Capabilities are normalized (trimmed, lowercased, 2-50 chars, matching `^[a-z0-9]+(?:[-_][a-z0-9]+)*$`).
  ```json
  { "capability": "backend" }
  ```
- `GET /agents/:agentId/capabilities` -> List capabilities attached to agent (`200 OK` or `404 Not Found`)
  ```json
  {
    "agentId": "agent-id",
    "capabilities": ["backend", "code-review", "debugging"]
  }
  ```
- `DELETE /agents/:agentId/capabilities/:capability` -> Remove capability from agent (`204 No Content`, `404 Not Found` if agent or capability missing)

### WebSocket Infrastructure (PRD #6)

Real-time transport layer with in-memory connection manager and project room isolation.

- **Endpoint**: `ws://localhost:<PORT>/ws?projectId=<project-id>`
- **Validation**: `projectId` is required and must reference an existing project; missing or invalid project connections are rejected immediately (`400 Bad Request` / `404 Not Found`).
- **Authentication**: Not implemented yet (authentication layer comes in a future PRD).
- **Transport Events**:
  - `ping` -> `{ "type": "ping", "payload": {} }` (Server responds with `{ "type": "pong", "payload": {} }`)
  - `pong` -> `{ "type": "pong", "payload": {} }` (Server updates heartbeat timestamp)
  - `error` -> `{ "type": "error", "payload": { "code": "INVALID_MESSAGE", "message": "Invalid WebSocket message" } }`
- **Heartbeat & Liveness**: 30s server-side ping frame interval for tracking active sockets and terminating stale connections.
- **Room Isolation**: `ConnectionManager.broadcastToProject(projectId, message)` delivers messages strictly to connections belonging to the target project.

### Error Response Format

All API errors return standardized JSON responses:

```json
{
  "error": "VALIDATION_ERROR | NOT_FOUND | FORBIDDEN | CONFLICT | INTERNAL_SERVER_ERROR",
  "message": "Error description message",
  "details": []
}
```

## Database Commands

- **Generate Client**: `pnpm db:generate`
- **Run Migrations**: `pnpm db:migrate`
- **Seed Development Data**: `pnpm db:seed`

## Development Commands

Run all applications and packages concurrently:

```bash
pnpm dev
```

Run specific target applications:

- **Frontend**: `pnpm --filter @agentmesh/web dev` (runs at `http://localhost:5173`)
- **Backend**: `pnpm --filter @agentmesh/server dev` (runs at `http://localhost:3001`)

## Verification & Quality Commands

- **Typecheck**: `pnpm typecheck`
- **Lint**: `pnpm lint`
- **Format**: `pnpm format`
- **Test**: `pnpm test` (includes API and database integration suites)
- **Build**: `pnpm build`
