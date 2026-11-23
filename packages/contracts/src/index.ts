/**
 * @muxaro/contracts
 * 
 * Canonical system & API contracts for MUXARO Media Processing Platform.
 * Single source of truth for request/response schemas, status codes,
 * errors, real-time SSE telemetry, and unified quotas.
 */

// 1. Status Codes
export * from './status-codes.js';

// 2. Structured Errors & Responses
export * from './errors.js';

// 3. Media Inspection Contract
export * from './inspect.js';

// 4. Media Download & Job Creation Contract
export * from './download.js';

// 5. Real-Time Telemetry & SSE Contract
export * from './events.js';

// 6. Unified Quota Contract
export * from './quota.js';
