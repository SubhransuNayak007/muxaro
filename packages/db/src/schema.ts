/**
 * MUXARO Media Processing Platform - Drizzle ORM Relational Schema
 * 
 * Strict TypeScript schema definition matching packages/db/schema.sql (PostgreSQL 16+).
 * Includes table definitions, relations, inferred select/insert types, and indexes.
 */

import { relations, sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  bigint,
  numeric,
  jsonb,
  timestamp,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// =============================================================================
// 1. USERS TABLE
// =============================================================================

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: varchar('email', { length: 255 }).unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    tier: varchar('tier', { length: 32 }).notNull().default('guest'), // 'guest', 'free_account', 'pro'
    passwordHash: varchar('password_hash', { length: 255 }),
    displayName: varchar('display_name', { length: 128 }),
    avatarUrl: text('avatar_url'),
    metadataJson: jsonb('metadata_json').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_users_tier').on(table.tier),
    index('idx_users_email').on(table.email),
    index('idx_users_created_at').on(table.createdAt),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// =============================================================================
// 2. UPLOAD SESSIONS TABLE (Direct-to-R2 Resumable Multipart Uploads)
// =============================================================================

export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    guestIpHash: varchar('guest_ip_hash', { length: 64 }),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mimeType: varchar('mime_type', { length: 128 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    chunkSize: integer('chunk_size').notNull().default(16777216), // 16 MB
    totalChunks: integer('total_chunks').notNull().default(1),
    tool: varchar('tool', { length: 32 }).notNull(),
    targetFormat: varchar('target_format', { length: 16 }),
    status: varchar('status', { length: 32 }).notNull().default('initiated'), // 'initiated', 'uploading', 'completed', 'aborted', 'expired'
    partsJson: jsonb('parts_json').notNull().default(sql`'[]'::jsonb`),
    retentionTier: varchar('retention_tier', { length: 16 }).notNull().default('60m'), // '60m', '24h'
    magicBytesVerified: boolean('magic_bytes_verified').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_upload_sessions_user').on(table.userId, table.createdAt),
    index('idx_upload_sessions_guest').on(table.guestIpHash, table.createdAt),
    index('idx_upload_sessions_status').on(table.status),
    index('idx_upload_sessions_expires_at').on(table.expiresAt),
  ]
);

export type UploadSession = typeof uploadSessions.$inferSelect;
export type NewUploadSession = typeof uploadSessions.$inferInsert;

// =============================================================================
// 3. MEDIA JOBS TABLE (Multi-Lane Processing & State Tracking)
// =============================================================================

export const mediaJobs = pgTable(
  'media_jobs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    guestIpHash: varchar('guest_ip_hash', { length: 64 }),
    guestSessionHash: varchar('guest_session_hash', { length: 64 }),
    tool: varchar('tool', { length: 32 }).notNull(), // 'convert_video', 'extract_audio', 'merge_av', 'batch_playlist'
    status: varchar('status', { length: 32 }).notNull().default('pending'), // 'pending', 'queued', 'processing', 'completed', 'failed', 'cancelled'
    lane: varchar('lane', { length: 32 }).notNull().default('fast_io'), // 'fast_io', 'transcode', 'batch'
    priority: integer('priority').notNull().default(10),
    sourceUrl: text('source_url'),
    uploadSessionId: uuid('upload_session_id').references(() => uploadSessions.id, {
      onDelete: 'set null',
    }),
    targetFormat: varchar('target_format', { length: 16 }).notNull(),
    targetResolution: varchar('target_resolution', { length: 16 }),
    optionsJson: jsonb('options_json').notNull().default(sql`'{}'::jsonb`),
    outputStorageKey: text('output_storage_key'),
    outputFilename: text('output_filename'),
    outputSizeBytes: bigint('output_size_bytes', { mode: 'number' }),
    outputMimeType: varchar('output_mime_type', { length: 128 }),
    durationSeconds: numeric('duration_seconds', { precision: 10, scale: 3 }),
    progressPercent: numeric('progress_percent', { precision: 5, scale: 2 })
      .notNull()
      .default('0.00'),
    stage: varchar('stage', { length: 32 }).notNull().default('queued'),
    stageMessage: text('stage_message'),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    idempotencyKey: varchar('idempotency_key', { length: 128 }).unique(),
    workerId: varchar('worker_id', { length: 128 }),
    retentionTier: varchar('retention_tier', { length: 16 }).notNull().default('60m'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_media_jobs_status_lane').on(table.status, table.lane, table.priority, table.createdAt),
    index('idx_media_jobs_user').on(table.userId, table.createdAt),
    index('idx_media_jobs_guest').on(table.guestIpHash, table.createdAt),
    index('idx_media_jobs_guest_session').on(table.guestSessionHash, table.createdAt),
    index('idx_media_jobs_expires_at').on(table.expiresAt),
    index('idx_media_jobs_worker').on(table.workerId, table.status),
    index('idx_media_jobs_idempotency').on(table.idempotencyKey),
  ]
);

export type MediaJob = typeof mediaJobs.$inferSelect;
export type NewMediaJob = typeof mediaJobs.$inferInsert;

// =============================================================================
// 4. DAILY USAGE LEDGER TABLE
// =============================================================================

export const dailyUsageLedger = pgTable(
  'daily_usage_ledger',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    subjectKey: varchar('subject_key', { length: 128 }).notNull(), // 'user:UUID' or 'guest:IP_HASH'
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    usageDate: date('usage_date').notNull().defaultNow(),
    tier: varchar('tier', { length: 32 }).notNull().default('guest'),
    jobsCount: integer('jobs_count').notNull().default(0),
    bandwidthBytes: bigint('bandwidth_bytes', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_daily_usage_subject_date').on(table.subjectKey, table.usageDate),
    index('idx_daily_usage_date').on(table.usageDate),
    index('idx_daily_usage_user').on(table.userId, table.usageDate),
  ]
);

export type DailyUsage = typeof dailyUsageLedger.$inferSelect;
export type NewDailyUsage = typeof dailyUsageLedger.$inferInsert;

// =============================================================================
// 5. SERVICE INCIDENTS TABLE
// =============================================================================

export const serviceIncidents = pgTable(
  'service_incidents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    serviceName: varchar('service_name', { length: 64 }).notNull(),
    incidentType: varchar('incident_type', { length: 64 }).notNull(),
    severity: varchar('severity', { length: 32 }).notNull().default('medium'),
    detailsJson: jsonb('details_json').notNull().default(sql`'{}'::jsonb`),
    resolved: boolean('resolved').notNull().default(false),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('idx_service_incidents_active').on(table.serviceName, table.createdAt),
    index('idx_service_incidents_severity').on(table.severity, table.createdAt),
  ]
);

export type ServiceIncident = typeof serviceIncidents.$inferSelect;
export type NewServiceIncident = typeof serviceIncidents.$inferInsert;

// =============================================================================
// DRIZZLE RELATIONS
// =============================================================================

export const usersRelations = relations(users, ({ many }) => ({
  uploadSessions: many(uploadSessions),
  mediaJobs: many(mediaJobs),
  dailyUsages: many(dailyUsageLedger),
}));

export const uploadSessionsRelations = relations(uploadSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [uploadSessions.userId],
    references: [users.id],
  }),
  mediaJobs: many(mediaJobs),
}));

export const mediaJobsRelations = relations(mediaJobs, ({ one }) => ({
  user: one(users, {
    fields: [mediaJobs.userId],
    references: [users.id],
  }),
  uploadSession: one(uploadSessions, {
    fields: [mediaJobs.uploadSessionId],
    references: [uploadSessions.id],
  }),
}));

export const dailyUsageLedgerRelations = relations(dailyUsageLedger, ({ one }) => ({
  user: one(users, {
    fields: [dailyUsageLedger.userId],
    references: [users.id],
  }),
}));
