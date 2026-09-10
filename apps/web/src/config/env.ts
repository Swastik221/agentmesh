/**
 * AgentMesh Environment & Runtime Mode Configuration
 *
 * Provides central configuration for API endpoints, WebSocket servers, and
 * the active application execution mode (Demo vs Live).
 */

export type AppMode = 'demo' | 'live';

interface EnvConfig {
  apiUrl: string;
  wsUrl: string;
  mode: AppMode;
}

const getEnvVar = (key: string, defaultValue: string): string => {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return (import.meta.env[key] as string) || defaultValue;
  }
  return defaultValue;
};

// Internal mutable mode state for runtime switching (e.g. dev toggles)
let currentMode: AppMode = (getEnvVar('VITE_APP_MODE', 'demo') as AppMode) === 'live' ? 'live' : 'demo';

export const envConfig: EnvConfig = {
  get apiUrl(): string {
    return getEnvVar('VITE_API_URL', 'http://localhost:3001');
  },
  get wsUrl(): string {
    return getEnvVar('VITE_WS_URL', 'ws://localhost:3001');
  },
  get mode(): AppMode {
    return currentMode;
  },
};

/**
 * Get current active app mode ('demo' | 'live')
 */
export const getAppMode = (): AppMode => currentMode;

/**
 * Set current active app mode ('demo' | 'live')
 */
export const setAppMode = (mode: AppMode): void => {
  currentMode = mode;
};

/**
 * Check if app is running in Demo Mode
 */
export const isDemoMode = (): boolean => currentMode === 'demo';

/**
 * Check if app is running in Live Mode
 */
export const isLiveMode = (): boolean => currentMode === 'live';
