import http from 'node:http';
import { createApp } from './app.js';
import { setupWebSocketServer } from './websocket/index.js';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { startOfferSweeper } from './services/task-offer.service.js';
import { terminalService } from './terminals/terminal.service.js';
import { sessionService } from './auth/session.service.js';

const app = createApp();
const server = http.createServer(app);
const wsServer = setupWebSocketServer(server);

// Open task-board offers are assigned when nobody claims them, which needs
// something to notice the deadline passing. Started here rather than in the
// app so importing the app (as every test does) does not start a timer that
// writes to the database.
const stopOfferSweeper = startOfferSweeper();

// No terminal can still be attached after a restart. Mark them DISCONNECTED so
// nobody sees a stale "live" session; each CLI resumes its own on reconnect.
void terminalService
  .reconcileOnStartup()
  .then((count) => count > 0 && logger.info(`Marked ${count} terminal session(s) disconnected after restart`))
  .catch((err: unknown) => logger.error('Terminal reconciliation failed:', err));

// An approved action that was mid-resume when the server stopped is marked
// FAILED (retryable by a human), never re-run on its own.
void import('./services/approval.service.js')
  .then(({ approvalService }) => approvalService.reconcileOnStartup())
  .then((count) => count > 0 && logger.info(`Marked ${count} interrupted approval resume(s) as failed`))
  .catch((err: unknown) => logger.error('Approval reconciliation failed:', err));

// Expired sessions, SIWE nonces and agent tokens can never authenticate
// anything; delete them so the tables do not grow without bound.
const purge = () =>
  void sessionService
    .purgeExpired()
    .catch((err: unknown) => logger.error('Credential cleanup failed:', err));
purge();
const purgeTimer = setInterval(purge, 10 * 60 * 1000);
purgeTimer.unref();

server.listen(config.port, () => {
  logger.info(`AgentMesh server listening on port ${config.port}`);
});

const gracefulShutdown = () => {
  logger.info('Shutting down AgentMesh server...');
  stopOfferSweeper();
  clearInterval(purgeTimer);
  wsServer.close();
  server.close(() => {
    logger.info('Server closed cleanly');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
