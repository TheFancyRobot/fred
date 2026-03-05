export interface ServerSecurityConfig {
  requireAuth: boolean;
  authToken?: string;
  corsAllowedOrigins: string[];
  maxRequestBodySize: number;
  requestTimeoutSeconds: number;
  rateLimitMaxRequests: number;
  rateLimitWindowMs: number;
}

export const DEFAULT_SECURITY_CONFIG: ServerSecurityConfig = {
  requireAuth: true,
  corsAllowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*'],
  maxRequestBodySize: 1_048_576,
  requestTimeoutSeconds: 30,
  rateLimitMaxRequests: 60,
  rateLimitWindowMs: 60_000,
};

export function isLocalRequest(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1';
}

export function matchOrigin(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.some((pattern) => {
    if (pattern === origin) {
      return true;
    }

    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -2);
      if (!origin.startsWith(`${prefix}:`)) {
        return false;
      }

      const portPart = origin.slice(prefix.length + 1);
      return /^[0-9]+$/.test(portPart);
    }

    return false;
  });
}

export function checkAuth(
  ip: string,
  authHeader: string | null,
  config: ServerSecurityConfig
): { allowed: boolean; status?: number } {
  if (!config.requireAuth || isLocalRequest(ip)) {
    return { allowed: true };
  }

  const token = config.authToken ?? process.env.FRED_DEV_SERVER_TOKEN;
  if (!token) {
    return { allowed: false, status: 401 };
  }

  if (authHeader !== `Bearer ${token}`) {
    return { allowed: false, status: 401 };
  }

  return { allowed: true };
}
