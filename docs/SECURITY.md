# AgentMesh security model

What AgentMesh protects, how, and where the limits are. Kept in sync with the code; where a control is best effort, it says so.

## 1. Threat model

**Assets:** project data (tasks, artifacts, handoff notes, activity), terminal output, agent credentials, user sessions, and payments.

**Actors we defend against:**

- A signed-in user who is **not a member** of a project.
- A **member with a low role** trying to act above it (VIEWER/MEMBER vs ADMIN/OWNER).
- A **compromised or misbehaving agent process** holding a valid agent token.
- A **removed member** whose sockets or tokens are still around.
- A **network attacker or third-party web page** (CSRF, cross-origin WebSocket).
- A **payer** trying to get paid work for free, or reuse one payment twice.

**Out of scope:** a compromised developer machine (it owns its terminal and agent), a compromised AgentMesh server or database host, and the correctness of the coding agents' own output.

## 2. Authentication

| Who | Credential | Notes |
| --- | --- | --- |
| Humans | SIWE (EIP-4361) wallet signature → session cookie | Nonce: CSPRNG, 5-minute expiry, single use (atomic delete after signature verification). Domain, URI and chain id checked exactly. Addresses normalised to one user per wallet. |
| | Session cookie `agentmesh_session` | 256-bit random token; **only its SHA-256 hash is stored**. httpOnly, SameSite=Lax, Secure in production, server-side expiry. Logout deletes it. Changing or disconnecting the wallet in the browser also ends the server session. |
| Agents (CLI, terminals, MCP) | Agent token (`amct_…`) | Scoped to one agent in one project. Hashed at rest. 10 minutes for a pasted connect token, 30 days for an MCP token, 12 hours for the resume token rotated on each handshake. Every handshake re-checks agent ownership and the issuer's project membership. `DELETE /agents/:id/connect-tokens` revokes all of an agent's tokens and closes its sockets. |

Rate limits (per IP, per minute, configurable): sign-in nonce 60, SIWE verify 30, token minting 20, join-by-code 20. Expired sessions, nonces and tokens are purged every 10 minutes.

## 3. Authorization boundaries

Enforced on the server for every request and message; the UI only hides controls a role cannot use.

- **Project membership** gates all project data, REST and WebSocket alike. Cross-project ids resolve as "not found".
- **Roles:**

  | Action | Who may do it |
  | --- | --- |
  | Add or remove members | OWNER or ADMIN; only OWNER grants OWNER or ADMIN |
  | Change roles | OWNER |
  | Create, edit or delete policies | OWNER or ADMIN |
  | Approve | Any non-VIEWER; a MEMBER cannot approve their own request |
  | Show or rotate the join code | OWNER |

  The project creator cannot be removed by anyone else.
- **Tasks:** PENDING_APPROVAL is set only by policy and left only through approve or reject. COMPLETED and CANCELLED are final. An agent may move only its own tasks, and never to COMPLETED.
- **Approvals** record the decision and the resumed action's outcome together. A failed resume stays visible as FAILED and is retried explicitly, never silently.
- **Removing a member** closes their browser connections, their terminal subscriptions, and their agents' connections immediately.

## 4. Realtime (WebSocket)

- Browser connections must present an `Origin` equal to `WEB_ORIGIN`. Session ids in the query string are refused in production.
- 2 MB message and body caps. Duplicate envelope ids are dropped per connection on coordination messages.
- Every message is validated with Zod and scoped to the connection's project. Agent connections declare a role (`executor` / `terminal` / `observer`); only executors receive tasks.
- A connection closed for lost access (codes 4001/4003) is not retried by the web client.

## 5. Terminal privacy model

- The terminal runs on the developer's machine (`agentmesh terminal`). **No input path exists**: the server refuses `terminal.input`, and only the connection that opened a session may write output to it.
- **Private by default.** SHARED means readable by project members, read-only. Unsharing or disconnecting revokes every other viewer at once. Only the owner can change either.
- **Output is never persisted.** The server keeps a 64 KB in-memory buffer per session, dropped on close or 10 minutes after disconnect, and forwards at most 256 KB/s.
- **Redaction (best effort):** common token formats, `*_KEY=`, `PASSWORD=` and similar assignments, URL credentials, and private keys are redacted in the CLI before output leaves the machine, and again on the server, including the session's command line. **It will miss secrets it does not recognise or that span output chunks.** Do not print secrets into a shared terminal.
- Other agents see a terminal only if it is SHARED, and only its metadata unless they ask for its tail.

## 6. Agent permission model

- An agent acts with the authority of the member who owns it, narrowed to one project and to the protocol's agent operations.
- Agents can read workspace context, message other agents (stored, delivered, auditable), publish handoff notes, and update their own tasks.
- Handoff notes are artifacts and go through the `artifact.write` policy, so a project can require human approval.
- Agents cannot approve, complete tasks, manage members or policies, or touch another agent's tasks or terminals.
- Every coordination message is recorded as activity, so humans can see what their agents agreed.

## 7. MCP security model

`agentmesh mcp` is a thin client:

- It holds no privileges beyond its agent token, connects in the `observer` role, and every tool maps to a protocol request the server authorises.
- It exposes no tool that runs commands, reads private terminals, or completes or approves work.
- The token is supplied through the environment, never logged, and revocable server-side.
- stdout carries MCP messages only.

See `docs/MCP_INTEGRATION.md`.

## 8. Payment trust assumptions (Hedera x402)

- **Price, asset, network and receiver are server-side.** Testnet is enforced in code. The fee payer comes from the facilitator's `/supported` response.
- **Settlement** happens only through the configured facilitator's verify and settle, and only counts if it returns a transaction reference. **We trust the facilitator's answer**: the server does not independently check the transaction on a Hedera mirror node yet.
- **References:** settlement accepts only a reference the server issued, for the same project, requester and agent, unexpired and unpaid. A transaction reference can settle only one payment (unique).
- **Agent availability** is checked before quoting and before settling, so nobody pays for an agent that cannot run. If the work fails after settlement, the payment is flagged `refundDue` and recorded in activity. The refund itself is manual: the receiver account must send it, and the server holds no keys.

## 9. Known limitations

- Rate limiting is per process (in memory). Use a shared store before scaling out horizontally.
- Terminal redaction is best effort (see above).
- Facilitator settlement is trusted without mirror-node confirmation.
- Browser-side Hedera payment signing is not implemented.
- ENS-based invites rely on a single RPC resolution.
- Conflict detection is advisory. It reflects declared files and assignments and cannot guarantee a conflict-free merge.
- Git worktree isolation protects against path escape, not against a malicious agent process on the developer's own machine.
