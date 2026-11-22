/**
 * MUXARO Media Processing Platform - API Entrypoint
 *
 * Exports buildServer and startServer from server.ts and maintains compatibility aliases.
 */

import { buildServer, startServer } from './server.js';

export { buildServer, startServer };

// Backward compatibility aliases
export const buildApp = buildServer;
export const start = startServer;

// Start server if executed as main entry
import { fileURLToPath } from 'node:url';
const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFilePath.endsWith(process.argv[1])) {
  startServer().catch((err) => {
    console.error('[MUXARO API] Fatal error starting server:', err);
    process.exit(1);
  });
}
