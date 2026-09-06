import http from 'node:http';
import { createApp } from './app.js';
import { setupWebSocketServer } from './websocket/index.js';
import { config } from './config/index.js';
import { logger } from './lib/logger.js';

const app = createApp();
const server = http.createServer(app);
const wsServer = setupWebSocketServer(server);

server.listen(config.port, () => {
  logger.info(`AgentMesh server listening on port ${config.port}`);
});

const gracefulShutdown = () => {
  logger.info('Shutting down AgentMesh server...');
  wsServer.close();
  server.close(() => {
    logger.info('Server closed cleanly');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
