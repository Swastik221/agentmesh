# Agent-to-Agent Messaging Protocol

This document specifies the architecture, routing rules, security invariants, error codes, and delivery semantics for **Agent-to-Agent Messaging** in AgentMesh.

---

## 1. Overview

Agent-to-Agent Messaging enables authenticated online agents within the same project to send direct messages to each other in real time over WebSockets. The AgentMesh WebSocket server acts as an authoritative, trusted message router.

```text
  Agent A (Authenticated)
            │
            │ `agent.message` (recipientId = "agent-b")
            ▼
  AgentMesh WebSocket Server
            │
            ├── 1. Authoritative Sender Identity Check (`senderId === connection.agentId`)
            ├── 2. Project Boundary Check (`message.projectId === connection.projectId`)
            ├── 3. Recipient Existence & Project Alignment Check (`recipient.projectId === connection.projectId`)
            ├── 4. Active Connection Lookup (`ConnectionManager`)
            │
            ▼
  Agent B (Recipient Connection / Connections)
```

---

## 2. Security Invariants

### 1. Authoritative Sender Identity (`SENDER_ID_MISMATCH`)
The server **never trusts** the client-supplied `senderId` in the message payload.
- The `senderId` must strictly equal `connection.agentId` (derived during the PRD #9 handshake).
- Any attempt to spoof `senderId` is rejected with error `SENDER_ID_MISMATCH`.

### 2. Strict Project Boundaries (`PROJECT_MISMATCH` / `RECIPIENT_PROJECT_MISMATCH`)
Cross-project messaging is strictly forbidden.
- The message `projectId` must equal `connection.projectId` (`PROJECT_MISMATCH`).
- The recipient agent must belong to the exact same `projectId` in PostgreSQL (`RECIPIENT_PROJECT_MISMATCH`).

### 3. Pre-Handshake Blocking (`HANDSHAKE_REQUIRED`)
Unauthenticated or pre-handshake connections cannot send `agent.message`. Any attempt is rejected with error `HANDSHAKE_REQUIRED`.

---

## 3. Delivery Semantics & Routing

1. **Direct Agent Messaging Only**: Messages require an explicit `recipientId`.
2. **Multi-Session Fan-Out**: If the recipient agent maintains multiple active authenticated WebSocket connections, the server delivers the message to **all active sockets** belonging to that recipient agent.
3. **Offline Recipients (`RECIPIENT_OFFLINE`)**: If the recipient agent exists in the project but has no active authenticated connections, the server returns an `error` message (`code: "RECIPIENT_OFFLINE"`, `retryable: true`). No message database persistence is performed in PRD #10.
4. **Header Integrity**: The server preserves original message attributes (`id`, `protocolVersion`, `timestamp`, `correlationId`, `senderId`, `recipientId`, `projectId`) unchanged during routing.

---

## 4. Message Schema

### Input / Delivered Message (`agent.message`)

```json
{
  "id": "msg-1234-uuid",
  "protocolVersion": "0.1",
  "type": "agent.message",
  "projectId": "project-123",
  "senderId": "agent-a",
  "recipientId": "agent-b",
  "timestamp": "2026-09-07T03:50:00.000Z",
  "correlationId": "task-5678",
  "payload": {
    "body": "Hello Agent B, please analyze this component.",
    "metadata": {
      "priority": "high"
    }
  }
}
```

### Error Response (`error`)

```json
{
  "id": "err-5678-uuid",
  "protocolVersion": "0.1",
  "type": "error",
  "projectId": "project-123",
  "senderId": "server",
  "recipientId": "agent-a",
  "timestamp": "2026-09-07T03:50:00.100Z",
  "correlationId": "msg-1234-uuid",
  "payload": {
    "code": "RECIPIENT_OFFLINE",
    "message": "Recipient agent is not currently connected.",
    "retryable": true
  }
}
```

---

## 5. Error Codes Summary

| Error Code | Description |
| :--- | :--- |
| `HANDSHAKE_REQUIRED` | `agent.message` sent before completing WebSocket handshake |
| `SENDER_ID_MISMATCH` | `senderId` in message does not match connection `agentId` |
| `PROJECT_MISMATCH` | Message `projectId` does not match connection `projectId` |
| `RECIPIENT_NOT_FOUND` | `recipientId` is missing or recipient agent does not exist |
| `RECIPIENT_PROJECT_MISMATCH` | Recipient agent belongs to a different project |
| `RECIPIENT_OFFLINE` | Recipient agent is valid but has no active connections (`retryable: true`) |
