import { AgentMeshMessage } from './types.js';
import { parseAgentMeshMessage } from './validation.js';

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }

  const sortedObj: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key];
    if (value !== undefined) {
      sortedObj[key] = sortKeys(value);
    }
  }
  return sortedObj;
}

export function serializeMessage(message: AgentMeshMessage): string {
  const parsed = parseAgentMeshMessage(message);
  const canonicalObj = sortKeys(parsed);
  return JSON.stringify(canonicalObj);
}

export function deserializeMessage(raw: unknown): AgentMeshMessage {
  let parsedRaw = raw;
  if (typeof raw === 'string') {
    parsedRaw = JSON.parse(raw);
  }
  return parseAgentMeshMessage(parsedRaw);
}
