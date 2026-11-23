/**
 * MUXARO Origin Private File System (OPFS) Module
 * apps/web/lib/opfs/index.ts
 *
 * Public exports for zero-RAM 8K stream accumulation, OPFS disk streaming,
 * storage quota inspection, and fallback accumulation.
 */

export * from './types.ts';
export * from './opfs-storage.ts';
export * from './fallback-accumulator.ts';
export * from './opfs-writer.ts';
export * from './opfs-sink.ts';
