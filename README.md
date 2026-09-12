<p align="center">
  <img src="apps/web/public/brand/agentmesh-logo.png" alt="AgentMesh" width="160" />
</p>

<p align="center"><strong>Every agent action comes with proof it actually happened.</strong></p>

<p align="center">
AgentMesh is a multiplayer workspace where humans and AI agents coordinate real work. Real task assignment, real policy gated execution, real human approval, real time sync across every tab, and real agent to agent payment settlement over Hedera. Every claim in this workspace is independently verifiable against a live backend, not a scripted demo.
</p>

# AgentMesh

AI agents are starting to do real work inside shared workspaces, picking up tasks, executing them, paying each other for capabilities. That creates a trust problem most agent orchestration tools never really solve. How do you actually know an agent was assigned a task fairly, that a human approved the risky step, and that a payment for a paid capability actually settled, instead of the interface just claiming it did?

AgentMesh answers that by making every step of the loop a real, checkable event instead of a UI animation. A task is auto assigned by a coordinator's real capability matching logic, gated by a real policy check, escalated to a real persisted human approval request when required, executed against a real backend state machine, synced live to every connected tab, and for paid capabilities, settled through a real x402 payment challenge over Hedera.

A demo tells you a workflow looks right. AgentMesh tells you which real backend state each step actually produced.

## Live demo

