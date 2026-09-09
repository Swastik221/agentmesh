import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load root .env first, then fallback to local process.env
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

import { demoOrchestrator } from './demo-orchestrator.js';

async function main() {
  try {
    console.log('Starting AgentMesh PRD-38 Live Hedera E2E Demo...\n');
    const result = await demoOrchestrator.runDemo({ mockHederaSettlement: false });
    console.log(`\nLive E2E Demo Finished Successfully. Real Hedera Transaction: ${result.transactionReference}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nLive E2E Execution Failed:\n${message}\n`);
    process.exit(1);
  }
}

main();
