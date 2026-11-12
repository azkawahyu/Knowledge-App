// Minimal structured logger.
// Lightweight: writes JSON lines to stdout. Log level filtering is handled at
// the process level (LOG_LEVEL env var) in config/index.ts.

import { config } from '../config';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

function levelMin(level: Level): number {
  return LEVELS.indexOf(level);
}

function shouldLog(level: Level): boolean {
  const min = levelMin(config.LOG_LEVEL?.toLowerCase() as Level) ?? levelMin('info');
  return levelMin(level) >= min;
}

function fmt(level: Level, msg: string, opts: Record<string, unknown> = {}): string {
  const entry: Record<string, unknown> = {
    level,
    msg,
    ts: new Date().toISOString(),
  };
  for (const [k, v] of Object.entries(opts)) {
    entry[k] = v;
  }
  return JSON.stringify(entry);
}

export const logger = {
  debug(msg: string, opts?: Record<string, unknown>) {
    if (shouldLog('debug')) console.error(fmt('debug', msg, opts));
  },
  info(msg: string, opts?: Record<string, unknown>) {
    if (shouldLog('info')) console.log(fmt('info', msg, opts));
  },
  warn(msg: string, opts?: Record<string, unknown>) {
    if (shouldLog('warn')) console.warn(fmt('warn', msg, opts));
  },
  error(msg: string, opts?: Record<string, unknown>) {
    console.error(fmt('error', msg, opts));
  },
};
