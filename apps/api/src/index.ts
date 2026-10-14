import { buildApp } from './app.js';
import { ConfigError, loadConfig, loadEnvFile } from './config.js';

loadEnvFile();

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await buildApp({ config });

  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      app.log.error('graceful shutdown timed out, exiting');
      process.exit(1);
    }, 15_000);
    force.unref();
    app
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.on('unhandledRejection', (reason) => app.log.error({ err: reason }, 'unhandled promise rejection'));

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.fatal({ err }, 'failed to start');
    await app.close().catch(() => undefined);
    process.exit(1);
  }
}

void main();
