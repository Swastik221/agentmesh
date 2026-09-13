import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { DEFAULT_SIWE_CHAIN_ID } from '@agentmesh/shared';

// The server runs with its cwd at apps/server, where there is no .env: the file
// lives at the repo root. Loading only cwd meant `pnpm dev` (and every tsx-watch
// restart) started with no DATABASE_URL and could not reach the database. Load
// the repo-root .env explicitly, then fall back to cwd. In production nothing is
// on disk and env comes from the real environment; a missing file is a no-op.
const repoRootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.env');
dotenv.config({ path: repoRootEnv });
dotenv.config();

const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';

/**
 * The SIWE `domain` per EIP-4361 is the host that requested the signature,
 * host meaning hostname plus port. It must equal the browser origin's host, or
 * a spec-strict wallet (Phantom, and others) refuses to display the request as
 * a domain/origin mismatch. Default it to the web origin's host so it stays
 * correct in every environment without extra config; SIWE_DOMAIN still wins.
 */
const defaultSiweDomain = (() => {
  try {
    return new URL(webOrigin).host;
  } catch {
    return 'localhost';
  }
})();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  webOrigin,
  siweDomain: process.env.SIWE_DOMAIN || defaultSiweDomain,
  siweUri: process.env.SIWE_URI || webOrigin,
  siweChainId: parseInt(process.env.SIWE_CHAIN_ID || String(DEFAULT_SIWE_CHAIN_ID), 10),
  sessionMaxAgeMs: parseInt(process.env.SESSION_MAX_AGE_MS || '86400000', 10),
  maxArtifactPayloadBytes: parseInt(process.env.MAX_ARTIFACT_PAYLOAD_BYTES || '524288', 10), // 512KB
  maxArtifactsPerPage: parseInt(process.env.MAX_ARTIFACTS_PER_PAGE || '50', 10),
  maxDependencyTraversalDepth: parseInt(process.env.MAX_DEPENDENCY_TRAVERSAL_DEPTH || '10', 10),
  maxWorkspaceDeltaBytes: parseInt(process.env.MAX_WORKSPACE_DELTA_BYTES || '65536', 10), // 64KB
  /**
   * Absolute base directory that per-project workspaces are provisioned under.
   * Must be absolute: execution working directories are handed to agent
   * processes whose CWD is not the server's.
   */
  workspaceRoot: path.resolve(process.env.WORKSPACE_ROOT || path.join(process.cwd(), 'workspaces')),
  ensRpcUrl: process.env.ENS_RPC_URL || 'https://eth.llamarpc.com',
  ensTimeoutMs: parseInt(process.env.ENS_TIMEOUT_MS || '8000', 10),
};

export const validateProductionConfig = (envRecord: Record<string, string | undefined> = process.env): void => {
  if (envRecord.NODE_ENV === 'production') {
    const requiredVars = [
      'DATABASE_URL',
      'SIWE_DOMAIN',
      'SIWE_URI',
      'HEDERA_NETWORK',
      'HEDERA_PAYMENT_RECEIVER',
      'X402_FACILITATOR_URL',
    ];
    const missing = requiredVars.filter((key) => !envRecord[key] || envRecord[key]?.trim() === '');
    if (missing.length > 0) {
      throw new Error(`[ProductionConfigError] Production configuration error: Missing required production environment variables: ${missing.join(', ')}`);
    }

    if (envRecord.HEDERA_NETWORK && envRecord.HEDERA_NETWORK !== 'hedera:testnet') {
      throw new Error(`[ProductionConfigError] Production configuration error: HEDERA_NETWORK '${envRecord.HEDERA_NETWORK}' is invalid. Supported network is 'hedera:testnet'.`);
    }
  }
};

validateProductionConfig();
