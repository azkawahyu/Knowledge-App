import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { authRouter } from './routes/auth';
import { ingestRouter } from './routes/ingest';
import { searchRouter } from './routes/search';
import { chatRouter } from './routes/chat';
import { libraryRouter } from './routes/library';
import { auditRouter } from './routes/audit';
import { authMiddleware } from './middleware/auth';
import { notFound, errorHandler } from './middleware/error';

export function createApp() {
  const app = express();

  app.use((req, res, next) => {
    const origin = req.header('Origin');
    const allowed = ['http://localhost:3000', 'http://127.0.0.1:3000'];
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
    } else {
      next();
    }
  });

  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  const limiter = rateLimit({
    windowMs: 60_000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'knowledge-app',
      time: new Date().toISOString(),
    });
  });

  app.use('/api/auth', authRouter);

  app.use('/api/ingest', authMiddleware, ingestRouter);
  app.use('/api/search', authMiddleware, searchRouter);
  app.use('/api/chat', authMiddleware, chatRouter);
  app.use('/api/library', authMiddleware, libraryRouter);
  app.use('/api/audit', authMiddleware, auditRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
