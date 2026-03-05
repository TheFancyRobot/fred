export class RateLimiter {
  private readonly requests = new Map<string, number[]>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60_000);
  }

  check(ip: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.requests.get(ip) ?? []).filter((timestamp) => timestamp > windowStart);

    if (timestamps.length >= this.maxRequests) {
      const oldestTimestamp = timestamps[0] ?? now;
      return {
        allowed: false,
        retryAfterMs: Math.max(0, this.windowMs - (now - oldestTimestamp)),
      };
    }

    timestamps.push(now);
    this.requests.set(ip, timestamps);
    return { allowed: true };
  }

  cleanup(): void {
    const windowStart = Date.now() - this.windowMs;

    for (const [ip, timestamps] of this.requests.entries()) {
      const activeTimestamps = timestamps.filter((timestamp) => timestamp > windowStart);
      if (activeTimestamps.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, activeTimestamps);
      }
    }
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
  }
}
