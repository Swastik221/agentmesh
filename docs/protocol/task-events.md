# Protocol — Task Events

The AgentMesh WebSocket protocol supports event-driven task state notifications broadcasted to project rooms (`project:${projectId}`).

---

## Task Status Event (`task.status`)

Broadcasted whenever a task changes status (`TODO -> IN_PROGRESS`, `IN_PROGRESS -> COMPLETED`, `FAILED`, `CANCELLED`).

### Event Payload

```json
{
  "type": "task.status",
  "payload": {
    "taskId": "task-cuid-123",
    "status": "IN_PROGRESS"
  }
}
```

### Protocol Invariant

To preserve low latency and minimal bandwidth:
- Broadcasts contain **only** the minimum state required (`taskId` and `status`).
- Broadcasts do **not** attach heavy project brain content, conversation logs, or execution outputs.
