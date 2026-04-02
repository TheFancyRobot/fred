import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { RateLimiter } from '../../../packages/dev/src/server/rate-limiter';

describe('RateLimiter', () => {
  const originalNow = Date.now;
  let now = 0;

  beforeEach(() => {
    now = 0;
    Date.now = () => now;
  });

  afterEach(() => {
    Date.now = originalNow;
  });

  it('allows first request in window', () => {
    const limiter = new RateLimiter(2, 1_000);
    expect(limiter.check('127.0.0.1')).toEqual({ allowed: true });
    limiter.dispose();
  });

  it('allows requests up to max within window', () => {
    const limiter = new RateLimiter(2, 1_000);
    expect(limiter.check('127.0.0.1')).toEqual({ allowed: true });
    now = 100;
    expect(limiter.check('127.0.0.1')).toEqual({ allowed: true });
    limiter.dispose();
  });

  it('rejects requests exceeding max with retryAfterMs', () => {
    const limiter = new RateLimiter(2, 1_000);
    limiter.check('127.0.0.1');
    now = 100;
    limiter.check('127.0.0.1');
    now = 200;
    const result = limiter.check('127.0.0.1');

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(800);
    limiter.dispose();
  });

  it('allows requests again after window expires', () => {
    const limiter = new RateLimiter(1, 1_000);
    expect(limiter.check('127.0.0.1')).toEqual({ allowed: true });
    expect(limiter.check('127.0.0.1').allowed).toBe(false);

    now = 1_001;
    expect(limiter.check('127.0.0.1')).toEqual({ allowed: true });
    limiter.dispose();
  });

  it('cleanup removes stale entries', () => {
    const limiter = new RateLimiter(2, 1_000);
    limiter.check('127.0.0.1');
    limiter.check('10.0.0.1');

    now = 1_001;
    limiter.cleanup();

    const entries = (limiter as unknown as { requests: Map<string, number[]> }).requests;
    expect(entries.size).toBe(0);
    limiter.dispose();
  });
});
