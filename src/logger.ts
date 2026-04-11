import pino from 'pino';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { appConfig } from './config.js';

const logsDir = resolve(appConfig.dataDir, 'logs');
mkdirSync(logsDir, { recursive: true });

const fileDest = pino.destination({ dest: resolve(logsDir, 'app.log'), sync: true });

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
}, pino.multistream([
  { stream: process.stdout, level: 'trace' },
  { stream: fileDest, level: 'trace' },
]));
