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
- ✅ Rate limiting, hashed session tokens, credential cleanup (F-16, F-17). *(final sprint)*
- ✅ Test database isolated from the dev database (F-27, PR #78).

### Phase 2: canvas foundation 🟡

- ✅ Workspace sections for Terminals and Awareness, sharing the existing realtime socket via a new `onMessage`/`send` on `useWorkspaceRealtime`.
- ✅ One shared realtime socket per workspace, lingering across view switches (F-23). *(final sprint)*
- ✅ Canvas: terminals node, board with real status/blockers/overlaps, edges only from real assignments, positions and private notes kept, no unrenderable nodes (F-21). *(final sprint)*

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
- ✅ Live approvals and executions started by others (F-19). *(final sprint)*
- ⬜ Assign to a human developer, not only to an agent.
- ✅ Blocked and overlap warnings on board cards. *(final sprint)*

### Phase 5: agent awareness ✅

- ✅ `workspace.context` over the protocol, REST for humans, `agentmesh context` (text and `--json`), Awareness view.
- ✅ Overlap detection: shared files (with directory containment), same task held by another agent, unfinished upstream work.
- ✅ `agentmesh mcp`: 23 tools over the official MCP SDK, verified with a real SDK client (docs/MCP_INTEGRATION.md). *(final sprint)*
- ✅ Targeted `workspace.context.changed` notifications (assignment, blocked, artifact, handoff, disconnect, conflict). *(final sprint)*
- ⬜ MCP clients still poll (`check_inbox`); a push channel to the coding agent is next.

### Phase 6: coordination and handoffs ✅

- ✅ Structured messages with intents, delivery state, offline queueing, dedup and activity records. *(final sprint)*
- ✅ Handoff notes as policy-gated `handoff` artifacts, surfaced in dependent agents' context. *(final sprint)*
- ✅ Atomic approve-and-resume with explicit retry (F-18). *(final sprint)*

### Phase 7: integration and hardening 🟡

- ✅ Two-developer, two-agent integration tests (`apps/server/src/__tests__/shared-canvas.test.ts`) and CLI end-to-end run.
- 🟡 Payments: facilitator contract fixed and tested (F-05), availability before charging (F-06), unique transactions (F-25). Still open: a live testnet settlement, mirror-node confirmation, UI signing (F-11).
- 🟡 Deployment guide and build guards done (docs/DEPLOYMENT.md); the server is not deployed (needs operator access).
- ✅ Logout, 401 and wallet-change handling (F-20); 🟡 role-aware controls partly done (F-22).

## Dependencies between the remaining work

```
F-27 test DB isolation ──► everything (safe local development)
F-10 deploy server ───────► any hosted demo
F-23 one socket per workspace ──► canvas nodes (Phase 2) ──► board-on-canvas (Phase 4)
F-05 facilitator fix ──► F-06 pay-after-availability ──► F-11 UI signing
Context push (Phase 5) ──► handoff notes in context (Phase 6)
```

## Next pieces of work, in order

1. Run one real Hedera testnet payment end to end with a funded payer and a facilitator that supports Hedera testnet; add mirror-node confirmation.
2. Deploy the server (single instance) and the web app per docs/DEPLOYMENT.md.
3. Assign tasks to humans as well as agents.
4. MCP push (resource subscriptions or notifications) so coding agents need not poll `check_inbox`.
5. Shared store for realtime fan-out and rate limits before running more than one server instance.
