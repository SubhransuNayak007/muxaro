/**
 * Tests for Proof of Origin (PoToken) Pool Manager
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PoTokenPool } from '../src/potoken-pool.ts';

describe('PoToken & BotGuard Pool Manager Tests', () => {
  it('should register and track active tokens', () => {
    const pool = new PoTokenPool({ minPoolDepth: 2, maxUsesPerToken: 10 });
    assert.strictEqual(pool.getActiveCount('WEB'), 0);

    pool.addToken({
      poToken: 'token_alpha',
      visitorData: 'visitor_1',
      clientType: 'WEB',
    });

    assert.strictEqual(pool.getActiveCount('WEB'), 1);
  });

  it('should lease and track usage count of tokens', async () => {
    const pool = new PoTokenPool({ maxUsesPerToken: 2 });
    pool.addToken({
      poToken: 'token_beta',
      visitorData: 'visitor_2',
      clientType: 'WEB',
    });

    const lease1 = await pool.leaseToken('WEB');
    assert(lease1);
    assert.strictEqual(lease1.record.poToken, 'token_beta');
    assert.strictEqual(lease1.record.useCount, 1);

    const lease2 = await pool.leaseToken('WEB');
    assert(lease2);
    assert.strictEqual(lease2.record.useCount, 2);

    // Max uses reached (2), next lease should return null
    const lease3 = await pool.leaseToken('WEB');
    assert.strictEqual(lease3, null);
  });

  it('should filter tokens by subnet affinity', async () => {
    const pool = new PoTokenPool();
    pool.addToken({
      poToken: 'token_subnet_a',
      visitorData: 'vis_a',
      clientType: 'WEB',
      egressSubnet: '2405:201:6800::/64',
    });
    pool.addToken({
      poToken: 'token_subnet_b',
      visitorData: 'vis_b',
      clientType: 'WEB',
      egressSubnet: '2405:201:6801::/64',
    });

    const leaseA = await pool.leaseToken('WEB', '2405:201:6800::/64');
    assert(leaseA);
    assert.strictEqual(leaseA.record.poToken, 'token_subnet_a');

    const leaseB = await pool.leaseToken('WEB', '2405:201:6801::/64');
    assert(leaseB);
    assert.strictEqual(leaseB.record.poToken, 'token_subnet_b');
  });

  it('should evict expired tokens', () => {
    const pool = new PoTokenPool();
    // Add token with expired TTL
    pool.addToken({
      poToken: 'token_expired',
      visitorData: 'vis_exp',
      clientType: 'WEB',
      ttlMs: -1000,
    });

    assert.strictEqual(pool.getActiveCount('WEB'), 0);
    const evicted = pool.evictExpired();
    assert.strictEqual(evicted, 1);
  });

  it('should trigger custom minter when pool is exhausted', async () => {
    let mintCount = 0;
    const pool = new PoTokenPool({
      customMinter: async (clientType) => {
        mintCount++;
        return {
          poToken: `minted_token_${mintCount}`,
          visitorData: `minted_visitor_${mintCount}`,
        };
      },
    });

    const lease = await pool.leaseToken('WEB');
    assert(lease);
    assert.strictEqual(lease.record.poToken, 'minted_token_1');
    assert.strictEqual(mintCount, 1);
  });
});
