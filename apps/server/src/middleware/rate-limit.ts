import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Small fixed-window rate limiter, in memory, keyed by client IP.
 *
 * Enough to stop a single client hammering the unauthenticated sign-in
 * endpoints or minting tokens in a loop. It is per process: with several
 * server instances behind a load balancer each enforces its own window, so a
 * shared store (Redis) is the next step at that scale.
 *
 * Behind a proxy, set TRUST_PROXY so `req.ip` is the client, not the proxy.
 */
export interface RateLimitOptions {
  /** Shown in the error and used to separate counters between limiters. */
  name: string;
  windowMs: number;
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const limiters: Array<Map<string, Bucket>> = [];

export function rateLimit({ name, windowMs, max }: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  limiters.push(buckets);

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
      // Opportunistic cleanup so idle clients do not accumulate.
      if (buckets.size > 10_000) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      }
    }
    bucket.count += 1;

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'RATE_LIMITED',
        message: `Too many ${name} requests. Try again in ${retryAfter}s.`,
      });
      return;
    }
    next();
  };
}

/** Test helper: forget every counter. */
export function resetRateLimits(): void {
  for (const buckets of limiters) buckets.clear();
}
