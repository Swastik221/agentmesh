import { demoAdapters } from './demo';

export * from './types';
export * from './demo';

/**
 * Active adapters for AgentMesh.
 * Teammates can swap `demoAdapters` with production adapters (e.g. `productionAdapters`)
 * when connecting real blockchain and WebSocket backends.
 */
export const adapters = demoAdapters;
