# AgentMesh frontend demo mode

The web app runs a deterministic frontend simulation when `VITE_AGENTMESH_MODE` is unset or set to `demo`. It does not contact a wallet, chain, coding model, or collaboration server. The small `DEMO MODE` labels identify simulated product state.

## Run the complete demo

```bash
pnpm --filter @agentmesh/web dev
```

Open `/`, choose the primary call to action, then complete signup, onboarding, and workspace selection. The prepared workspace is `checkout-demo` and its invite code is `MESH-2026`. On the canvas, use `Submit PRD`, task claim buttons, the approval node, Terminal, Browser, or the guided replay toolbar. `Reset data` restores deterministic fixtures.

## Test two local profiles

Open `/workspace/checkout-demo` in two tabs on the same origin. Select Anand in one demo toolbar and Swastik in the other. Each tab retains its own profile in `sessionStorage`. Shared tasks, approval decisions, activity, cursor positions, node selection, and node positions synchronize with `BroadcastChannel`. A storage event is used as a fallback.

Cursor frames and node drag frames are transient. Meaningful workflow state is persisted in `localStorage` under `agentmesh.demo.state.v1`.

## Guided replay

Choose `Play guided replay`. The fixture advances through join, capability announcement, task generation, preferences, capability assignment, artifact publication, dependency delivery, and human approval. Use Pause, Resume, Next step, Restart, or Exit replay. The request remains pending until the human chooses an approval action.

## Integration boundaries

The contracts and current demo implementations live in:

- `apps/web/src/demo/demo.types.ts`
- `apps/web/src/demo/demo.gateways.ts`
- `apps/web/src/demo/demo.fixtures.ts`
- `apps/web/src/demo/DemoProvider.tsx`

The backend can implement `AuthGateway`, `WorkspaceGateway`, `PresenceGateway`, `TaskGateway`, `ProtocolGateway`, `ApprovalGateway`, `TerminalGateway`, and `BrowserGateway`. The identity and chain integration can implement `IdentityGateway`. Page and workspace components consume the provider facade and do not need fixture imports for application state.

A future API login can accept `{ email, password }` and return `{ id, email, displayName, profileId, createdAt }`. Realtime messages should carry a stable source ID and one of `STATE`, `CURSOR`, or `NODE`; production messages should include workspace ID, actor identity, timestamp, event type, payload, and correlation ID.

## Environment

```env
VITE_AGENTMESH_MODE=demo
VITE_API_URL=
VITE_WS_URL=
VITE_CHAIN_ID=
```

No production adapters are included. Backend and blockchain work should avoid changing the demo fixtures, UI reducer, landing animation files, and React Flow node presentation. Integrate by supplying gateway implementations at the provider boundary.
