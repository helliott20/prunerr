import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file (check parent directory for monorepo setup)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import config, { validateConfig } from './config';
import { initializeDatabase, closeDatabase } from './db';
import routes from './routes';
import logger, { morganStream } from './utils/logger';
import { initializeServices } from './services/init';
import { getScheduler } from './scheduler';

// Create Express application
const app = express();

// Validate configuration on startup
const configValidation = validateConfig();
if (!configValidation.valid) {
  logger.warn('Configuration warnings:');
  configValidation.errors.forEach((err) => logger.warn(`  - ${err}`));
}

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: config.nodeEnv === 'production' ? undefined : false,
  })
);

// CORS configuration
app.use(
  cors({
    origin: config.nodeEnv === 'production'
      ? process.env['CORS_ORIGIN'] || true
      : true,
    credentials: true,
  })
);

// Request logging
app.use(
  morgan(config.nodeEnv === 'production' ? 'combined' : 'dev', {
    stream: morganStream,
    skip: (req: Request) => req.path === '/api/health/ping',
  })
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files in production
// In Docker: /app/public (copied from client build)
// In local prod: ../../client/dist (relative to server/dist)
if (config.nodeEnv === 'production') {
  const dockerPath = path.join(__dirname, '../public');
  const localPath = path.join(__dirname, '../../client/dist');
  const clientPath = require('fs').existsSync(dockerPath) ? dockerPath : localPath;
  app.use(express.static(clientPath));
  logger.info(`Serving static files from: ${clientPath}`);
}

// API routes
app.use('/api', routes);

// Root health check redirect (convenience)
app.get('/health', (_req: Request, res: Response) => {
  res.redirect('/api/health');
});

// Serve client app for any other routes in production (SPA routing)
if (config.nodeEnv === 'production') {
  const dockerIndex = path.join(__dirname, '../public/index.html');
  const localIndex = path.join(__dirname, '../../client/dist/index.html');
  const indexPath = require('fs').existsSync(dockerIndex) ? dockerIndex : localIndex;

  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(indexPath);
  });
}

// 404 handler for API routes
app.use('/api/{*path}', (_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Global error handler
interface ErrorWithStatus extends Error {
  status?: number;
  statusCode?: number;
}

app.use((err: ErrorWithStatus, _req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.status || err.statusCode || 500;
  const message = config.nodeEnv === 'production'
    ? 'Internal server error'
    : err.message;

  logger.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    statusCode,
  });

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(config.nodeEnv !== 'production' && { stack: err.stack }),
  });
});

// Start server
async function startServer(): Promise<void> {
  try {
    // Initialize database
    logger.info('Initializing database...');
    initializeDatabase();

    // Initialize services (DeletionService, Sonarr, Radarr, Overseerr)
    await initializeServices();

    // Start the scheduler
    const scheduler = getScheduler();
    scheduler.start();
    logger.info('Scheduler started');

    // Start listening
    const server = app.listen(config.port, () => {
      logger.info(`Server started successfully`);
      logger.info(`  Environment: ${config.nodeEnv}`);
      logger.info(`  Port: ${config.port}`);
      logger.info(`  API: http://localhost:${config.port}/api`);
      logger.info(`  Health: http://localhost:${config.port}/api/health`);
    });

    // Graceful shutdown handlers
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal}, shutting down gracefully...`);

      // Stop the scheduler
      scheduler.stop();
      logger.info('Scheduler stopped');

      server.close(() => {
        logger.info('HTTP server closed');
        closeDatabase();
        logger.info('Database connection closed');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

export default app;
