export const logger = {
  info: (msg: string, ...args: unknown[]): void => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]): void => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]): void => console.error(`[ERROR] ${msg}`, ...args),
};
