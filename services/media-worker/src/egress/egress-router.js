'use strict';

/**
 * egress-router.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Autonomous Egress Proxy Router for MUXARO Media Worker
 *
 * • Reads EGRESS_PROXY_LIST (comma-separated proxy URLs) from env.
 * • Every 10 minutes a health canary probes each proxy against a known public
 *   test endpoint and marks unhealthy proxies in Redis with a 10-minute TTL.
 * • selectProxy()        → first healthy proxy URL, or null for direct egress.
 * • markProxyFailed()    → immediately marks a proxy bad (called by callers on
 *                          connection errors during real traffic).
 * • getProxyHealth()     → current snapshot of proxy health state.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { createClient } = require('redis');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CANARY_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const CANARY_INTERVAL_MS  = 10 * 60 * 1000; // 10 minutes
const COOLDOWN_TTL_S      = 10 * 60;         // 10 minutes in seconds
const CANARY_TIMEOUT_MS   = 15_000;          // 15-second probe timeout
const REDIS_KEY_PREFIX    = 'egress:unhealthy:';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** @type {string[]} */
const proxyList = (process.env.EGRESS_PROXY_LIST || '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

/** @type {import('redis').RedisClientType|null} */
let redisClient = null;

/** canary timer handle */
let canaryTimer = null;

/** In-memory fallback when Redis is unavailable */
const localUnhealthySet = new Set();

// ---------------------------------------------------------------------------
// Redis helpers
// ---------------------------------------------------------------------------

async function getRedis() {
  if (redisClient && redisClient.isOpen) return redisClient;

  const url = process.env.REDIS_URL || 'redis://redis:6379/0';
  const client = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
    },
  });

  client.on('error', (err) => {
    // Log but do not crash — egress falls back to local set
    console.error('[egress-router] Redis error:', err.message);
  });

  await client.connect().catch((err) => {
    console.warn('[egress-router] Redis connect failed, using local fallback:', err.message);
  });

  redisClient = client;
  return client;
}

async function redisSetCooldown(proxyUrl) {
  try {
    const client = await getRedis();
    if (!client.isOpen) throw new Error('not open');
    const key = `${REDIS_KEY_PREFIX}${proxyUrl}`;
    await client.set(key, '1', { EX: COOLDOWN_TTL_S });
  } catch {
    localUnhealthySet.add(proxyUrl);
    // Auto-clear local entry after TTL
    setTimeout(() => localUnhealthySet.delete(proxyUrl), COOLDOWN_TTL_S * 1000);
  }
}

async function redisIsUnhealthy(proxyUrl) {
  if (localUnhealthySet.has(proxyUrl)) return true;
  try {
    const client = await getRedis();
    if (!client.isOpen) return false;
    const key = `${REDIS_KEY_PREFIX}${proxyUrl}`;
    const val = await client.get(key);
    return val !== null;
  } catch {
    return false;
  }
}

async function redisTtl(proxyUrl) {
  try {
    const client = await getRedis();
    if (!client.isOpen) return -1;
    const key = `${REDIS_KEY_PREFIX}${proxyUrl}`;
    return await client.ttl(key);
  } catch {
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Canary probe
// ---------------------------------------------------------------------------

/**
 * Probe a single proxy against CANARY_URL.
 * Returns true if reachable and returns HTTP 200.
 *
 * @param {string|null} proxyUrl  null = direct
 * @returns {Promise<boolean>}
 */
async function probeProxy(proxyUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CANARY_TIMEOUT_MS);

  try {
    const fetchOptions = {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
    };

    // Node 18+ built-in fetch doesn't support proxy natively;
    // when a proxy is configured, prefer using node-fetch + https-proxy-agent
    // if available, otherwise fall back to env-var tunnel (HTTP_PROXY).
    if (proxyUrl) {
      // Try to use https-proxy-agent if installed (best-effort)
      try {
        const { HttpsProxyAgent } = require('https-proxy-agent');
        // @ts-ignore — dispatcher is an undici concept; node-fetch uses agent
        fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
      } catch {
        // Package not installed; set env vars so underlying http stack honours them
        process.env.HTTPS_PROXY = proxyUrl;
        process.env.HTTP_PROXY  = proxyUrl;
      }
    }

    const res = await fetch(CANARY_URL, fetchOptions);
    clearTimeout(timer);
    return res.status === 200;
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[egress-router] canary probe failed for ${proxyUrl ?? 'direct'}: ${err.message}`);
    return false;
  }
}

/**
 * Run the full canary sweep across all configured proxies.
 */
async function runHealthCanary() {
  if (proxyList.length === 0) return; // nothing to check

  console.info('[egress-router] Running health canary sweep…');

  await Promise.allSettled(
    proxyList.map(async (proxy) => {
      const healthy = await probeProxy(proxy);
      if (!healthy) {
        console.warn(`[egress-router] Proxy ${proxy} failed canary — marking with ${COOLDOWN_TTL_S}s cooldown`);
        await redisSetCooldown(proxy);
      } else {
        console.info(`[egress-router] Proxy ${proxy} is healthy`);
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the first healthy proxy URL, or null for direct (no proxy) egress.
 *
 * @returns {Promise<string|null>}
 */
async function selectProxy() {
  if (proxyList.length === 0) return null;

  for (const proxy of proxyList) {
    const unhealthy = await redisIsUnhealthy(proxy);
    if (!unhealthy) return proxy;
  }

  // All proxies in cooldown → fall back to direct
  console.warn('[egress-router] All proxies in cooldown, falling back to direct egress');
  return null;
}

/**
 * Immediately mark a proxy as failed (called by callers on live-traffic errors).
 *
 * @param {string} proxyUrl
 * @param {string} [reason]
 */
async function markProxyFailed(proxyUrl, reason = 'unknown') {
  console.warn(`[egress-router] Marking proxy ${proxyUrl} as failed — reason: ${reason}`);
  await redisSetCooldown(proxyUrl);
}

/**
 * Returns a snapshot of all proxy health states.
 *
 * @returns {Promise<Array<{proxy: string, healthy: boolean, cooldownTtlSeconds: number}>>}
 */
async function getProxyHealth() {
  return Promise.all(
    proxyList.map(async (proxy) => {
      const unhealthy = await redisIsUnhealthy(proxy);
      const ttl = unhealthy ? await redisTtl(proxy) : 0;
      return {
        proxy,
        healthy: !unhealthy,
        cooldownTtlSeconds: ttl < 0 ? 0 : ttl,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Initialise canary timer (starts immediately, then repeats every 10 min)
// ---------------------------------------------------------------------------

function startCanary() {
  if (canaryTimer) return; // idempotent

  // Fire immediately on startup, then schedule repeating interval
  runHealthCanary().catch(() => {});
  canaryTimer = setInterval(() => {
    runHealthCanary().catch(() => {});
  }, CANARY_INTERVAL_MS);

  // Don't block process exit
  if (canaryTimer.unref) canaryTimer.unref();

  console.info(
    `[egress-router] Canary started — ${proxyList.length} proxy(ies) configured, ` +
    `interval ${CANARY_INTERVAL_MS / 60_000} min`,
  );
}

// Auto-start when the module is first loaded
startCanary();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  selectProxy,
  markProxyFailed,
  getProxyHealth,
  /** Exposed for testing / manual canary trigger */
  runHealthCanary,
};
