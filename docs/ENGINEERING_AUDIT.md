# AgentMesh engineering audit

Date: 2026-11-27. Branch: `feat/shared-canvas` (built on `fix/authz-hardening`, PR #76).

This audit covers the whole monorepo: server, web, CLI, protocol package, database, realtime layer, and the Web3 integrations (SIWE, ENS, Hedera x402). It was done by reading the code paths end to end, running every check the repository has, writing integration tests for the multi-user scenarios, and driving the real CLI and web app against an isolated server and database.

Every finding is labelled:

- **Verified bug**: reproduced, or confirmed by reading the exact code path, citing the file.
- **Potential risk**: a weakness that needs a specific condition to bite.
- **Missing feature**: something the product claims or needs that does not exist.

Status is **Fixed (PR #76)**, **Fixed (this branch)**, or **Open**.

---

## 1. Architecture as it exists

```
Browser (React 19 + Vite)            Developer machine (agentmesh CLI)
   │  REST (cookie session)              │  WebSocket (agent connect token / resume token)
   │  WebSocket (cookie, clientType=user)│  roles: executor | terminal | observer
   ▼                                     ▼
Express API ──────────────── WebSocket hub (ws, /ws?projectId=…)
   │  routes → controllers → services       │  handshake, messaging, deltas, terminals, context
   ▼                                        ▼
Prisma → PostgreSQL (system of record)   in-memory: connections, terminal buffers, delta replay
   │
   ├─ git worktree per execution (apps/server/workspaces/…)
   └─ x402 facilitator (Hedera testnet) for paid capabilities
```

Request lifecycle for the core loop: a human creates a task (REST) → the coordinator scores agents by capability and assigns it, transactionally → policy is evaluated (ALLOW / APPROVAL_REQUIRED / DENY) → an execution is created → the connector sends `task.request` with dependency artifacts and workspace context to the agent's **executor** connection → the CLI accepts, runs the adapter in the execution's worktree, streams progress, publishes artifacts → artifacts enter human review → completion unblocks dependent tasks → every step is recorded as activity and broadcast as a sequenced workspace delta.

Packages:

| Package | Role |
| --- | --- |
| `apps/server` | Express + `ws` + Prisma. System of record and the only authority on permissions. |
| `apps/web` | React UI. All data through live adapters (`adapters/live/*`). |
| `apps/cli` | `agentmesh connect / terminal / context`. Runs on the developer's machine. |
| `packages/agent-protocol` | Zod-validated envelope, core messages, coordination (terminal/context) messages, secret redaction. |
| `packages/shared`, `packages/ui`, `packages/config` | DTOs, UI primitives, tsconfig. |
| `contracts/`, `scripts/` | Empty placeholders. |

## 2. What was already working (verified)

- SIWE sign-in: CSPRNG nonce, 5-minute expiry, consumed atomically after signature verification; exact domain/URI/chainId checks; lowercase-normalised unique wallet addresses; httpOnly cookie sessions with server-side expiry.
- Projects, invitations (owner/admin only), join codes (owner only), membership.
- Agent registration, ownership, capabilities, connect tokens (SHA-256 hashed, 10-minute TTL, re-checked membership at handshake).
- Tasks, dependencies (task and artifact), coordinator auto-assignment with explanations, file-conflict detection, offers and claims.
- Executions with a fixed state table, per-execution git worktrees with symlink-escape guards.
- Artifacts with content hashing and a human review gate; dependency handoff of artifact payloads to the consuming agent.
- Policies and approval requests; approval resumes the blocked action.
- Realtime: sequenced workspace deltas, gap detection, resync with snapshot, presence.
- Web: sign-in and session restore, workspaces page, task board, agents, files, team, activity — all wired to real endpoints with matching shapes (one dead call, see F-21).
- ENS: ENSIP-15 normalisation, reverse records forward-verified, graceful RPC failure.

## 3. Findings

### Critical

| ID | Finding | Type | Status |
| --- | --- | --- | --- |
| F-01 | **Any member could make themselves OWNER** and remove the project creator: add/update/remove member only checked membership (`services/member.service.ts`). | Verified bug | Fixed (PR #76) |
| F-02 | **Self-approval bypassed policy.** Any member could create an approval request and approve it; approving runs the action with policy bypassed (`services/approval.service.ts`). Policies themselves were member-editable. | Verified bug | Fixed (PR #76) |
| F-03 | **Cross-project data exposure.** Activity feed (including payment payloads) readable by any signed-in user; agent capability endpoints had no authorization at all. | Verified bug | Fixed (PR #76) |
| F-04 | **CLI handshake could be lost.** The WebSocket server attached its `message` listener only after an `await` that resolves the connect token, so a handshake sent on `open` (what the CLI does) could be dropped and the CLI hang. No existing test connected with a connect token. | Verified bug | Fixed (this branch): listener attached synchronously, messages queued until the token resolves. |

### High

| ID | Finding | Type | Status |
| --- | --- | --- | --- |
| F-05 | **Hedera settlement cannot succeed through the official facilitator.** The requirement sets `extra.feePayer` to the payment receiver (`payments/x402.service.ts`); the installed `@x402/hedera` facilitator rejects any fee payer it does not manage (`fee_payer_not_managed_by_facilitator`). The 402 header also advertises non-standard fields. Confirmed against the installed library; not testable live here (no Hedera credentials). | Verified bug | Open |
| F-06 | **Payment settles before the agent-online check.** If the agent is offline the execution fails, the payment stays bound to that failed execution, and there is no retry or refund path. | Verified bug | Open |
| F-07 | **Client-chosen payment reference was not bound to its project/requester/agent**, so a known settled reference returned another project's execution output. | Verified bug | Fixed (PR #76) |
| F-08 | **Task status could be set to anything by PATCH**, including completing a task waiting for approval. | Verified bug | Fixed (PR #76): hand-set PENDING_APPROVAL refused; leaving it only by cancelling; COMPLETED/CANCELLED final. |
| F-09 | **Connect tokens expire after 10 minutes, breaking reconnect** for any long-lived connector. | Verified bug | Fixed (this branch): rotating 12-hour resume token returned on each accepted handshake; membership and ownership still re-checked on every handshake. |
| F-10 | **Production web build points at `localhost:3001`.** The Vercel build has no `VITE_API_URL`; the server is not deployed. | Verified bug (deployment) | Open |
| F-11 | **Web UI cannot pay.** `PaidCapabilityCard` stops at wallet signing, parses a base64 header as JSON, and CORS does not expose the header. | Verified bug | Open |
| F-12 | **Task board and agent list unmounted on every refetch**, wiping in-progress UI state and flickering on teammates' changes. | Verified bug | Fixed (this branch) |
| F-13 | **Canvas "terminal" was fake.** `TerminalNode` showed a hardcoded prompt; the terminal adapter threw. | Missing feature | Fixed (this branch): replaced by real connected terminals (section 6). |

### Medium

| ID | Finding | Type | Status |
| --- | --- | --- | --- |
| F-14 | WebSocket upgrade had no Origin check; session ids accepted in the query string. | Potential risk | Fixed (PR #76): browser Origin must match `WEB_ORIGIN`; `?token=` refused in production. |
| F-15 | No body/message size limits (10 MB JSON, 100 MB WS default). | Potential risk | Fixed (PR #76): 2 MB each. |
| F-16 | No rate limiting anywhere (`/auth/nonce`, SIWE verify); expired SIWE nonces never deleted. | Missing feature | Open |
| F-17 | Session ids are Prisma `cuid()`s stored in plaintext (connect tokens, by contrast, are hashed). | Potential risk | Open |
| F-18 | Approval status and resumed action are not atomic: if the resume throws, the request stays APPROVED with nothing executed. | Verified bug | Open |
| F-19 | Approvals and executions created by others do not appear live in the web UI (unhandled event types; polling only when non-empty). | Verified bug | Open |
| F-20 | Logout does not leave protected pages; a 401 mid-session never redirects. | Verified bug | Open |
| F-21 | Canvas tool dock adds node types the canvas cannot render; nodes reset on every data change; edges drawn from board to every agent regardless of assignment. | Verified bug | Open |
| F-22 | Owner-only actions (join code, invite, approve own request) offered to plain members; the server refuses them correctly. | Verified bug (UX) | Open |
| F-23 | One WebSocket per web view, so switching views makes presence flap for teammates. | Potential risk | Open |
| F-24 | ENS-based invite resolves through a single public RPC; a wrong resolution sends access to an unintended wallet. | Potential risk | Open |
| F-25 | Payment replay under a *new* reference is prevented only by Hedera's duplicate-transaction rejection; `transactionReference` is not unique. | Potential risk | Open |
| F-26 | Removing a member does not drop their open WebSocket connections or terminal subscriptions. | Potential risk | Open |
| F-27 | The local test suite runs against `DATABASE_URL` and deletes all rows, so running tests wipes the developer's dev database. | Potential risk | Open |

### Low

| ID | Finding | Type | Status |
| --- | --- | --- | --- |
| F-28 | README described a removed demo mode (`/demo/run`, "Run AgentMesh Demo", `pnpm demo:e2e:live` pointing at a deleted file) and placeholder deploy links. | Verified bug (docs) | Fixed (this branch) |
| F-29 | Header "Presence" / "Notes" buttons dispatch events nothing listens to; `MultiplayerCursors` renders nothing. | Verified bug | Open |
| F-30 | Dead code: `services/ws-client.ts` (wrong URL), `wallet.adapter.resolveEns` (no route), unused mock data in `data/workspace.ts`, file/browser-preview stub adapters. | Missing feature / cleanup | Open |
| F-31 | Wallet `accountsChanged` clears client state but leaves the old server session valid. | Verified bug | Open |
| F-32 | `x402ResourceServer` and `ExactHederaScheme` are constructed but never used. | Cleanup | Open |

## 4. Frontend ↔ backend integration

Every REST call in `apps/web/src/adapters/live` and `hooks` resolves to a real route with a matching response shape, except `wallet.adapter.resolveEns` (unused). The gaps are in reaction to events (F-19), lifecycle (F-20), the canvas (F-21), and controls that do nothing (F-29). New in this branch: the realtime hook exposes `onMessage` and `send`, used by the Terminals and Awareness views, so they share the existing per-view socket rather than opening more.

## 5. Blockchain and Web3

| Integration | Real? | Notes |
| --- | --- | --- |
| SIWE | Real, sound | Nonce single-use and atomic, exact domain/URI/chain checks, expiry and not-before enforced by `siwe`. Gaps: F-16, F-17, F-31. |
| ENS | Real | Normalised; reverse names forward-verified; display identity plus invite-by-ENS. Agent ENS "ownership" means "currently resolves to the wallet" and is never re-checked (Low). |
| x402 / Hedera | Partially real | The 402 challenge, server-authoritative price, server-controlled receiver and hard testnet guard are real, and nothing fabricates success. Settlement through the official facilitator cannot work as written (F-05); the UI cannot sign (F-11); no refund path (F-06). Tests mock `verifyAndSettle`, so **no real on-chain settlement has been demonstrated by this codebase's tests**. |

Classification the brief asked for: there is no frontend-only fake settlement and no locally mocked payment in production code; facilitator-verified settlement is the intended path but is currently blocked by F-05.

Blockchain is used where it adds value (wallet identity, ENS names, per-call payments). Coordination data (tasks, terminals, context) stays off-chain, which is correct.

## 6. Shared-canvas implementation added in this branch

**Connected terminals** (`apps/server/src/terminals`, `apps/cli/src/terminal.ts`, web `TerminalsView`):

- `agentmesh terminal -- <command>` runs the command in a real pseudo-terminal via `script(1)` (no native dependency); the developer's keyboard goes only to their local process.
- Private by default. Sharing is read-only and enforced server-side: only the connection that opened a session can write output, `terminal.input` is refused explicitly, viewers must be project members, and making a session private revokes every other viewer immediately.
- Output is never written to the database; it lives in a 64 KB per-session in-memory buffer (dropped on close or 10 minutes after disconnect), with a 256 KB/s per-session forwarding cap.
- Secrets are redacted (common token formats, `*_KEY=`/`PASSWORD=` assignments, URL credentials, private keys) in the CLI before output leaves the machine and again on the server, including the session's command line. Best effort; documented as such.
- Disconnects mark the session DISCONNECTED; the CLI resumes the same session with its resume token. A client cannot resume someone else's session. Server restart reconciles ACTIVE sessions to DISCONNECTED.
- Share, unshare and disconnect are recorded as activity events (auditable permission changes).

**Agent awareness** (`apps/server/src/context`, `agentmesh context`, web `AwarenessView`):

- A structured, bounded, metadata-only context: other agents with owners (ENS name if verified), capabilities, online state and current tasks with files; open tasks with dependencies and blocked state; recent artifacts; active worktrees (branch, not server path); shared terminals; project decisions; and **overlaps** — file overlaps (including directory containment), the same task held by another agent, and unfinished upstream work held by another agent — each with a sentence explaining it.
- Available to agents over the protocol (`workspace.context.request`), to humans over REST, and from the CLI (`--json` for machines). Private terminals of others never appear.

**Connection roles**: handshakes declare `executor` (default), `terminal` or `observer`; only executors receive tasks or count toward an agent's online status, so a terminal and context queries can run alongside a working agent without being mistaken for one.

## 7. Scenario verification

| # | Scenario | How verified | Result |
| --- | --- | --- | --- |
| 1 | Two developers join the same workspace | Existing `multiplayer-workspace` tests; `shared-canvas` fixture | Pass |
| 2 | Both connect independent agents | `shared-canvas.test.ts` (real WS, connect tokens) | Pass |
| 3 | Both agents visible | Context lists the other agent, owner, capabilities, online | Pass |
| 4 | A developer creates and assigns a task | REST create + responsibility in test | Pass |
| 5 | The assigned agent receives it | Existing `connector` / `real-agent-*` tests | Pass |
| 6 | The other agent discovers that work | Context shows the task, its files, and flags the overlap | Pass |
| 7 | Agents exchange context/artifacts | Existing artifact-exchange tests; handoff overlap in context | Pass |
| 8 | Progress visible to both developers | Existing delta/realtime tests | Pass |
| 9 | Agent disconnects and reconnects | Terminal resume with resume token after the connect token is unused | Pass |
| 10 | Unauthorised access denied | Private terminal invisible to teammates; outsiders 403 on terminals, context, activity, capabilities | Pass |

Beyond tests: the built CLI was run against an isolated server and database (12/12 end-to-end checks: context output, shared terminal listing and output, redaction, unshare from the UI revoking access and notifying the CLI, session closing with the command), the PTY path was exercised (`tty` reported a real device), and the web Terminals and Awareness views were driven in a browser as two different users.

## 8. Test and build results

Run on this branch with PostgreSQL 16 locally:

| Check | Result |
| --- | --- |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | **828 passed**: server 580 (42 files), web 170 (13), protocol 69 (11), CLI 9 (2) |
| `pnpm build` | Pass |
| Migrations | Applied cleanly; schema has no drift from migrations |

Not run: live Hedera settlement (no credentials), live ENS resolution against mainnet in tests (mocked), browser test scripts in `apps/web/tests/*.browser.mjs` (manual, not in CI).

## 9. Recommended priorities

1. Fix x402 settlement (F-05) against the facilitator's advertised fee payer, then check agent availability before taking payment (F-06) and add a unique `transactionReference` (F-25).
2. Deploy the server and set `VITE_API_URL`/`VITE_WS_URL` for the web build (F-10).
3. Rate limiting and hashed session tokens (F-16, F-17); drop sockets and subscriptions when membership is removed (F-26).
4. Make approval + resume atomic (F-18).
5. Web: live approvals/executions (F-19), logout and 401 handling (F-20), role-aware controls (F-22), one shared realtime socket per workspace (F-23), and replace the canvas's fake edges and non-rendering dock nodes (F-21).
6. Separate the test database from the dev database (F-27).
