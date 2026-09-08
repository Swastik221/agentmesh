import dotenv from 'dotenv';
import { DEFAULT_SIWE_CHAIN_ID } from '@agentmesh/shared';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  siweDomain: process.env.SIWE_DOMAIN || 'localhost',
  siweUri: process.env.SIWE_URI || 'http://localhost:5173',
  siweChainId: parseInt(process.env.SIWE_CHAIN_ID || String(DEFAULT_SIWE_CHAIN_ID), 10),
  sessionMaxAgeMs: parseInt(process.env.SESSION_MAX_AGE_MS || '86400000', 10),
  maxArtifactPayloadBytes: parseInt(process.env.MAX_ARTIFACT_PAYLOAD_BYTES || '524288', 10), // 512KB
  maxArtifactsPerPage: parseInt(process.env.MAX_ARTIFACTS_PER_PAGE || '50', 10),
  maxDependencyTraversalDepth: parseInt(process.env.MAX_DEPENDENCY_TRAVERSAL_DEPTH || '10', 10),
  maxWorkspaceDeltaBytes: parseInt(process.env.MAX_WORKSPACE_DELTA_BYTES || '65536', 10), // 64KB
};
