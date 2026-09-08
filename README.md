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
- **Test**: `pnpm test` (includes PostgreSQL integration suite)
- **Build**: `pnpm build`

## Health Endpoint

Backend exposes a health check endpoint verifying application and database connectivity:

```http
GET /health
```

Expected response (`HTTP 200`):

```json
{
  "status": "ok",
  "service": "agentmesh-server",
  "database": "connected"
}
```

## Public landing page

The marketing page is available at `http://localhost:5173/` (including
`/#workspace` for the interactive preview). The workspace shell is available at
`/canvas`. Both routes use the frontend command above; the marketing page
does not require the backend, database, wallet, or provider credentials.

The landing page opens with a scroll-driven SVG coder connection, then reveals
its headline and one shared React Flow canvas. Named cursors grab and carry
Orion and Vega, release them to claim tasks, and exchange an illustrative schema.
The entire sequence reverses with scrolling. Manual node dragging becomes
available at completion; reduced motion displays the completed workspace.
Five topic-specific vector scenes follow, with approval controls and FAQ content.
All examples are local previews; no backend or wallet is required.

Run the timeline checks with Node 22.6 or later:

```bash
node --experimental-strip-types --test apps/web/tests/workspace-timeline.test.mjs
```

See `docs/landing-page.md` for implementation and verification notes.
