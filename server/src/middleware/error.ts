import { Request, Response, NextFunction } from 'express';

export function notFound(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response): void {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
