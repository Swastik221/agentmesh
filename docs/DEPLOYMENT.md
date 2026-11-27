# Deploying AgentMesh

AgentMesh is three deployables:

| Part | What | Hosting needs |
| --- | --- | --- |
| `apps/server` | Express API and WebSocket hub (same port), Prisma | A long-running Node 20+ process with WebSocket upgrades (Render, Railway, Fly.io, a VM, a container). **Not** a serverless function. |
| PostgreSQL 16 | System of record | Any managed Postgres |
| `apps/web` | Static React SPA (Vite) | Any static host (Vercel, Netlify, S3+CDN) with SPA fallback to `index.html` |

The CLI (`apps/cli`) runs on developers' machines and is not deployed.

> Nothing in this repository deploys automatically. Each step below is run by an operator with access to the target accounts.

## 1. Environments

| | Local | Tests | Staging / Production |
| --- | --- | --- | --- |
| Config source | `.env` from `.env.example` | Derived automatically (`<db>_test`) | Host secret store |
| `NODE_ENV` | unset | test | `production` |
| `WEB_ORIGIN` | `http://localhost:5173` | default | `https://app.example.com` (required, https) |
| Database | local `agentmesh` | `agentmesh_test` (the test run refuses any database not ending in `_test`) | managed Postgres |
| Web API URLs | `VITE_API_URL=http://localhost:3001` | n/a | `https://api.example.com`, `wss://api.example.com` (required) |

## 2. Server environment

Required in production (startup fails without them):

| Variable | Example | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Enables production validation and Secure cookies |
| `WEB_ORIGIN` | `https://app.example.com` | Must be https. Used for CORS, the WebSocket Origin check, and the default SIWE domain. |
| `DATABASE_URL` | `postgresql://…` | |
| `SIWE_DOMAIN` | `app.example.com` | Host (and port, if any) of the web origin |
| `SIWE_URI` | `https://app.example.com` | |
| `HEDERA_NETWORK` | `hedera:testnet` | Only testnet is accepted |
| `HEDERA_PAYMENT_RECEIVER` | `0.0.x` | Account that receives payments. No key is needed or stored. |
| `X402_FACILITATOR_URL` | `https://x402.org/facilitator` | Must support `exact` on `hedera:testnet` and advertise a fee payer |

Recommended:

| Variable | Notes |
| --- | --- |
| `TRUST_PROXY=1` | When behind a load balancer, so rate limits and Secure cookies see the real client |
| `PORT` | Defaults to 3001 |
| `SIWE_CHAIN_ID` | Defaults to 11155111 (Sepolia) |
| `ENS_RPC_URL`, `ENS_CHAIN_ID` | Your own RPC endpoint rather than a public one |
| `WORKSPACE_ROOT` | Absolute path for per-project git workspaces. Needs persistent disk if executions use worktrees. |
| `RATE_LIMIT_*_PER_MIN` | See `.env.example` |

## 3. Server: build, migrate, run

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm --filter @agentmesh/server db:deploy      # prisma migrate deploy: applies pending migrations, never resets
pnpm --filter @agentmesh/server build
pnpm --filter @agentmesh/server start          # node dist/server.js
```

Run `db:deploy` as a release step before starting new instances. All migrations in this repository are additive.

At startup the server:

- marks terminal sessions that were live as DISCONNECTED, so CLIs resume them;
- marks approval resumes that were interrupted as FAILED, so they can be retried by hand;
- starts the offer sweeper and the expired-credential purge.

On `SIGTERM` it closes WebSockets and the HTTP server cleanly.

**Health check:** `GET /health` returns `{"status":"ok","database":"connected"}` with 200, and 503 if the database is unreachable.

**WebSockets:** served on the same port at `/ws`. The load balancer must allow `Upgrade` and should use an idle timeout above 60 s (the server pings every 30 s). Sticky sessions are not required for correctness, but realtime fan-out and terminal buffers are per instance. **Run a single server instance** until a shared pub/sub is added.

## 4. Web: build and host

Set at build time:

```bash
VITE_API_URL=https://api.example.com
VITE_WS_URL=wss://api.example.com
AGENTMESH_REQUIRE_API_URL=true     # makes the build fail if the two above are missing or localhost
pnpm --filter @agentmesh/web build # output: apps/web/dist
```

On Vercel production builds the check runs automatically. Configure the host to serve `index.html` for unknown paths (SPA routing). A production bundle built without `VITE_API_URL` shows a "not connected to a server" screen instead of calling localhost.

**Cookies across origins:** the session cookie is `SameSite=Lax`. Serve the web app and the API from the same site (for example `app.example.com` and `api.example.com`), or sign-in cookies will not be sent with API requests.

## 5. Verify a deployment

1. `curl -i https://api.example.com/health` returns 200.
2. Open the web app. It shows the landing page, not the "not connected" screen.
3. Sign in with a wallet. `GET /auth/me` returns 200 in the browser's network tab, and the cookie is `Secure`.
4. Open a workspace. The header shows **Live** (the WebSocket connected through the load balancer).
5. From a developer machine: `agentmesh context --url https://api.example.com …` prints the workspace.

## 6. What is not automated

- No Dockerfile or infrastructure-as-code is included yet.
- No shared rate-limit or pub/sub store, so run one instance.
- Live x402 settlement needs a facilitator that supports Hedera testnet and a funded testnet payer. Verify it with a real testnet payment before advertising paid capabilities.
