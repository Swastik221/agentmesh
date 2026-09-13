import http from 'node:http';
import { createApp } from './app.js';
import { setupWebSocketServer } from './websocket/index.js';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { startOfferSweeper } from './services/task-offer.service.js';

const app = createApp();
const server = http.createServer(app);
const wsServer = setupWebSocketServer(server);

// Open task-board offers are assigned when nobody claims them, which needs
// something to notice the deadline passing. Started here rather than in the
// app so importing the app (as every test does) does not start a timer that
// writes to the database.
const stopOfferSweeper = startOfferSweeper();

server.listen(config.port, () => {
  logger.info(`AgentMesh server listening on port ${config.port}`);
});

const gracefulShutdown = () => {
  logger.info('Shutting down AgentMesh server...');
  stopOfferSweeper();
  wsServer.close();
  server.close(() => {
    logger.info('Server closed cleanly');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
