# AgentMesh

Multiplayer workspace for humans + AI agents.

## Repository Structure

```text
agentmesh/
├── apps/
│   ├── web/            # React + Vite frontend application
│   └── server/         # Express + Node.js TypeScript backend application
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
```

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
- **Test**: `pnpm test`
- **Build**: `pnpm build`

## Health Endpoint

Backend exposes a health check endpoint:

```http
GET /health
```

Expected response (`HTTP 200`):

```json
{
  "status": "ok",
  "service": "agentmesh-server"
}
```
