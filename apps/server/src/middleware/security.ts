import { timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { ServerConfig } from '../config.js';

export type SecurityConfig = Pick<
  ServerConfig,
  'authToken' | 'allowedDomains' | 'blockedDomains' | 'allowFileUrls' | 'rateLimitPerMin'
>;

export type PolicyCheckResult = { allowed: true } | { allowed: false; reason: string };

const BLOCKED_SCHEMES = new Set([
  'chrome:',
  'chrome-extension:',
  'javascript:',
  'vbscript:',
  'devtools:',
  'edge:',
]);

export function tokensMatch(expected: string, actual: string | undefined | null): boolean {
  if (!actual) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractBearerToken(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match?.[1]?.trim() || undefined;
}

export function createAuthMiddleware(config: Pick<ServerConfig, 'authToken'>): MiddlewareHandler {
  return async (c, next) => {
    const configuredToken = config.authToken?.trim();
    if (!configuredToken) {
      await next();
      return;
    }

    const bearer = extractBearerToken(c.req.header('authorization'));
    const queryToken = c.req.path === '/api/v2/events' ? c.req.query('token')?.trim() : undefined;
    const provided = bearer ?? queryToken;

    if (!tokensMatch(configuredToken, provided)) {
      c.header('WWW-Authenticate', 'Bearer');
      return c.json({ error: 'Unauthorized: invalid or missing Bearer token' }, 401);
    }

    await next();
  };
}

export function matchesDomainPattern(hostname: string, pattern: string): boolean {
  const host = hostname.trim().toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) return false;

  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(2);
    if (!suffix) return false;
    return host === suffix || host.endsWith(`.${suffix}`);
  }

  return host === normalizedPattern;
}

export function validateUrlPolicy(
  rawUrl: string,
  config: Pick<ServerConfig, 'allowedDomains' | 'blockedDomains' | 'allowFileUrls'>,
): PolicyCheckResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { allowed: false, reason: 'URL cannot be empty' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { allowed: false, reason: `Invalid URL "${trimmed}"` };
  }

  const protocol = parsed.protocol.toLowerCase();

  if (BLOCKED_SCHEMES.has(protocol)) {
    return { allowed: false, reason: `Blocked URL scheme "${protocol}"` };
  }

  if (protocol === 'file:' && !config.allowFileUrls) {
    return { allowed: false, reason: 'Blocked URL scheme "file:" (AGB_ALLOW_FILE_URLS is false)' };
  }

  if (protocol === 'http:' || protocol === 'https:') {
    const hostname = parsed.hostname.toLowerCase();

    if (config.blockedDomains && config.blockedDomains.length > 0) {
      for (const pattern of config.blockedDomains) {
        if (matchesDomainPattern(hostname, pattern)) {
          return {
            allowed: false,
            reason: `Domain "${hostname}" is blocked by policy (${pattern})`,
          };
        }
      }
    }

    if (config.allowedDomains && config.allowedDomains.length > 0) {
      const matched = config.allowedDomains.some((pattern) =>
        matchesDomainPattern(hostname, pattern),
      );
      if (!matched) {
        return {
          allowed: false,
          reason: `Domain "${hostname}" is not in allowedDomains`,
        };
      }
    }
  }

  return { allowed: true };
}

export function validateCommandPolicy(
  action: string,
  params: Record<string, unknown> = {},
  config: Pick<ServerConfig, 'allowedDomains' | 'blockedDomains' | 'allowFileUrls'> = {},
): PolicyCheckResult {
  if (action !== 'navigate' && action !== 'new_tab') {
    return { allowed: true };
  }

  const rawUrl = params.url;
  if (action === 'new_tab' && (rawUrl === undefined || rawUrl === '')) {
    return { allowed: true };
  }

  if (typeof rawUrl !== 'string') {
    return { allowed: true };
  }

  return validateUrlPolicy(rawUrl, config);
}

function getClientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = c.req.header('x-real-ip')?.trim();
  if (realIp) return realIp;

  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? 'local';
}

interface RateBucket {
  count: number;
  windowStart: number;
}

export function createRateLimitMiddleware(
  config: Pick<ServerConfig, 'rateLimitPerMin'>,
  windowMs = 60_000,
): MiddlewareHandler {
  const buckets = new Map<string, RateBucket>();

  return async (c, next) => {
    const limit = config.rateLimitPerMin;
    if (!limit || limit <= 0) {
      await next();
      return;
    }

    const now = Date.now();
    const ip = getClientIp(c);

    // Prevent unbounded growth on long-lived servers
    if (buckets.size > 10_000) {
      for (const [key, entry] of buckets) {
        if (now - entry.windowStart >= windowMs) {
          buckets.delete(key);
        }
      }
    }

    let bucket = buckets.get(ip);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { count: 0, windowStart: now };
      buckets.set(ip, bucket);
    }

    if (bucket.count >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
      c.header('Retry-After', String(retryAfterSec));
      c.header('X-RateLimit-Limit', String(limit));
      c.header('X-RateLimit-Remaining', '0');
      return c.json({ error: 'Too Many Requests: rate limit exceeded' }, 429);
    }

    bucket.count += 1;
    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    await next();
  };
}
