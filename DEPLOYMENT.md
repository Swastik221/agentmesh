# AgentMesh Production Deployment Runbook & Operational Guide

This document provides complete instructions for deploying, configuring, running, and verifying AgentMesh in production.

---

## 1. System Requirements & Architecture Overview

AgentMesh consists of two primary application tiers:
- **Backend Application (`apps/server`)**: Node.js Express & WebSocket (`ws`) server with Prisma ORM.
- **Frontend Application (`apps/web`)**: React SPA powered by Vite, Tailwind/Vanilla CSS, and Viem/Wagmi/SIWE.
- **Database**: PostgreSQL database.

---

## 2. Environment Configuration

Copy `.env.example` to `.env` in the root workspace directory or configure environment variables in your deployment platform (e.g. Docker, Railway, AWS, Render).

### Mandatory Server Variables
```bash
# Server Network & CORS
PORT=3001
WEB_ORIGIN=https://app.agentmesh.io

# Database
DATABASE_URL="postgresql://user:password@db-host:5432/agentmesh?schema=public"

# SIWE Authentication
SIWE_DOMAIN=app.agentmesh.io
SIWE_URI=https://app.agentmesh.io
SIWE_CHAIN_ID=1

# Hedera x402 Architecture Configuration (Current Supported Deployment: Hedera Testnet + USDC + Official x402 Facilitator)
HEDERA_NETWORK=hedera:testnet
HEDERA_PAYMENT_RECEIVER=0.0.9185802
X402_FACILITATOR_URL=https://x402.org/facilitator
```

### Mandatory Frontend Build Variables (Vite)
```bash
VITE_API_URL=https://api.agentmesh.io
VITE_WS_URL=wss://api.agentmesh.io
```

> [!IMPORTANT]
> **Production Validation**: When `NODE_ENV=production` is set, `apps/server` automatically validates mandatory variables on startup and throws `[ProductionConfigError]` if any required variable is missing.

---

## 3. Deployment Steps

### Step 1: Install Dependencies
```bash
pnpm install --frozen-lockfile
```

### Step 2: Database Migration & Prisma Generation
```bash
# Apply official database migrations
pnpm --filter @agentmesh/server db:deploy

# Generate Prisma Client
pnpm --filter @agentmesh/server db:generate
```

### Step 3: Build Monorepo
```bash
pnpm build
```

### Step 4: Start Backend Application
```bash
pnpm --filter @agentmesh/server start
```

### Step 5: Verify Health Check
```bash
curl -i https://api.agentmesh.io/health
```
Expected HTTP 200 Response:
```json
{
  "status": "ok",
  "service": "agentmesh-server",
  "database": "connected"
}
```

---

## 4. WebSocket & Networking Production Requirements

- **SSL/TLS (`wss://`)**: Production WebSocket connections must use `wss://` protocol behind an Nginx, Cloudflare, or AWS ALB reverse proxy.
- **CORS & Origin Verification**: Ensure `WEB_ORIGIN` matches the exact frontend domain.
- **Connection Teardown & Heartbeats**: Server emits periodic ping frames every 30s. Connections automatically teardown and transition agents to `OFFLINE` upon disconnect.

---

## 5. Manual Final Browser Acceptance Checklist

Automated integration tests verify the underlying backend, authentication, authorization, realtime, agent, artifact, approval, and payment-boundary behavior. The checklist below is the final manual/browser acceptance and must only be checked after those steps are actually performed against the deployed product.

Perform the following manual acceptance checklist in modern Web3 browsers (e.g. Chrome with MetaMask):

### Phase A — User A (Workspace Creator)
- [ ] Open `https://app.agentmesh.io`.
- [ ] Connect real Web3 wallet via MetaMask/Injected Provider.
- [ ] Sign SIWE EIP-4361 authentication message challenge.
- [ ] Verify session cookie established and ENS identity displayed when resolvable.
- [ ] Verify fresh user starts with blank workspace.
- [ ] Create project "Project Alpha".
- [ ] Invite teammate User B by wallet address (`0x...`) or ENS (`bob.eth`).
- [ ] Onboard real AI agent and send protocol `AGENT_HANDSHAKE`. Verify agent status becomes `ONLINE`.

### Phase B — User B (Teammate)
- [ ] Open `https://app.agentmesh.io` in a separate browser profile.
- [ ] Connect different Web3 wallet.
- [ ] Sign SIWE authentication challenge.
- [ ] See pending invitation banner for "Project Alpha".
- [ ] Click **Accept**.
- [ ] Enter shared "Project Alpha" workspace.

### Phase C — Shared Collaboration & Realtime Sync
- [ ] User A creates task "Production Build".
- [ ] User B's UI instantly receives `workspace.delta` realtime WebSocket event.
- [ ] Agent executes task and publishes artifact.
- [ ] Dependency gating evaluates causal provenance.
- [ ] Browser reload restores complete server-persisted state from PostgreSQL.

### Phase D — Paid Capability & Hedera x402 Settlement
- [ ] User requests paid capability execution.
- [ ] Receive HTTP `402 Payment Required` with x402 header.
- [ ] Sign and submit Hedera payment transaction.
- [ ] Verify single authoritative execution result.

> [!NOTE]
> **ENVIRONMENT DEPLOYMENT**: Phase D live Hedera testnet payment signing requires funded Hedera testnet account credentials on the target deployment environment.
