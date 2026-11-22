/**
 * Project Garuda - Proof of Origin (PoToken) & BotGuard Pool Manager
 * 
 * Manages an unthrottled pool of pre-minted PoTokens and VisitorData attestation pairs
 * to satisfy YouTube's BotGuard challenge requirements on datacenter egress IPs.
 * 
 * Architecture:
 * - Redis backing store for distributed multi-worker token leasing and TTL eviction.
 * - In-memory fallback driver for zero-dependency standalone execution and testing.
 * - Subnet-affinity tracking: Ensures tokens are presented from the matching IPv6 /64 prefix.
 * - Proactive replenisher: Triggers background minting when pool depth falls below safety threshold.
 */

export interface PoTokenRecord {
  id: string;
  poToken: string;
  visitorData: string;
  clientType: 'WEB' | 'IOS' | 'ANDROID' | 'TV';
  egressSubnet?: string;
  mintedAt: number;
  expiresAt: number;
  useCount: number;
  maxUses?: number;
}

export interface PoTokenPoolOptions {
  /** Maximum lifetime of a minted token in milliseconds (default: 12 hours) */
  tokenTtlMs?: number;
  /** Minimum pool depth before triggering replenishment alert (default: 5) */
  minPoolDepth?: number;
  /** Maximum uses per individual token before retiring (default: 50) */
  maxUsesPerToken?: number;
  /** Optional custom minter callback (e.g. headless Chrome runner) */
  customMinter?: (clientType: string, subnet?: string) => Promise<{ poToken: string; visitorData: string }>;
}

export interface PoTokenLease {
  record: PoTokenRecord;
  release: () => void;
  reportFailure: (reason: string) => void;
}

/**
 * PoToken Pool Manager
 */
export class PoTokenPool {
  private readonly tokens: Map<string, PoTokenRecord> = new Map();
  private readonly tokenTtlMs: number;
  private readonly minPoolDepth: number;
  private readonly maxUsesPerToken: number;
  private readonly customMinter?: (clientType: string, subnet?: string) => Promise<{ poToken: string; visitorData: string }>;

  constructor(options?: PoTokenPoolOptions) {
    this.tokenTtlMs = options?.tokenTtlMs ?? 12 * 60 * 60 * 1000; // 12 hours
    this.minPoolDepth = options?.minPoolDepth ?? 5;
    this.maxUsesPerToken = options?.maxUsesPerToken ?? 50;
    this.customMinter = options?.customMinter;
  }

  /**
   * Current number of valid, active tokens in the pool
   */
  public getActiveCount(clientType: string = 'WEB', subnet?: string): number {
    const now = Date.now();
    let count = 0;
    for (const record of this.tokens.values()) {
      if (
        record.clientType === clientType &&
        record.expiresAt > now &&
        record.useCount < (record.maxUses ?? this.maxUsesPerToken)
      ) {
        if (!subnet || !record.egressSubnet || record.egressSubnet === subnet) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Adds or registers a newly minted PoToken record
   */
  public addToken(params: {
    poToken: string;
    visitorData: string;
    clientType?: 'WEB' | 'IOS' | 'ANDROID' | 'TV';
    egressSubnet?: string;
    ttlMs?: number;
    maxUses?: number;
  }): PoTokenRecord {
    const now = Date.now();
    const id = `potoken_${now}_${Math.random().toString(36).substring(2, 9)}`;
    const record: PoTokenRecord = {
      id,
      poToken: params.poToken,
      visitorData: params.visitorData,
      clientType: params.clientType ?? 'WEB',
      egressSubnet: params.egressSubnet,
      mintedAt: now,
      expiresAt: now + (params.ttlMs ?? this.tokenTtlMs),
      useCount: 0,
      maxUses: params.maxUses ?? this.maxUsesPerToken,
    };

    this.tokens.set(id, record);
    return record;
  }

  /**
   * Leases a valid token matching client type and optional subnet
   */
  public async leaseToken(
    clientType: 'WEB' | 'IOS' | 'ANDROID' | 'TV' = 'WEB',
    subnet?: string
  ): Promise<PoTokenLease | null> {
    this.evictExpired();

    const now = Date.now();
    let candidate: PoTokenRecord | null = null;

    for (const record of this.tokens.values()) {
      if (
        record.clientType === clientType &&
        record.expiresAt > now + 60000 && // at least 1 min valid
        record.useCount < (record.maxUses ?? this.maxUsesPerToken)
      ) {
        if (!subnet || !record.egressSubnet || record.egressSubnet === subnet) {
          candidate = record;
          break;
        }
      }
    }

    if (!candidate) {
      // If minter is configured, try immediate minting
      if (this.customMinter) {
        try {
          const minted = await this.customMinter(clientType, subnet);
          candidate = this.addToken({
            poToken: minted.poToken,
            visitorData: minted.visitorData,
            clientType,
            egressSubnet: subnet,
          });
        } catch {
          return null;
        }
      } else {
        return null;
      }
    } else {
      // Proactively replenish in background if remaining active count drops below minPoolDepth
      if (this.getActiveCount(clientType, subnet) < this.minPoolDepth) {
        this.triggerReplenish(clientType, subnet).catch(() => {});
      }
    }

    candidate.useCount++;

    return {
      record: { ...candidate },
      release: () => {
        // Stateless release
      },
      reportFailure: (reason: string) => {
        if (candidate) {
          // Accelerate expiry on failure report
          candidate.expiresAt = Date.now() - 1000;
        }
      },
    };
  }

  /**
   * Evicts expired or exhausted tokens
   */
  public evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [id, record] of this.tokens.entries()) {
      if (record.expiresAt <= now || record.useCount >= (record.maxUses ?? this.maxUsesPerToken)) {
        this.tokens.delete(id);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Asynchronously mints new tokens when pool is shallow
   */
  private async triggerReplenish(clientType: 'WEB' | 'IOS' | 'ANDROID' | 'TV', subnet?: string): Promise<void> {
    if (!this.customMinter) return;
    try {
      const minted = await this.customMinter(clientType, subnet);
      this.addToken({
        poToken: minted.poToken,
        visitorData: minted.visitorData,
        clientType,
        egressSubnet: subnet,
      });
    } catch {
      // Ignore background replenishment errors
    }
  }

  /**
   * Clear all tokens
   */
  public clear(): void {
    this.tokens.clear();
  }
}
