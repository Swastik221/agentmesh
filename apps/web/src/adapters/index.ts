import { demoAdapters } from './demo';
import { liveAdapters } from './live';
import { getAppMode } from '../config/env';

export * from './types';
export * from './demo';
export * from './live';

/**
 * Dynamically resolves the active adapter suite based on current AppMode ('demo' | 'live').
 * When in Demo Mode, returns isolated, deterministic demo adapters.
 * When in Live Mode, returns production REST & WebSocket live adapters.
 */
export const getAdapters = () => {
  return getAppMode() === 'live' ? liveAdapters : demoAdapters;
};

/**
 * Proxy object ensuring callers access the current active adapter suite without
 * needing component code changes. Defaults to isolated `demoAdapters`.
 */
export const adapters = new Proxy(demoAdapters, {
  get(_target, prop: keyof typeof demoAdapters) {
    const active = getAdapters();
    return active[prop];
  },
});
