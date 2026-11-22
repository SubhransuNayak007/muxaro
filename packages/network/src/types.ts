/**
 * MUXARO / PROJECT GARUDA - High-Throughput Sovereign Network & Edge Acceleration
 * Type Definitions & System Contracts
 */

import type { Dispatcher } from 'undici';
import type { Readable } from 'node:stream';

// =============================================================================
// 1. IPV6 SUBNET SWARM TYPES
// =============================================================================

export type Ipv6AddressStrategy = 'uniform_random' | 'hash_affinity' | 'sequential_round_robin';

export interface Ipv6SubnetConfig {
  /**
   * The assigned IPv6 CIDR prefix block (e.g. '2001:db8:beef:cafe::/64' or '2a01:4f8:1c1c:4500::/48')
   */
  readonly prefixCidr: string;

  /**
   * Selection strategy for host address allocation
   * Default: 'uniform_random'
   */
  readonly strategy?: Ipv6AddressStrategy;

  /**
   * Optional IPv4 fallback gateway or address when target host has no AAAA records
   */
  readonly ipv4FallbackAddress?: string;

  /**
   * When true, Happy Eyeballs resolves DNS AAAA and A in parallel and binds
   * IPv6 if destination supports it, falling back to IPv4 if destination is v4-only.
   * Default: true
   */
  readonly enableHappyEyeballsFallback?: boolean;

  /**
   * Maximum concurrent connection sockets per origin
   * Default: 128
   */
  readonly maxSockets?: number;

  /**
   * Idle socket timeout in milliseconds
   * Default: 30_000 (30 seconds)
   */
  readonly keepAliveTimeoutMs?: number;
}

export interface SubnetAddressStats {
  readonly prefix: string;
  readonly prefixLength: number;
  readonly totalGenerated: number;
  readonly collisionsAvoided: number;
  readonly ipv4FallbackCount: number;
  readonly lastAllocatedAddress: string;
}

// =============================================================================
// 2. DIRECT 302 CDN TUNNELING TYPES
// =============================================================================

export type CdnTunnelProvider = 'tiktok' | 'instagram' | 'twitter' | 'youtube_progressive' | 'direct_generic';

export interface CdnRedirectPayload {
  /** Target upstream media URL (e.g., play_addr on TikTok CDN, scontent on Meta CDN) */
  readonly targetUrl: string;
  /** Platform identifier */
  readonly provider: CdnTunnelProvider;
  /** Human-readable sanitized filename for Content-Disposition */
  readonly filename: string;
  /** Expiration timestamp in seconds (epoch) */
  readonly exp: number;
  /** Optional client IP lock (for YouTube progressive formats) */
  readonly clientIp?: string;
  /** HMAC signature protecting payload integrity */
  readonly hmac?: string;
}

export interface Direct302TunnelConfig {
  /** HMAC secret key for signing redirect tokens */
  readonly secretKey: string;
  /** Default token time-to-live in seconds (default: 120s) */
  readonly tokenTtlSeconds?: number;
  /** Allowed target CDN hostnames or wildcard suffixes */
  readonly allowedDomains?: readonly string[];
  /** Telemetry callback invoked on redirect issuance */
  readonly onRedirectIssued?: (event: CdnRedirectEvent) => void;
}

export interface CdnRedirectEvent {
  readonly provider: CdnTunnelProvider;
  readonly targetHost: string;
  readonly estimatedSizeBytes?: number;
  readonly timestamp: number;
}

export interface DirectRedirectResult {
  readonly statusCode: 302 | 307;
  readonly headers: Record<string, string>;
  readonly redirectUrl: string;
}

// =============================================================================
// 3. MULTI-RANGE PARALLEL CHUNK STREAMING TYPES
// =============================================================================

export interface ChunkRange {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly totalLength: number;
}

export interface ParallelChunkStreamOptions {
  /** Upstream target media URL */
  readonly url: string;
  /** Size of each byte chunk in bytes (default: 8MB = 8 * 1024 * 1024) */
  readonly chunkSize?: number;
  /** Concurrency level: number of parallel range workers (8 to 16, default: 12) */
  readonly concurrency?: number;
  /** Maximum number of chunks buffered in memory before backpressure pauses workers (default: 16) */
  readonly maxBufferedChunks?: number;
  /** Maximum retry attempts per individual chunk before failing stream (default: 4) */
  readonly maxChunkRetries?: number;
  /** Request timeout per chunk in milliseconds (default: 15_000) */
  readonly chunkTimeoutMs?: number;
  /** Additional HTTP headers to pass upstream (e.g. User-Agent, Authorization) */
  readonly headers?: Record<string, string>;
  /** Optional custom Undici Dispatcher (e.g. configured with IPv6 subnet swarm) */
  readonly dispatcher?: Dispatcher;
  /** Optional AbortSignal for cancellation */
  readonly signal?: AbortSignal;
  /** Telemetry progress callback */
  readonly onProgress?: (progress: ParallelStreamProgress) => void;
}

export interface ParallelStreamProgress {
  readonly totalBytes: number;
  readonly downloadedBytes: number;
  readonly completedChunks: number;
  readonly totalChunks: number;
  readonly throughputBytesPerSec: number;
  readonly activeWorkers: number;
}

export interface ChunkStreamMetadata {
  readonly contentLength: number;
  readonly contentType: string;
  readonly acceptRanges: boolean;
  readonly eTag?: string;
  readonly lastModified?: string;
}

export interface ParallelChunkResult {
  readonly stream: Readable;
  readonly metadata: ChunkStreamMetadata;
  readonly abort: () => void;
}

// =============================================================================
// 4. JIO PEERING & GGC TOPOLOGY CONFIGURATION TYPES
// =============================================================================

export interface IxpPeeringConfig {
  readonly facilityName: string;
  readonly city: 'Mumbai' | 'Delhi' | 'Bengaluru' | 'Chennai' | 'Kolkata';
  readonly ixpName: 'NIXI' | 'DE-CIX India' | 'Extreme IX';
  readonly localAsn: number;
  readonly peerAsn: number;
  readonly peerIpv4: string;
  readonly peerIpv6: string;
  readonly bfdEnabled: boolean;
  readonly jumboFramesMtu: number;
  readonly tcpBbrEnabled: boolean;
}
