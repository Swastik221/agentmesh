# INT-1 — Integration Foundation Architecture & Specification

## Objective

The INT-1 Integration Foundation establishes the clean, typed architectural bridge between the AgentMesh React frontend (`apps/web`) and Express/Prisma/x402 backend (`apps/server`).

This foundation ensures:
1. **Isolated Demo Mode:** The judge experience remains 100% deterministic and standalone without requiring real network or database dependencies.
2. **Structured Live Mode:** Full REST API client, WebSocket manager, and SIWE session handler enable production multi-agent collaboration and real Hedera settlement.

---

## 1. Environment & Mode Selection

Application execution mode is controlled via `envConfig` (`apps/web/src/config/env.ts`):

- **Environment Variable:** `VITE_APP_MODE` (`'demo'` | `'live'`). Defaults to `'demo'`.
- **API Origin:** `VITE_API_URL` (defaults to `http://localhost:3001`).
- **WebSocket Origin:** `VITE_WS_URL` (defaults to `ws://localhost:3001`).

```ts
import { setAppMode, getAppMode } from './config/env';

// Inspect or set active mode at runtime:
if (getAppMode() === 'demo') {
  console.log('Running in isolated Demo Mode');
}
```

---

## 2. Adapter Layer & Isolation Strategy

The adapter abstraction (`apps/web/src/adapters/`) decouples UI components from storage and communication implementations:

- **`demoAdapters` (`apps/web/src/adapters/demo/`):**
  Uses in-memory deterministic state, mocked workflow events, and instant local responses. Guaranteed non-blocking and isolated.

- **`liveAdapters` (`apps/web/src/adapters/live/`):**
  Integrates with real HTTP API endpoints (`/projects`, `/tasks`, `/agents`, `/artifacts`, `/approvals`) and WebSocket events.

- **Dynamic Adapter Proxy (`apps/web/src/adapters/index.ts`):**
  All UI components consume `adapters`. Calls automatically route to `liveAdapters` when `VITE_APP_MODE=live` or `demoAdapters` when `VITE_APP_MODE=demo`.

---

## 3. Core Services

### API Client (`apps/web/src/services/api-client.ts`)
- Class `ApiClient` with typed `.get()`, `.post()`, `.put()`, `.patch()`, `.delete()`.
- Automatically passes `credentials: 'include'` to preserve SIWE cookie sessions.
- Throws structured `ApiError` instance containing `status`, `statusText`, `message`, and error payloads.

### WebSocket Boundary (`apps/web/src/services/ws-client.ts`)
- Class `WebSocketClient` for realtime project collaboration (`/ws?projectId=...`).
- Built-in reconnection logic with exponential backoff.
- Status event emitter (`CONNECTED`, `CONNECTING`, `DISCONNECTED`, `RECONNECTING`).
- Pub/Sub typed message dispatcher.

### SIWE Auth Session (`apps/web/src/services/auth-session.ts`)
- Manages Sign-In with Ethereum lifecycle via backend `/auth/*` endpoints:
  - `GET /auth/nonce`
  - `POST /auth/verify`
  - `GET /auth/me`
  - `POST /auth/logout`

---

## 4. Verification

Run the test suite to verify the integration foundation:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm demo:e2e
```
