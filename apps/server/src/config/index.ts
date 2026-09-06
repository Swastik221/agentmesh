import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  siweDomain: process.env.SIWE_DOMAIN || 'localhost',
  siweUri: process.env.SIWE_URI || 'http://localhost:5173',
  siweChainId: parseInt(process.env.SIWE_CHAIN_ID || '11155111', 10),
  sessionMaxAgeMs: parseInt(process.env.SESSION_MAX_AGE_MS || '86400000', 10),
};
