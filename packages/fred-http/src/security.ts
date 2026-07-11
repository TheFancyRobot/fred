import { Schema } from 'effect';

const boundedInteger = (minimum: number, maximum: number) =>
  Schema.Number.pipe(Schema.int(), Schema.between(minimum, maximum));

const OriginPattern = Schema.String.pipe(
  Schema.filter((value) => {
    const candidate = value.endsWith(':*') ? `${value.slice(0, -1)}1` : value;
    try {
      const url = new URL(candidate);
      return (url.protocol === 'http:' || url.protocol === 'https:')
        && url.username === ''
        && url.password === ''
        && url.pathname === '/'
        && url.search === ''
        && url.hash === '';
    } catch {
      return false;
    }
  }, { message: () => 'CORS origins must be HTTP(S) origins, optionally ending in :*' }),
);

const HeaderName = Schema.String.pipe(
  Schema.pattern(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
);

const RedactionPath = Schema.String.pipe(
  Schema.pattern(/^(?:[A-Za-z_$][A-Za-z0-9_$-]*|\*)(?:\.(?:[A-Za-z_$][A-Za-z0-9_$-]*|\*))*$/),
);

export const ServerSecurityConfigSchema = Schema.Struct({
  requireAuth: Schema.Boolean,
  authToken: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  allowLocalRequestsWithoutAuth: Schema.Boolean,
  corsAllowedOrigins: Schema.Array(OriginPattern),
  maxRequestBodySize: boundedInteger(1, 100 * 1_048_576),
  requestTimeoutSeconds: boundedInteger(1, 3_600),
  rateLimitMaxRequests: boundedInteger(1, 1_000_000),
  rateLimitWindowMs: boundedInteger(1, 86_400_000),
  redactHeaders: Schema.Array(HeaderName),
  redactPaths: Schema.Array(RedactionPath),
});

export const ServerSecurityOverridesSchema = Schema.partial(ServerSecurityConfigSchema);
export type ServerSecurityConfig = typeof ServerSecurityConfigSchema.Type;
export type ServerSecurityOverrides = typeof ServerSecurityOverridesSchema.Type;

export const HttpStorageBackendSchema = Schema.Literal('memory', 'sqlite', 'postgres');
export type HttpStorageBackend = typeof HttpStorageBackendSchema.Type;

export const FredHttpRuntimeConfigSchema = Schema.Struct({
  port: Schema.optional(boundedInteger(0, 65_535)),
  hostname: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(253))),
  trustProxy: Schema.optional(Schema.Boolean),
  apiKeyStorage: Schema.optional(HttpStorageBackendSchema),
  rateLimitStorage: Schema.optional(HttpStorageBackendSchema),
  security: Schema.optional(ServerSecurityOverridesSchema),
});
export type FredHttpRuntimeConfig = typeof FredHttpRuntimeConfigSchema.Type;

export const DEFAULT_SECURITY_CONFIG: ServerSecurityConfig = {
  requireAuth: true,
  allowLocalRequestsWithoutAuth: false,
  corsAllowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*'],
  maxRequestBodySize: 1_048_576,
  requestTimeoutSeconds: 30,
  rateLimitMaxRequests: 60,
  rateLimitWindowMs: 60_000,
  redactHeaders: [
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'x-api-key',
  ],
  redactPaths: [
    'apiKey',
    'authToken',
    'token',
    'secret',
    'headers.authorization',
    'headers.cookie',
  ],
};

export interface ResolvedServerSecurityConfig {
  readonly config: ServerSecurityConfig;
  readonly generatedAuthToken?: string;
}

const decodeSecurity = Schema.decodeUnknownSync(ServerSecurityConfigSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});

export function validateFredHttpRuntimeConfig(config: unknown): FredHttpRuntimeConfig {
  return Schema.decodeUnknownSync(FredHttpRuntimeConfigSchema, {
    errors: 'all',
    onExcessProperty: 'error',
  })(config);
}

export function resolveServerSecurityConfig(
  overrides: ServerSecurityOverrides = {},
  environmentToken?: string,
): ResolvedServerSecurityConfig {
  const decoded = decodeSecurity({ ...DEFAULT_SECURITY_CONFIG, ...overrides });
  const authToken = decoded.authToken ?? environmentToken;
  const base = Object.freeze({
    ...decoded,
    corsAllowedOrigins: Object.freeze([...decoded.corsAllowedOrigins]),
    redactHeaders: Object.freeze([...decoded.redactHeaders]),
    redactPaths: Object.freeze([...decoded.redactPaths]),
  });

  if (!base.requireAuth || authToken !== undefined) {
    return {
      config: authToken === undefined ? base : Object.freeze({ ...base, authToken }),
    };
  }

  const generatedAuthToken = crypto.randomUUID();
  return {
    config: Object.freeze({ ...base, authToken: generatedAuthToken }),
    generatedAuthToken,
  };
}

export function isLocalRequest(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1';
}

export function matchOrigin(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.some((pattern) => {
    if (pattern === origin) return true;
    if (!pattern.endsWith(':*')) return false;
    const prefix = pattern.slice(0, -2);
    if (!origin.startsWith(`${prefix}:`)) return false;
    return /^[0-9]+$/.test(origin.slice(prefix.length + 1));
  });
}

/** Canonical route key shared by endpoint registration and pre-routing security checks. */
export function canonicalizeHttpPath(value: string): string | undefined {
  try {
    const pathname = new URL(value, 'http://fred.invalid').pathname;
    return pathname
      .split('/')
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join('/');
  } catch {
    return undefined;
  }
}

export function checkAuth(
  ip: string,
  authHeader: string | null,
  config: ServerSecurityConfig,
): { allowed: boolean; status?: number } {
  if (!config.requireAuth || (config.allowLocalRequestsWithoutAuth && isLocalRequest(ip))) {
    return { allowed: true };
  }
  if (!config.authToken || authHeader !== `Bearer ${config.authToken}`) {
    return { allowed: false, status: 401 };
  }
  return { allowed: true };
}
