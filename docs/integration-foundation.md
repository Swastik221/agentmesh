# INT-1 & INT-2 — Real Browser Wallet + SIWE Authentication Specification

## Objective

The INT-2 Real Browser Wallet + SIWE Authentication layer establishes production-quality, end-to-end authentication for AgentMesh:
1. **Isolated Demo Mode:** The judge experience remains 100% deterministic and standalone without requiring real network or database dependencies.
2. **Real Production Live Mode:** Integrates browser wallet providers (`window.ethereum`) with backend SIWE verification (`/auth/nonce`, `/auth/verify`, `/auth/me`, `/auth/logout`) and HTTP-only session cookies (`agentmesh_session`).

---

## 1. Environment & Mode Selection

Application execution mode is controlled via `envConfig` (`apps/web/src/config/env.ts`):

- **Environment Variable:** `VITE_APP_MODE` (`'demo'` | `'live'`). Defaults to `'demo'`.
- **API Origin:** `VITE_API_URL` (defaults to `http://localhost:3001`).
- **WebSocket Origin:** `VITE_WS_URL` (defaults to `ws://localhost:3001`).

```ts
import { setAppMode, getAppMode } from './config/env';

if (getAppMode() === 'demo') {
  console.log('Running in isolated Demo Mode');
}
```

---

## 2. Real SIWE Authentication Lifecycle Flow

The INT-2 SIWE browser authentication flow follows a strict server-authoritative lifecycle:

```text
Browser Wallet (window.ethereum)
               ↓
     1. connectWallet()
               ↓
    Detect account & chainId
               ↓
    2. fetchNonce() ────► GET /auth/nonce ───► Backend generates & stores nonce
               ↓
    Construct SIWE Message (domain, address, URI, chainId, nonce, issuedAt)
               ↓
    3. personal_sign ───► Wallet prompts user to sign
               ↓
    4. verifySiwe() ────► POST /auth/verify ──► Backend verifies SIWE & sets HTTP-only cookie
               ↓
    5. fetchSession() ──► GET /auth/me ─────► Backend returns authenticated user
               ↓
    6. Protected API ───► GET /projects ────► Backend accepts authenticated session cookie
```

### Critical Identity Distinction
- **Wallet Connected:** The browser extension (`window.ethereum`) has granted account access (`eth_requestAccounts`). The user's address is known to the client, but **no backend session exists yet**.
- **Backend Authenticated:** The user signed a server-issued SIWE nonce, the backend verified the cryptographic signature, created a session in PostgreSQL, and issued an `agentmesh_session` HTTP-only cookie. Protected API requests (`/projects`, `/agents`, `/tasks`) are authorized.

---

## 3. Live Adapter Integration Status Matrix

| Live capability | Frontend method | Backend route/protocol | Status |
| :--- | :--- | :--- | :--- |
| **Session** | `liveAuthAdapter.login/logout/getCurrentUser` | `GET /auth/me`, `POST /auth/logout` | REAL |
| **Wallet connect** | `liveWalletAdapter.connectWallet` | Browser wallet provider (`window.ethereum`) | REAL |
| **SIWE Authentication** | `authSessionService.verifySiwe` | `GET /auth/nonce`, `POST /auth/verify` | REAL |
| **ENS** | `liveWalletAdapter.resolveEns` | `ensService` / viem reverse resolution | REAL/PARTIAL |
| **Projects** | `liveWorkspaceRealtimeAdapter.joinWorkspace` | `GET /projects/:projectId` | REAL |
| **Agents** | `liveAgentConnectionAdapter.getAvailableAgents` | `GET /projects/:projectId/agents` | REAL |
| **Agent connect** | `liveAgentConnectionAdapter.connectAgent/disconnectAgent/announce` | None | UNSUPPORTED UNTIL INT-3 |
| **Tasks** | `liveTaskProtocolAdapter.getTasks` | `GET /projects/:projectId/tasks` | REAL |
| **Task claim** | `liveTaskProtocolAdapter.submitPrd/claimTask/autoAssignTask` | None | UNSUPPORTED UNTIL INT-4 |
| **Approvals** | `liveTaskProtocolAdapter.requestApproval/decideApproval` | `POST /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject` | REAL/PARTIAL |
| **Approval signing** | `liveWalletAdapter.signApproval` | None | UNSUPPORTED UNTIL INT-5 |
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
