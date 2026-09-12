/**
 * AgentMesh Environment Configuration
 *
 * Provides central configuration for API endpoints and WebSocket servers.
 * Product mode is strictly LIVE.
 */

export type AppMode = 'live';

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

export const envConfig: EnvConfig = {
  get apiUrl(): string {
    return getEnvVar('VITE_API_URL', 'http://localhost:3001');
  },
  get wsUrl(): string {
    return getEnvVar('VITE_WS_URL', 'ws://localhost:3001');
  },
  get mode(): AppMode {
    return 'live';
  },
};

/**
 * Get current active app mode (always 'live')
 */
export const getAppMode = (): AppMode => 'live';

/**
 * Check if app is running in Demo Mode (always false)
 */
export const isDemoMode = (): boolean => false;

/**
 * Check if app is running in Live Mode (always true)
 */
export const isLiveMode = (): boolean => true;