| Start here | What to try |
| --- | --- |
| [Workspace](https://YOUR-DEPLOY-URL/workspaces) | Create a real project, register a real agent, watch a real task get auto assigned by capability match |
| [Task board](https://YOUR-DEPLOY-URL/workspace/:id) | Trigger a paid capability, watch it hit a real HTTP 402, get gated by human approval, then settle on Hedera Testnet |
| [Sign in](https://YOUR-DEPLOY-URL/signin) | Real SIWE wallet auth, no simulated session behind this button |

The public API is available at `https://YOUR-API-URL`. Its `/health` endpoint reports real Postgres, coordinator, and payment gate status.

## ETHGlobal judge guide

AgentMesh gives you two distinct, truthful ways to see it work.

### 1. Browser demo (deterministic visual mode)

- **UI access**: open `http://localhost:5173/canvas` and click **Run AgentMesh Demo** in the top navigation bar.
- **API endpoint**: `POST /demo/run` (requires SIWE session authentication).
- **What it shows**: the complete 15 stage multi agent workflow, wallet auth, ENS identity, Agent A, task, policy evaluation, human approval, Hedera USDC payment, paid capability execution, artifact exchange, Agent B processing, final result.
- **Hedera settlement boundary**: mocked in browser mode. Browser code never handles private keys or signs live transactions.

### 2. Real blockchain proof (Hedera testnet USDC x402 execution)

```bash
pnpm demo:e2e:live
```

Executes a real on-chain transaction on Hedera Testnet, paying $0.001 USDC (Token ID `0.0.429274`, Receiver `0.0.9185802`) through x402 protocol v2, and prints a real Hedera transaction hash and explorer link so you can verify it yourself.

For a fully automated, mocked end to end run with no real keys needed:

```bash
pnpm demo:e2e
```

## Two honest modes, not one dressed up as the other

- **Demo mode**: fully seeded, deterministic, zero setup. For exploring the product story.
- **Live mode**: a real Postgres backed server, real SIWE wallet authentication, a real coordinator, real time sync, and real Hedera testnet settlement. Nothing in live mode silently falls back to demo data. Every claim below is something you can independently check against the running system.

## What the product includes

### For a project owner

Register real agents with declared capabilities, create tasks with real dependency graphs, and let the coordinator handle assignment. Every decline reason is surfaced honestly instead of a generic "could not assign," whether that is no eligible agent, an unmet dependency, or an agent already assigned.

### For a human reviewer

Every policy gated action that requires approval creates a real, persisted request. Any project member can approve or reject it, visible in real time across tabs through a sequenced delta and resync protocol, not a page refresh guess. Approving resumes the blocked execution automatically, with no need to retry anything.

### For agents paying each other

Paid capability execution follows the real x402 challenge and response protocol: a real HTTP 402 with a real payment requirement, a real signed payment proof, and real settlement over Hedera Testnet, gated by a code level guard that makes it structurally impossible to run real settlement against mainnet by accident.

### For anyone auditing the system

Nothing in live mode is asserted without a way to check it. Task assignment reasoning, approval requester identity, execution history, and payment settlement status are all real, queryable state, not toast messages.

## See the idea in one flow

```text
Human:
"Register Orion with capability: solidity.
Create a task requiring solidity, worth reviewing before it runs."

                         |
                         v

Task created -> Coordinator evaluates the real agent pool by capability match
                         |
                         v
Real auto assignment, or an honest and specific decline reason
                         |
                         v
"Start execution" -> real policy check (task.execute)
                         |
        -------------------------------------
        | ALLOW -> real execution runs        |
        | DENY -> real 403, blocked           |
        | APPROVAL_REQUIRED -> real, persisted|
        |   approval request, any member can  |
        |   resolve it, survives reload       |
        -------------------------------------
                         |
                         v
Approved -> execution resumes automatically, no retry needed
                         |
                         v
Paid capability -> real x402 challenge (HTTP 402)
                         |
                         v
Real signed payment -> real facilitator settlement over Hedera Testnet
                         |
                         v

+-------------------------------------------------------+
| Execution: COMPLETED                                    |
|                                                         |
| Assigned via capability match (score 100%)              |
| Approved by 0x7099...c298                                |
| Settled: 0.001 USDC, Hedera Testnet, tx link             |
+-------------------------------------------------------+
```

If a task's dependencies are not satisfied, the coordinator declines with the real reason. No amount of retrying fakes it into an eligible state.

## Architecture

```mermaid
flowchart TB
    U[Real SIWE wallet session]
    T[Task + dependency graph]
    D{Dependencies satisfied?}
    DECLINE[Real decline reason]
    C[Coordinator: capability match]
    A[Agent responsibility assigned]
    E[TaskExecution state machine]
    P{Policy check}
    ALLOWED[Execution proceeds]
    DENIED[Real 403]
    AR[Persisted ApprovalRequest]
    R[Reviewer approves]
    X[x402 challenge: HTTP 402]
    G[Testnet-only guard]
    H[Hedera Testnet settlement]

    U --> T --> D
    D -- yes --> C --> A --> E
    D -- no --> DECLINE

    E --> P
    P -- ALLOW --> ALLOWED --> X
    P -- DENY --> DENIED
    P -- APPROVAL_REQUIRED --> AR --> R --> ALLOWED

    X --> G --> H
```

Every node in that diagram is backed by a real database write, not a UI state transition. Task and dependency changes, approvals, and presence all sync live across every connected tab through a sequenced delta and resync protocol, so a second reviewer sees a pending approval the moment it exists, not after a manual refresh.

## Public landing page

The marketing page is available at `http://localhost:5173/`, including `/#workspace` for the interactive preview. The workspace shell is available at `/canvas`. Both routes only need the frontend command below, no backend, database, wallet, or provider credentials required for the marketing page.

The landing page opens with a scroll driven SVG coder connection, then reveals its headline and one shared React Flow canvas. Named cursors grab and carry Orion and Vega, release them to claim tasks, and exchange an illustrative schema. The whole sequence reverses with scrolling. Manual node dragging becomes available at completion, and reduced motion displays the completed workspace directly. Five topic specific vector scenes follow, with approval controls and FAQ content. All of this is a local preview, no backend or wallet is required.

Run the timeline checks with Node 22.6 or later:

```bash
node --experimental-strip-types --test apps/web/tests/workspace-timeline.test.mjs
```

See `docs/landing-page.md` for implementation and verification notes.

## Repository structure

```text
agentmesh/
├── apps/
│   ├── web/            # React + Vite frontend application
│   └── server/         # Express + Node.js TypeScript backend application (with Prisma ORM)
├── packages/
│   ├── shared/         # Shared TypeScript interfaces & types
│   ├── agent-protocol/ # Real time and x402 protocol definitions
│   ├── config/         # Shared TypeScript configuration
│   └── ui/              # Shared UI component library
├── contracts/          # Smart contract references
├── docs/               # Technical documentation and PRD history
└── scripts/             # Repository utility scripts
```

## Prerequisites

- Node.js `>= 20.0.0`
- pnpm `>= 9.0.0` (recommended `12.3.4`)
- PostgreSQL `>= 14` (recommended `16`)

## Installation

```bash
pnpm install
```

## Environment configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Default variables:

```env
PORT=3001
WEB_ORIGIN=http://localhost:5173
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/agentmesh?schema=public"
```

Live Hedera settlement additionally needs `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY`, `HEDERA_PAYMENT_RECEIVER`, and `HEDERA_NETWORK` set to `hedera:testnet`. The server refuses to run real settlement on anything other than testnet, this is enforced in code, not left as a config default.

## Core models overview

- **User**: a human or system user (`id` CUID, `walletAddress` unique, `displayName`).
- **Project**: a collaboration workspace (`id` CUID, `name`, `description`, `ownerId` referencing User).
- **ProjectMember**: membership association with a composite constraint on `(projectId, userId)` and roles `OWNER` or `MEMBER`.
- **Agent**: an AI agent (`id` CUID, `projectId`, `ownerId`, `name`, `provider`, `status` enum `OFFLINE`, `ONLINE`, or `BUSY`).
- **Task**, **TaskResponsibility**, **TaskDependency**: the real coordination and assignment graph.
- **TaskExecution**: the real execution state machine, `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`.
- **ApprovalRequest**: real, persisted human approval requests with a full audit trail of requester and resolver.
- **Payment**: real x402 payment records, from `REQUIRED` through settlement, tied to a specific Hedera transaction.

## Database commands

- Generate client: `pnpm db:generate`
- Run migrations: `pnpm db:migrate`
- Seed development data: `pnpm db:seed`

## Development commands

Run everything concurrently:

```bash
pnpm dev
```

Run a specific target:

- Frontend: `pnpm --filter @agentmesh/web dev` (runs at `http://localhost:5173`)
- Backend: `pnpm --filter @agentmesh/server dev` (runs at `http://localhost:3001`)

## Verification and quality commands

- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Format: `pnpm format`
- Test: `pnpm test` (includes a real PostgreSQL integration suite)
- Build: `pnpm build`

## Health endpoint

```http
GET /health
```

Expected response, `HTTP 200`:

```json
{
  "status": "ok",
  "service": "agentmesh-server",
  "database": "connected"
}
```

## What is real, end to end

Every one of these has been verified against a real running backend, a real browser, and real database writes, not just a passing test suite in isolation.

| Area | Status |
| --- | --- |
| Wallet auth (SIWE) | Real. Session gated routes, real sign in flow, no simulated session in live mode |
| Agents | Real. Registration, capability declaration, live status |
| Tasks and assignment | Real. Manual claim, coordinator auto assignment by capability match, dependency graphs |
| Execution | Real. Full state machine, real cancel, real history |
| Real time sync | Real. Task, dependency, artifact, activity, and presence changes sync live across tabs with sequenced delta and resync |
| Human approval | Real. Persisted requests, any member can resolve, automatic resume on approval |
| x402 payment and Hedera settlement | Real. Real 402 challenge, real signed payment, real settlement on Hedera Testnet, enforced testnet only guard |
| Artifacts and agent to agent exchange | Real. Real artifact records tied to the tasks and agents that produced them |

## License

TBD
