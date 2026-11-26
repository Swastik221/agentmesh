# AgentMesh implementation roadmap: the shared development canvas

Date: 2026-11-27. Companion to [ENGINEERING_AUDIT.md](ENGINEERING_AUDIT.md) (finding ids `F-xx` refer to it).

The target: a team opens one AgentMesh workspace; each developer connects their own terminal and their own coding agent from their own machine; everyone sees their own terminals and teammates' explicitly shared ones read-only; work is distributed on a shared task board; and every agent can find out what the others are doing, where, and what it depends on, without a human relaying context.

## Mapping the vision onto what exists

| Capability | Reuse | Fix | Extend | New |
| --- | --- | --- | --- | --- |
| Workspace + membership | Projects, invitations, join codes, SIWE sessions | Role enforcement (done, PR #76) | Drop sockets on member removal (F-26) | — |
| Agent identity + connection | Agents, connect tokens, handshake | Handshake race (done), token expiry (done) | Connection roles (done) | — |
| Connected terminals | WebSocket hub, envelope, activity | — | — | Terminal sessions, CLI connector, read-only viewer (done) |
| Shared task board | Tasks, coordinator, dependencies, offers, executions | Refetch unmount (done); live approvals/executions (F-19) | Board on the canvas with real edges (F-21) | — |
| Agent awareness | Connector's per-task workspace context, project brain | — | Queryable context with overlaps (done) | `agentmesh context`, Awareness view (done) |
| Coordination + handoffs | `agent.message`, artifacts, dependencies, review gate | Approval/resume atomicity (F-18) | Typed handoff notes on artifacts | — |
| Payments | 402 challenge, server pricing, testnet guard | Facilitator fee payer (F-05), pay-after-availability (F-06) | Wallet signing in the UI (F-11) | Refunds |

## Phases

Status: ✅ done and verified · 🟡 partly done · ⬜ not started.

### Phase 1: stabilisation ✅ (critical items) / 🟡 (rest)

- ✅ Role-based authorization for members, policies, approvals; membership checks on activity and capabilities; payment reference binding; task status guard; WS Origin check and size caps (PR #76).
- ✅ Handshake race that could hang the CLI (F-04).
- ✅ Task board / agent list unmount on refetch (F-12).
- ✅ Stale README and dead `demo:e2e:live` script (F-28).
- ⬜ Rate limiting, hashed session tokens, nonce cleanup (F-16, F-17).
- ⬜ Separate test database from the dev database (F-27). **Until then, running `pnpm test` empties the database in `.env`.**

### Phase 2: canvas foundation 🟡

- ✅ Workspace sections for Terminals and Awareness, sharing the existing realtime socket via a new `onMessage`/`send` on `useWorkspaceRealtime`.
- ⬜ One realtime socket per workspace instead of per view (F-23).
- ⬜ Canvas nodes for terminals and the task board backed by live data; remove fake edges and unrenderable dock nodes (F-21).

### Phase 3: local terminal connection ✅

- ✅ `TerminalSession` model and migration (metadata only).
- ✅ Protocol: `terminal.open/opened/output/update/close/subscribe/unsubscribe/snapshot/session.changed/revoked`, explicit refusal of `terminal.input`.
- ✅ Server: ownership-checked output, private by default, read-only sharing, immediate revocation, bounded in-memory buffer, rate cap, redaction, duplicate-message drop, disconnect/resume, restart reconciliation, audit activity.
- ✅ CLI: `agentmesh terminal` with a real PTY via `script(1)`, resume on reconnect, owner notified of UI changes.
- ✅ Web: list, watch (xterm.js, read-only), share/unshare/disconnect for owners.
- ⬜ Windows support (no `script(1)`; needs ConPTY or `node-pty`).
- ⬜ Optional per-session or per-member sharing (today SHARED means every project member).

### Phase 4: shared task board 🟡

- ✅ Board backed by real tasks, assignment, dependencies, offers and executions (pre-existing), with the unmount fix.
- ⬜ Live approvals and executions started by others (F-19).
- ⬜ Assign to a human developer, not only to an agent.
- ⬜ Show blocked/overlap state from the context service on board cards.

### Phase 5: agent awareness ✅

- ✅ `workspace.context` over the protocol, REST for humans, `agentmesh context` (text and `--json`), Awareness view.
- ✅ Overlap detection: shared files (with directory containment), same task held by another agent, unfinished upstream work.
- ⬜ An MCP server wrapping `agentmesh context` so Claude Code / Codex can call it as a tool rather than a shell command.
- ⬜ Push context changes to connected agents (today agents pull, and get it with each task).

### Phase 6: coordination and handoffs ⬜

- Structured handoff notes attached to artifacts (API contract, assumptions, open questions) and surfaced in the consumer's context.
- Agent-to-agent requests over `agent.message` with typed intents (ask, propose contract, ack), recorded as activity.
- Atomic approve-and-resume (F-18).

### Phase 7: integration and hardening 🟡

- ✅ Two-developer, two-agent integration tests (`apps/server/src/__tests__/shared-canvas.test.ts`) and CLI end-to-end run.
- ⬜ Payments: fix the facilitator integration (F-05), take payment only when the agent can run (F-06), unique transaction references (F-25), UI signing (F-11).
- ⬜ Deploy the server; configure the web build (F-10).
- ⬜ Logout/401 handling, role-aware controls (F-20, F-22).

## Dependencies between the remaining work

```
F-27 test DB isolation ──► everything (safe local development)
F-10 deploy server ───────► any hosted demo
F-23 one socket per workspace ──► canvas nodes (Phase 2) ──► board-on-canvas (Phase 4)
F-05 facilitator fix ──► F-06 pay-after-availability ──► F-11 UI signing
Context push (Phase 5) ──► handoff notes in context (Phase 6)
```

## Next three pieces of work, in order

1. Isolate the test database (small, protects developers' data).
2. Fix x402 settlement and the pay-before-availability ordering, with a test against the real facilitator interface.
3. One realtime socket per workspace, then put live terminals and the board on the canvas.
