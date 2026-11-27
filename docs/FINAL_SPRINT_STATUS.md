# Final sprint status

Date: 2026-11-27 · Branch: `feat/final-sprint`, from `main` at `44e171f` (PRs #76, #77 and #78 merged). **Nothing is committed or pushed.** Commits, pushes and deploys need explicit authorisation.

Companion docs: [ENGINEERING_AUDIT.md](ENGINEERING_AUDIT.md) (findings `F-xx`), [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md), [MCP_INTEGRATION.md](MCP_INTEGRATION.md), [SECURITY.md](SECURITY.md), [DEPLOYMENT.md](DEPLOYMENT.md).

## Baseline

Taken before any sprint change, on `main` at `44e171f`:

- **Checks:** lint, typecheck and build pass.
- **Tests:** server 588, web 170, protocol 69, CLI 9.
- **Database safety:** verified in code before running anything. `apps/server/vitest.config.ts` and `src/test-support/test-database.ts` resolve to `<db>_test` and refuse any other database. Every test run in this sprint used `agentmesh_test`.

## Status by feature

| Feature | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Agent messaging with intents (ASK, ANSWER, PROPOSE, ACKNOWLEDGE, HANDOFF, BLOCKED, CONFLICT), delivery state, offline queue, dedup, activity record | ✅ Done | `agent-coordination.test.ts` (7) | — |
| Handoff notes as policy-gated `handoff` artifacts, in dependent agents' context | ✅ Done | same, plus the MCP e2e run | — |
| Targeted context-change notifications (assigned, blocked, artifact, handoff, disconnect, conflict) | ✅ Done | same | MCP clients poll `check_inbox` rather than receiving pushes |
| MCP server `agentmesh mcp` (23 tools, official SDK 1.32.2) | ✅ Done | Real SDK client over stdio against a real server: **17/17 checks** (see "MCP end to end") | Not run inside Claude Code or Codex themselves; config documented |
| Agent-side tools: task details, artifact read, own-task status, file activity | ✅ Done | `agent-coordination.test.ts`, MCP e2e | — |
| MCP and connect tokens: 30-day MCP token, revoke-all with immediate disconnect | ✅ Done | `revocation.test.ts` (3) | Token minting and revocation are API-only, not yet in the UI |
| Member removal closes live sockets, terminal subscriptions and agent connections | ✅ Done | `revocation.test.ts` | — |
| One shared realtime socket per workspace; linger; resync; access-loss stop | ✅ Done | `workspaceRealtimeHub.test.ts` (6) | — |
| Canvas: merge instead of reset, saved positions and notes, real edges, terminals node, board blockers and overlaps | ✅ Done | Browser check (see "Browser checks") | Default layout still overlaps the agent cards with the board |
| Live approvals and executions; logout, 401 and wallet-change handling; dead header controls fixed | ✅ Done | typecheck and lint; logout and 401 not driven in the browser | — |
| Hashed session tokens; rate limits; credential purge | ✅ Done | `security-hardening.test.ts` (7) | Rate limits are per process |
| Approve and resume recorded together; race-safe retry; restart reconciliation | ✅ Done | `security-hardening.test.ts` | No retry button in the UI yet (`POST /approvals/:id/retry`) |
| x402 requirement matching the official Hedera facilitator contract | ✅ Done in code | `x402-contract.test.ts` (8) runs the **installed facilitator's own validation** | **No live testnet settlement yet** |
| Pay only for an available agent; only server-issued references; unique transaction; `refundDue` | ✅ Done | `x402-contract.test.ts`, `agent-capability.test.ts` | Refunds are manual |
| Browser payment: base64 header decoding, CORS exposure, honest UI | 🟡 Partial | `PaidCapabilityCard.test.ts` (2) | In-browser Hedera signing not implemented |
| Deployment guards (build refuses without API URLs; https `WEB_ORIGIN` in production) | ✅ Done | Build run with and without the URLs; `production-acceptance.test.ts` | Server not deployed (needs operator access) |
| Human task assignment | ⬜ Not started | — | Next |

## Bugs found and fixed this sprint

1. **`acknowledge_message` would hang for 15 s.** The server sent no reply to an acknowledgement. Added an explicit `agent.coordinate.acked` reply.
2. **File-conflict errors aborted file-activity reports.** The conflict detector throws `FileConflictError`, not `ConflictError`. Now reported as overlaps instead.
3. **Session-creating tests bypassed the service.** Older tests created session rows directly and used row ids as cookies; they now use `sessionService`.
4. **A test asserted a bug as correct.** `agent-capability.test.ts` expected settlement for a disconnected agent (F-06). It now asserts 409 with no charge.

## MCP end to end

The scenario this sprint was asked to prove, run against a real server with the official SDK client:

- **Setup:** isolated server on `:3999` and a throwaway `agentmesh_e2e` database, since dropped. The official `@modelcontextprotocol/sdk` client launched `node apps/cli/bin/agentmesh.js mcp` over stdio with environment credentials, exactly as Claude Code or Codex would.
- **Discovery:** 23 tools listed. The overview showed Codex working on Auth API, the dependency on it, and the contract handoff. A file conflict on `api/contracts` was flagged, and the contract was read.
- **Denials:** the server refused another workspace's artifact and another agent's task.
- **Messaging:** an ASK to Codex while offline was queued, delivered when Codex's own MCP client connected, and answered with structured data. Claude received and acknowledged the answer.
- **Wrap-up:** file activity was recorded, a handoff note published, and the task moved to IN_PROGRESS.

## Browser checks

Run against an isolated server, signed in as Bob with a generated test session:

- **Canvas:** shows "Live", the terminals node lists Alice's shared `claude-code`, and the board shows real statuses, "Waiting on Auth API", and both overlap warnings on `api/contracts/auth.ts`.
- **Edges:** exactly two, each labelled "1 active task".
- **Live updates and layout:** a node dragged to a new position stayed put while a new task arrived live (2 → 3 cards).

## Tests run (final, on the finished code)

`pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm build` ✅ · `pnpm test` ✅ **870 passed**:

| Package | Tests | Files |
| --- | --- | --- |
| Server | 614 | 47 |
| Web | 178 | 15 |
| Protocol | 69 | 11 |
| CLI | 9 | 2 |

**Flake:** `worktree.test.ts`, "removes physical Git worktree", failed once in an earlier full run and passed in 3/3 isolated reruns and in the final run. It looks like a pre-existing git timing flake.

## Migrations added

All additive; applied to local dev and test databases with `prisma migrate deploy`:

- `20261127180000_add_agent_messages`: new table and enums.
- `20261127200000_hash_session_tokens`: nullable `tokenHash` with a unique index. Existing sessions stop working, so **users sign in once again**.
- `20261127210000_approval_resume_state`: columns with defaults.
- `20261127220000_unique_payment_transaction`: unique index. Checked first: the dev database had no duplicate transaction references.

## Files changed

**Server**
- **New:** `src/coordination/agent-coordination.service.ts`, `src/middleware/rate-limit.ts`, `src/test-support/payments.ts`, and the four migrations above.
- **Changed:** `context/workspace-context.service.ts`, `websocket/{coordination.handler,websocket.server,connection.manager}.ts`, `tasks/task.service.ts`, `services/{approval,member,agent-connect-token}.service.ts`, `auth/{session.service,auth.routes}.ts`, `payments/{x402.service,payment.service,payment.config,payment.types}.ts`, `controllers/{agent-capability,agent,approval}.controller.ts`, `routes/{agent,approval,project}.router.ts`, `config/index.ts`, `app.ts`, `server.ts`, `prisma/schema.prisma`, `package.json` (`db:deploy`), `vitest.setup.ts`.
- **Tests:** new `agent-coordination`, `revocation`, `security-hardening` and `x402-contract`, plus `helpers/ws-harness.ts`. Updated `agent-capability`, `auth`, `authz-hardening`, `coordinator`, `payment`, `production-acceptance`, `real-agent-execution-hardening`, `workspace` and `worktree`.

**Protocol**
- `src/coordination.ts`: coordination, handoff, agent-tool and context-change messages.

**CLI**
- **New:** `src/mcp.ts`.
- **Changed:** `bin.ts`, `connect.ts` (`/inbox`, `/reply`, message display), `index.ts`, `package.json` (MCP SDK 1.32.2, zod 3.25.76).

**Web**
- **New:** `components/canvas/nodes/TerminalsNode.tsx`, `utils/paths.ts`, and tests for the realtime hub and payment card.
- **Changed:** `hooks/{useWorkspaceRealtime,useAuth,useApprovals,useExecutions}.ts`, `components/canvas/{WorkspaceCanvas,ToolDock}.tsx`, `nodes/{TaskBoardNode,NoteNode,index}`, `components/layout/Header.tsx`, `components/agents/PaidCapabilityCard.tsx`, `routes/AppRouter.tsx`, `services/api-client.ts`, `config/env.ts`, `App.tsx`, `pages/Workspace/WorkspacesPage.tsx`, `features/workspace/workspace.css`, `vite.config.ts`.
- **Deleted:** `components/canvas/CommandComposer.tsx` (unused fake).

**Docs**
- **New:** `MCP_INTEGRATION.md`, `SECURITY.md`, `DEPLOYMENT.md`, and this file.
- **Updated:** `ENGINEERING_AUDIT.md`, `IMPLEMENTATION_ROADMAP.md`, `README.md`, `.env.example`. Root `DEPLOYMENT.md` now points to `docs/`.

## External blockers

| Blocker | Needed |
| --- | --- |
| Live Hedera testnet settlement | A funded testnet payer, an x402 client that signs Hedera `exact` payments, and a facilitator that supports `hedera:testnet` (the configured `https://x402.org/facilitator` was not contacted) |
| Deployment | Operator access to a Node host and managed Postgres, and to Vercel's environment settings |
| Claude Code and Codex in-app run | Running them consumes the user's accounts. The integration is verified with the official SDK client instead, and configs are documented. |

## Exact next actions

1. Review and commit `feat/final-sprint`; open a PR.
2. Run one live testnet payment (`docs/SECURITY.md` §8, `docs/DEPLOYMENT.md` §6) and record the transaction id here.
3. Add UI for MCP token minting and revocation, and an approval "Retry" button (the APIs exist).
4. Human task assignment (schema: an optional assignee user on `Task`).
5. Deploy per `docs/DEPLOYMENT.md`.
