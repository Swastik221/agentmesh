# Authenticated Agent Handshake Protocol

This document defines the architecture, lifecycle, payload schema, and security invariants for the **Authenticated Agent Handshake** in AgentMesh.

---

## 1. Overview

The AgentMesh WebSocket transport establishes project-scoped real-time connections (`/ws?projectId=<projectId>`). However, transport connection alone does not grant agent-level authority.

Before an agent can exchange messages, execute tasks, or update status, it must perform an **Authenticated Agent Handshake**.

```text
Wallet Identity (SIWE)
          │
  Session Cookie (`agentmesh_session`)
          │
  WebSocket Upgrade (`/ws?projectId=...`)
          │
  `agent.handshake` Message
          │
  Server Verification & Identity Derivation
          │
  `agent.handshake.accepted`
          │
  Authenticated Agent Session (In-Memory)
```

---

## 2. Security Invariants

### 1. Zero-Trust Identity
The server **never trusts** `senderId`, `userId`, or `ownerId` supplied in client message payloads.
- The authenticated `userId` is derived exclusively from the server-side SIWE HTTP session (`agentmesh_session` cookie or `Authorization: Bearer <sessionId>` header).

### 2. Server-Side Verification Chain
Before accepting an agent handshake, the server verifies:
1. **SIWE Session**: Valid and unexpired server session exists.
2. **Agent Existence**: Target `agentId` exists in PostgreSQL database.
3. **Ownership**: `agent.ownerId === session.userId`.
4. **Project Alignment**: `agent.projectId === websocket.projectId`.
5. **Project Membership**: Authenticated `userId` is an active member of `websocket.projectId`.
6. **Capabilities Verification**: Every requested capability in `payload.capabilities` is registered for that agent in `AgentCapability`.

### 3. Server-Generated Session ID
Upon successful verification, the server generates a cryptographically strong UUID `sessionId`. Client-supplied session IDs are ignored.

---

## 3. Message Schemas

### Handshake Request (`agent.handshake`)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "protocolVersion": "0.1",
  "type": "agent.handshake",
  "projectId": "project_123",
  "senderId": "agent_123",
  "timestamp": "2026-09-07T03:00:00.000Z",
  "payload": {
    "agentId": "agent_123",
    "clientVersion": "0.1.0",
    "capabilities": [
      "frontend",
      "typescript"
    ]
  }
}
```

### Handshake Accepted (`agent.handshake.accepted`)

```json
{
  "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "protocolVersion": "0.1",
  "type": "agent.handshake.accepted",
  "projectId": "project_123",
  "senderId": "server",
  "recipientId": "agent_123",
  "timestamp": "2026-09-07T03:00:00.100Z",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "payload": {
    "agentId": "agent_123",
    "sessionId": "b3e945fa-2849-43d9-9524-2c67fe990142",
    "projectId": "project_123",
    "capabilities": [
      "frontend",
      "typescript"
    ]
  }
}
```

### Handshake Rejected (`agent.handshake.rejected`)

```json
{
  "id": "8d0f7780-8536-41ef-855c-f18gd2ea12e8",
  "protocolVersion": "0.1",
  "type": "agent.handshake.rejected",
  "projectId": "project_123",
  "senderId": "server",
  "timestamp": "2026-09-07T03:00:00.100Z",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "payload": {
    "code": "AGENT_NOT_OWNED",
    "message": "Agent 'agent_123' is not owned by the authenticated user"
  }
}
```

---

## 4. Error Codes

| Error Code | Description |
| :--- | :--- |
| `HANDSHAKE_REQUIRED` | Application message sent prior to completing handshake |
| `UNAUTHENTICATED` | Missing, invalid, or expired SIWE HTTP session |
| `AGENT_NOT_FOUND` | `agentId` does not exist in database |
| `AGENT_NOT_OWNED` | Authenticated user is not the owner of the agent |
| `AGENT_PROJECT_MISMATCH` | Agent's registered `projectId` differs from WebSocket `projectId` |
| `PROJECT_ACCESS_DENIED` | Authenticated user is not an active member of the project |
| `INVALID_CAPABILITIES` | Requested capability is not registered for the agent |
| `HANDSHAKE_ALREADY_COMPLETED` | Handshake re-sent on an already authenticated connection |
| `UNSUPPORTED_PROTOCOL_VERSION` | Protocol version differs from `0.1` |

---

## 5. Agent Status & Multi-Session Policy

1. **ONLINE Transition**: When an agent successfully completes handshake, its database `Agent.status` transitions to `ONLINE`.
2. **Multi-Session Support**: Multiple simultaneous active connections for the same agent are permitted (e.g., CLI, IDE, CI agent).
3. **OFFLINE Transition**: When a connection closes, the server checks remaining active authenticated sessions for that agent. If and only if zero active sessions remain, `Agent.status` transitions to `OFFLINE`.
