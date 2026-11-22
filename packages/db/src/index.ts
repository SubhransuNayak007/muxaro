/**
 * MUXARO Media Processing Platform - Database & Cache Client Library
 * 
 * Re-exports Drizzle ORM schema models, relations, connection factory,
 * and typed Redis client topology helpers.
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { createMockDb } from './mock.js';

export * from './schema.js';
export * from './redis.js';
export * from './mock.js';
export * from 'drizzle-orm';

let globalDb: any = null;
let globalSqlClient: ReturnType<typeof postgres> | null = null;

/**
 * Overrides or sets the active database client instance (e.g. for testing)
 */
export function setDb(customDb: any): void {
  globalDb = customDb;
}

/**
 * Returns a singleton Drizzle ORM PostgreSQL database client
 */
export function getDb(
  connectionString?: string,
  options?: postgres.Options<any>
): PostgresJsDatabase<typeof schema> {
  if (globalDb) {
    return globalDb;
  }

  if (process.env.MOCK_DB === 'true' || (!process.env.DATABASE_URL && process.env.MOCK_DB !== 'false')) {
    globalDb = createMockDb();
    return globalDb;
  }

  const url =
    connectionString ||
    process.env.DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/muxaro';

  globalSqlClient = postgres(url, {
    max: options?.max ?? 20,
    idle_timeout: options?.idle_timeout ?? 30,
    connect_timeout: options?.connect_timeout ?? 10,
    ...(options || {}),
  });

  globalDb = drizzle(globalSqlClient, { schema });
  return globalDb;
}

/**
 * Closes the active database connection pool during graceful shutdown
 */
export async function closeDb(): Promise<void> {
  if (globalSqlClient) {
    await globalSqlClient.end({ timeout: 5 });
    globalSqlClient = null;
    globalDb = null;
  }
}
