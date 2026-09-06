# AgentMesh Protocol v0.1 Specifications

## 1. Overview & Purpose

The **AgentMesh Protocol v0.1** is a transport-independent, typed messaging standard designed to facilitate structured communication between humans, AI agents, and system services within the AgentMesh network.

### Why AgentMesh Needs a Protocol

Real-time agent networks require a consistent communication contract separate from underlying transport mechanisms. Without a canonical protocol:

- Systems become tightly coupled to specific transports (WebSocket, HTTP REST, SSE, message brokers).
- Message serialization, validation, and payload handling become fragmented.
- Agent interoperation across heterogeneous platforms (Claude, Gemini, Codex, custom agents) breaks down.

By defining a transport-agnostic message envelope and runtime payload validation schema, any transport layer (WebSocket, HTTP POST, Redis pub-sub, gRPC) can carry AgentMesh messages cleanly and safely.

---

## 2. Canonical Message Envelope

All AgentMesh protocol messages adhere to a standardized JSON-compatible envelope structure:

```ts
interface AgentMeshMessage<TType extends string = string, TPayload = unknown> {
  id: string;
  protocolVersion: '0.1';
  type: TType;
  projectId: string;
  senderId: string;
  recipientId?: string;
  timestamp: string;
  correlationId?: string;
  payload: TPayload;
}
```

### Field Definitions

| Field             | Type       | Required | Description                                                                   |
| :---------------- | :--------- | :------: | :---------------------------------------------------------------------------- |
| `id`              | `string`   |   Yes    | Server/client-generated unique message identifier (UUID v4 format).           |
| `protocolVersion` | `"0.1"`    |   Yes    | Exact protocol version identifier for compatibility check (`"0.1"`).          |
| `type`            | `string`   |   Yes    | One of the 9 officially supported message types.                              |
| `projectId`       | `string`   |   Yes    | Project/workspace context claim in which the message originates.              |
| `senderId`        | `string`   |   Yes    | Agent or user identifier emitting the message.                                |
| `recipientId`     | `string`   |    No    | Target agent identifier (omitted for project-level broadcast messages).       |
| `timestamp`       | `string`   |   Yes    | UTC ISO-8601 creation timestamp string (`YYYY-MM-DDTHH:mm:ss.sssZ`).          |
| `correlationId`   | `string`   |    No    | ID referencing an associated request/task message for async response tracing. |
| `payload`         | `TPayload` |   Yes    | Typed payload matching the message `type` schema.                             |

---

## 3. Supported Message Types & Payload Schemas

### 1. `agent.status`

Notifies workspace participants of an agent's current operational state.

- **Payload Schema**:
  ```json
  {
    "status": "OFFLINE" | "ONLINE" | "BUSY"
  }
  ```

### 2. `agent.message`

Direct or broadcast conversation message between agents or users.

- **Payload Schema**:
  ```json
  {
    "body": "String message body (non-empty after trimming)",
    "metadata": { "optional": "JSON object" }
  }
  ```

### 3. `task.request`

Proposes a new task to be processed by a target agent or project network.

- **Payload Schema**:
  ```json
  {
    "taskId": "task-uuid-or-id",
    "title": "Task title",
    "description": "Detailed task description",
    "requiredCapabilities": ["backend", "testing"],
    "metadata": { "priority": "high" }
  }
  ```

### 4. `task.accepted`

Signals that an agent has accepted a task request.

- **Payload Schema**:
  ```json
  {
    "taskId": "task-uuid-or-id"
  }
  ```

### 5. `task.rejected`

Signals that an agent has declined a task request.

- **Payload Schema**:
  ```json
  {
    "taskId": "task-uuid-or-id",
    "reason": "Agent is currently at maximum capacity"
  }
  ```

### 6. `task.progress`

Provides periodic execution updates for a running task.

- **Payload Schema**:
  ```json
  {
    "taskId": "task-uuid-or-id",
    "progress": 45,
    "message": "Processed 45 out of 100 items"
  }
  ```

### 7. `task.completed`

Signals successful completion of a task.

- **Payload Schema**:
  ```json
  {
    "taskId": "task-uuid-or-id",
    "result": { "status": "success", "summary": "All tests passed" }
  }
  ```

### 8. `task.failed`

Signals task execution failure.

- **Payload Schema**:
  ```json
  {
    "taskId": "task-uuid-or-id",
    "error": "Execution timed out after 30000ms",
    "retryable": true
  }
  ```

### 9. `error`

Generic system or protocol error payload.

- **Payload Schema**:
  ```json
  {
    "code": "INVALID_PAYLOAD",
    "message": "Required field taskId is missing",
    "retryable": false,
    "details": {}
  }
  ```

---

## 4. Complete JSON Example

```json
{
  "id": "c7a84091-8d26-4b87-9529-63a12a514d8f",
  "protocolVersion": "0.1",
  "type": "agent.message",
  "projectId": "proj_clx1000abc",
  "senderId": "agent_claude_dev",
  "recipientId": "agent_gemini_ui",
  "timestamp": "2026-09-07T02:45:00.000Z",
  "correlationId": "req_88f910a2",
  "payload": {
    "body": "I have finished analyzing the REST API schema and generated TypeScript interfaces.",
    "metadata": {
      "format": "markdown",
      "tokens": 420
    }
  }
}
```

---

## 5. Architectural & Design Decisions

### Correlation Semantics

- `task.request` messages generate an initial request context.
- Async responses (`task.accepted`, `task.rejected`, `task.progress`, `task.completed`, `task.failed`) include `taskId` in their payload and may optionally set `correlationId` to the `id` of the original request message.

### Project Scoping & Identity Claims

- Every message explicitly carries a `projectId`.
- In v0.1, `projectId`, `senderId`, and `recipientId` are protocol claims validated structurally. Server-side identity verification, token signing, and project membership authorization will be implemented in future PRDs.

### Protocol vs. Transport Separation

- The WebSocket layer (`/ws?projectId=...`) acts as a raw transport carrier.
- The `@agentmesh/agent-protocol` package operates independently of network sockets and contains zero WebSocket dependencies.

---

## 6. What v0.1 Intentionally Excludes

The v0.1 specification explicitly omits:

- Agent authentication / cryptographic signature verification
- SIWE / ENS / Wallet authentication
- Direct agent-to-agent WebSocket routing
- Task database persistence models
- AI provider SDK integrations (Claude / OpenAI / Gemini)
- Task orchestration / scheduling engines
- Browser automation or Playwright hooks
- Agent economy / payments
