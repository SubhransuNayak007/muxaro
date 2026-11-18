/**
 * Project MUXARO - API Server Entrypoint
 */

import { buildApp } from './app.js';
import { config } from './config.js';

async function start() {
  const app = await buildApp();

  try {
    const address = await app.listen({ port: config.port, host: config.host });
    console.log(`[MUXARO API] Server listening at ${address}`);
    console.log(`[MUXARO API] Swagger OpenAPI UI documentation available at ${address}/docs`);
    console.log(`[MUXARO API] Health check at ${address}/api/v1/health`);
  } catch (err) {
    console.error('[MUXARO API] Failed to start server:', err);
    process.exit(1);
  }

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) {
    process.on(sig, async () => {
      console.log(`[MUXARO API] Received ${sig}, gracefully shutting down...`);
      try {
        await app.close();
        console.log('[MUXARO API] Server shut down cleanly.');
        process.exit(0);
      } catch (err) {
        console.error('[MUXARO API] Error during shutdown:', err);
        process.exit(1);
      }
    });
  }
}

// Start server
start().catch((err) => {
  console.error('[MUXARO API] Fatal error starting server:', err);
  process.exit(1);
});

export { buildApp, start };
