import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  '169.254.169.254',
]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return -1;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isPrivateOrReservedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n < 0) return true;
  const inCidr = (base: string, bits: number) => {
    const b = ipv4ToInt(base);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inCidr('0.0.0.0', 8) ||
    inCidr('10.0.0.0', 8) ||
    inCidr('100.64.0.0', 10) || // CGNAT / carrier-grade NAT
    inCidr('127.0.0.0', 8) ||
    inCidr('169.254.0.0', 16) || // Link-local & cloud metadata
    inCidr('172.16.0.0', 12) ||
    inCidr('192.0.0.0', 24) ||
    inCidr('192.0.2.0', 24) ||
    inCidr('192.168.0.0', 16) ||
    inCidr('198.18.0.0', 15) ||
    inCidr('198.51.100.0', 24) ||
    inCidr('203.0.113.0', 24) ||
    inCidr('224.0.0.0', 4) || // Multicast / reserved
    inCidr('240.0.0.0', 4)
  );
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, '').split('%')[0];
  const ver = net.isIP(trimmed);
  if (ver === 4) return isPrivateOrReservedIpv4(trimmed);
  if (ver === 6) {
    const lower = trimmed.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    // IPv4-mapped IPv6 ::ffff:a.b.c.d or hex ::ffff:7f00:0001
    if (lower.startsWith('::ffff:')) {
      const rest = lower.slice(7);
      if (net.isIP(rest) === 4) return isPrivateOrReservedIpv4(rest);
      const hexParts = rest.split(':');
      if (hexParts.length === 2) {
        const hi = parseInt(hexParts[0], 16);
        const lo = parseInt(hexParts[1], 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          return isPrivateOrReservedIpv4(ipv4);
        }
      }
    }
    // Unique local (fc00::/7 -> fc.. or fd..), link-local (fe80::/10), multicast (ff..)
    if (/^(fc|fd|fe8|fe9|fea|feb|ff)/i.test(lower)) return true;
    return false;
  }
  return true;
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  const cleaned = String(rawUrl || '').trim();
  if (!cleaned || cleaned.length > 2048 || /[\u0000-\u001F\u007F]/.test(cleaned)) {
    throw new Error('URL is invalid or contains control characters.');
  }

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error('Invalid URL format.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" — only http and https are allowed.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs containing embedded credentials are blocked.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) {
    throw new Error('Missing URL hostname.');
  }
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    throw new Error(`Blocked internal/reserved hostname "${host}".`);
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error(`Blocked private/loopback IP "${host}".`);
    }
    return parsed;
  }

  const records = await dns.lookup(host, { all: true }).catch(() => []);
  if (!records.length) {
    throw new Error(`DNS lookup returned no addresses for "${host}".`);
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error(`Blocked DNS resolution to private address for "${host}".`);
    }
  }
  return parsed;
}

export async function safePublicFetch(
  rawUrl: string,
  options: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
  } = {}
): Promise<{ finalUrl: string; status: number; contentType: string; text: string }> {
  const timeoutMs = options.timeoutMs ?? 12000;
  const maxBytes = options.maxBytes ?? 1_500_000;
  const maxRedirects = options.maxRedirects ?? 3;

  let currentUrl = (await assertSafePublicUrl(rawUrl)).toString();
  let hops = 0;

  while (true) {
    const resp = await fetch(currentUrl, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'MUXARO-Research/3.0 (+https://muxaro.vercel.app)',
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5',
        ...(options.headers || {}),
      },
      body: options.method === 'POST' ? options.body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location || hops >= maxRedirects) {
        throw new Error(`Too many redirects or missing redirect target from ${currentUrl}.`);
      }
      const nextUrl = new URL(location, currentUrl).toString();
      currentUrl = (await assertSafePublicUrl(nextUrl)).toString();
      hops += 1;
      continue;
    }

    const contentType = resp.headers.get('content-type') || 'text/plain';
    if (!resp.body) {
      return { finalUrl: currentUrl, status: resp.status, contentType, text: '' };
    }

    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
      }
    }

    const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return {
      finalUrl: currentUrl,
      status: resp.status,
      contentType,
      text: merged.toString('utf8'),
    };
  }
}
