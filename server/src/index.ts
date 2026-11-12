import { createApp } from './app';
import { config } from './config';
import { closeDb, initDb } from './db';

async function main() {
  await initDb();
  const app = createApp();
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`[server] listening on ${config.HOST}:${config.PORT}`);
  });

  const onShutdown = async () => {
    console.log('[server] shutting down');
    await closeDb();
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', onShutdown);
  process.on('SIGINT', onShutdown);
}

main().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
