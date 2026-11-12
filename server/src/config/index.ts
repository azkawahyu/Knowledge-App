import dotenv from 'dotenv';
dotenv.config();

export const config = {
  PORT: Number(process.env.PORT) || 4000,
  HOST: process.env.HOST || '127.0.0.1',
  DATABASE_URL: process.env.DATABASE_URL || '',
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-change-me',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  OPENAI_BASE_URL: (process.env.OPENAI_BASE_URL || 'https://openagentic.id/api/v1').replace(/\/+$/, ''),
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-6-luna',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_MAX_TOKENS: Math.max(256, Math.min(8192, Number(process.env.OPENAI_MAX_TOKENS) || 2048)),
};
