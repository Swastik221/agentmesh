# Real Browser Wallet + SIWE Authentication Specification

## Objective

The Real Browser Wallet + SIWE Authentication layer establishes production-quality, end-to-end authentication for AgentMesh:
Integrates browser wallet providers (`window.ethereum`) with backend SIWE verification (`/auth/nonce`, `/auth/verify`, `/auth/me`, `/auth/logout`) and HTTP-only session cookies (`agentmesh_session`).

---

## 1. Environment & Mode Selection

Application configuration is managed via `envConfig` (`apps/web/src/config/env.ts`):

- **API Origin:** `VITE_API_URL` (defaults to `http://localhost:3001`).
- **WebSocket Origin:** `VITE_WS_URL` (defaults to `ws://localhost:3001`).

---

## 2. Real SIWE Authentication Lifecycle Flow

The SIWE browser authentication flow follows a strict server-authoritative lifecycle:

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
| **ENS** | `liveWalletAdapter.resolveEns` | `ensService` / viem reverse resolution | REAL |
| **Projects** | `liveWorkspaceRealtimeAdapter.joinWorkspace` | `GET /projects/:projectId` | REAL |
| **Agents** | `liveAgentConnectionAdapter.getAvailableAgents` | `GET /projects/:projectId/agents` | REAL |
| **Tasks** | `liveTaskProtocolAdapter.getTasks` | `GET /projects/:projectId/tasks` | REAL |
| **Approvals** | `liveTaskProtocolAdapter.requestApproval/decideApproval` | `POST /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject` | REAL |
| **Artifact creation** | `liveFileAdapter.publishArtifact` | `POST /projects/:projectId/tasks/:taskId/artifacts` | REAL |
| **WebSocket** | `liveWorkspaceRealtimeAdapter.joinWorkspace/subscribe` | `/ws?projectId=...` snapshot & presence protocol | REAL |

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
