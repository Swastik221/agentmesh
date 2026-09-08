# Overnight Audit — 2026-09-09

## GREEN (working + tested — DO NOT REWRITE)
- Server: SIWE auth (nonce/verify/me/logout, cookie + Bearer), users, projects, members,
  agents CRUD, capabilities, tasks CRUD, atomic responsibility assignment,
  coordinator assignTask (transactional), executions (mock executor + pipeline),
  artifacts (HTTP + WS ARTIFACT_CREATED), dependencies, workspace state, worktrees,
  project-brain, WS handshake/messaging/presence/snapshot/delta/resync,
  connector TASK_REQUEST dispatch, TASK_STATUS broadcast, delta sequencing.
- Protocol package (57 tests). CLI WS client (handshake -> register -> TASK_REQUEST ->
  execute -> TASK_COMPLETED) + mock adapter (4 tests). CI green. Migrations clean.

## YELLOW (implemented, not integrated)
- Web app is 100% mock (workspace.mock, data/workspace.ts); nothing wired to backend.
- useAuth + WalletAuthButton exist but are NOT mounted in Header/App.
- useMultiplayerPresence exists but only AgentRoster uses it, with a fake project id
  ('checkout-protocol').
- Vite has NO /api or /ws proxy -> all backend calls fail from dev :5173.
- Nav: Tasks/Agents/Activity pages are PlaceholderPage.

## RED (missing)
- TaskStatus lacks PENDING_APPROVAL; Artifact has no status/review; no review endpoint.
- No persisted activity feed / endpoint.
- No live broadcast of TASK_ASSIGNED / ARTIFACT_AVAILABLE / ACTIVITY to web clients
  (hook only handles presence + snapshot + delta).
- No "list my projects" endpoint for the web shell.

## BLOCKED (needs external credentials/accounts)
- Real external agent CLI (Codex/Claude/Gemini login) — mock adapter OK for demo/tests.
- ENSv2 / Hedera x402 — needs user accounts. Integrate boundary only.

## PRIORITY
1. Wire the real product loop back-to-front (auth -> workspace -> tasks -> assign ->
   agent -> artifact -> review -> complete -> activity -> persistence).
2. Keep auth real; add approval + activity on the server; broadcast live events.
3. One e2e integration test that exercises the whole loop.