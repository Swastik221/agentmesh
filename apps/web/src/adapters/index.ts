import { liveAdapters } from './live';

export * from './types';
export * from './live';

/**
 * Returns the production live adapters suite.
 */
export const getAdapters = () => liveAdapters;

/**
 * Active production adapter suite for REST & WebSocket communication.
 */
export const adapters = liveAdapters;
