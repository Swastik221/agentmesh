# INT-1 — Integration Foundation Architecture & Specification

## Objective

The INT-1 Integration Foundation establishes the clean, typed architectural bridge between the AgentMesh React frontend (`apps/web`) and Express/Prisma/x402 backend (`apps/server`).

This foundation ensures:
1. **Isolated Demo Mode:** The judge experience remains 100% deterministic and standalone without requiring real network or database dependencies.
2. **Truthful Live Mode:** Full REST API client, WebSocket manager, and SIWE session handler enable production multi-agent collaboration and real Hedera settlement.

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

### Strict Live Mode Truthfulness Rule (INT-1-C1)
- **Demo Mode** may use deterministic fixtures.
- **Live Mode** NEVER fabricates successful backend results (no fake users `usr_live_*`, no fake addresses `0x402a...`, no fake signatures `0x_live_sig_*`, no fake ENS `developer.eth`, no fake tasks `Claimed Task`, no fake file comments).
- When a Live Mode operation succeeds, it returns the real backend result.
- When a Live Mode operation fails or a backend endpoint is unavailable, it surfaces/throws a real, structured error.
- Live Mode NEVER silently falls back to Demo Mode or invents fake success data.
- Unsupported Live capabilities explicitly throw controlled `Error` instances indicating feature status.

---

## 3. Live Adapter Integration Status Matrix

| Live capability | Frontend method | Backend route/protocol | Status |
| :--- | :--- | :--- | :--- |
| **Session** | `liveAuthAdapter.login/logout/getCurrentUser` | `GET /auth/me`, `POST /auth/logout` | REAL |
| **Wallet connect** | `liveWalletAdapter.connectWallet` | Browser wallet provider (`window.ethereum`) | REAL/PARTIAL |
| **ENS** | `liveWalletAdapter.resolveEns` | `ensService` / viem reverse resolution | REAL/PARTIAL |
| **Projects** | `liveWorkspaceRealtimeAdapter.joinWorkspace` | `GET /projects/:projectId` | REAL |
| **Agents** | `liveAgentConnectionAdapter.getAvailableAgents` | `GET /projects/:projectId/agents` | REAL |
| **Agent connect** | `liveAgentConnectionAdapter.connectAgent/disconnectAgent/announce` | None | UNSUPPORTED UNTIL LATER PRD |
| **Tasks** | `liveTaskProtocolAdapter.getTasks` | `GET /projects/:projectId/tasks` | REAL |
| **Task claim** | `liveTaskProtocolAdapter.submitPrd/claimTask/autoAssignTask` | None | UNSUPPORTED UNTIL LATER PRD |
| **Approvals** | `liveTaskProtocolAdapter.requestApproval/decideApproval` | `POST /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject` | REAL/PARTIAL |
| **Artifact creation** | `liveFileAdapter.publishArtifact` | `POST /projects/:projectId/tasks/:taskId/artifacts` | REAL |
| **File browser** | `liveFileAdapter.getFiles/readFile` | None | UNSUPPORTED UNTIL LATER PRD |
| **Terminal** | `liveTerminalAdapter.createSession/executeCommand` | None | UNSUPPORTED UNTIL LATER PRD |
| **Browser preview** | `liveBrowserPreviewAdapter.getPreview` | None | UNSUPPORTED UNTIL LATER PRD |
| **WebSocket** | `liveWorkspaceRealtimeAdapter.joinWorkspace/subscribe` | `/ws?projectId=...` snapshot & presence protocol | REAL/PARTIAL |

---

## 4. Core Services

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

## 5. Verification

Run the test suite to verify the integration foundation and correctness rules:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm demo:e2e
```
