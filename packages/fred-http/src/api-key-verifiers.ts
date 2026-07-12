import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { Effect, Schema } from 'effect';

export const API_KEY_VERIFIER_IDS = {
  argon2id: 'argon2id-v1',
  scrypt: 'scrypt-v1',
  pbkdf2: 'pbkdf2-sha256-v1',
  hmac: 'hmac-sha256-v1',
  legacySha256: 'sha256-v1',
} as const;

export const ApiKeyVerifierDescriptor = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^[a-z0-9][a-z0-9._-]{2,63}$/)),
  version: Schema.Number.pipe(Schema.int(), Schema.positive()),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
export type ApiKeyVerifierDescriptor = typeof ApiKeyVerifierDescriptor.Type;

export const LEGACY_SHA256_DESCRIPTOR: ApiKeyVerifierDescriptor = {
  id: API_KEY_VERIFIER_IDS.legacySha256,
  version: 1,
  metadata: {},
};

export class ApiKeyVerifierConfigurationError extends Schema.TaggedError<ApiKeyVerifierConfigurationError>()(
  'ApiKeyVerifierConfigurationError',
  { verifierId: Schema.String, message: Schema.String },
) {}

export class ApiKeyVerifierOperationError extends Schema.TaggedError<ApiKeyVerifierOperationError>()(
  'ApiKeyVerifierOperationError',
  { verifierId: Schema.String, operation: Schema.Literal('derive', 'verify'), message: Schema.String },
) {}

export interface ApiKeyVerifierDerived {
  readonly verifier: ApiKeyVerifierDescriptor;
  readonly hash: string;
}

export interface ApiKeyVerifier {
  readonly id: string;
  readonly metadataSchema: Schema.Schema.AnyNoContext;
  readonly canDerive: boolean;
  readonly needsUpgrade?: (descriptor: ApiKeyVerifierDescriptor) => boolean;
  readonly derive: (token: string) => Effect.Effect<ApiKeyVerifierDerived, ApiKeyVerifierConfigurationError | ApiKeyVerifierOperationError>;
  readonly verify: (
    token: string,
    hash: string,
    descriptor: ApiKeyVerifierDescriptor,
  ) => Effect.Effect<boolean, ApiKeyVerifierConfigurationError | ApiKeyVerifierOperationError>;
}

export interface ApiKeyVerifierRegistryService {
  readonly defaultVerifierId: string;
  readonly register: (verifier: ApiKeyVerifier) => Effect.Effect<void, ApiKeyVerifierConfigurationError>;
  readonly derive: (verifierId: string, token: string) => Effect.Effect<ApiKeyVerifierDerived, ApiKeyVerifierConfigurationError | ApiKeyVerifierOperationError>;
  readonly verify: (token: string, hash: string, descriptor: ApiKeyVerifierDescriptor) => Effect.Effect<boolean, ApiKeyVerifierConfigurationError | ApiKeyVerifierOperationError>;
  readonly needsUpgrade: (descriptor: ApiKeyVerifierDescriptor, targetVerifierId: string) => Effect.Effect<boolean, ApiKeyVerifierConfigurationError>;
}

const VERIFIER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

const configurationFailure = (verifierId: string, message: string) =>
  new ApiKeyVerifierConfigurationError({ verifierId, message });

const operationFailure = (verifierId: string, operation: 'derive' | 'verify') => (cause: unknown) =>
  new ApiKeyVerifierOperationError({
    verifierId,
    operation,
    message: cause instanceof Error ? cause.message : 'Verifier operation failed',
  });

const decodeMetadata = (verifier: ApiKeyVerifier, metadata: unknown) =>
  Schema.decodeUnknown(verifier.metadataSchema)(metadata).pipe(
    Effect.mapError(() => configurationFailure(verifier.id, 'Invalid verifier metadata')),
  );

const validateVerifierId = (id: string): ApiKeyVerifierConfigurationError | undefined =>
  VERIFIER_ID_PATTERN.test(id)
    ? undefined
    : configurationFailure(id, 'API key verifier id must match ^[a-z0-9][a-z0-9._-]{2,63}$');

export const makeApiKeyVerifierRegistry = (
  verifiers: readonly ApiKeyVerifier[],
  defaultVerifierId: string = API_KEY_VERIFIER_IDS.argon2id,
): ApiKeyVerifierRegistryService => {
  const entries = new Map<string, ApiKeyVerifier>();
  for (const verifier of verifiers) {
    const invalidId = validateVerifierId(verifier.id);
    if (invalidId !== undefined) throw invalidId;
    if (entries.has(verifier.id)) throw configurationFailure(verifier.id, 'Duplicate API key verifier id');
    entries.set(verifier.id, verifier);
  }
  const invalidDefaultId = validateVerifierId(defaultVerifierId);
  if (invalidDefaultId !== undefined) throw invalidDefaultId;
  if (!entries.has(defaultVerifierId)) {
    throw configurationFailure(defaultVerifierId, 'Default API key verifier is not registered');
  }
  const find = (id: string) => {
    const verifier = entries.get(id);
    return verifier === undefined
      ? Effect.fail(configurationFailure(id, 'Unknown or disabled API key verifier'))
      : Effect.succeed(verifier);
  };
  return {
    defaultVerifierId,
    register: (verifier) => Effect.suspend(() => {
      const invalidId = validateVerifierId(verifier.id);
      if (invalidId !== undefined) return Effect.fail(invalidId);
      if (entries.has(verifier.id)) return Effect.fail(configurationFailure(verifier.id, 'Duplicate API key verifier id'));
      entries.set(verifier.id, verifier);
      return Effect.void;
    }),
    derive: (id, token) => Effect.flatMap(find(id), (verifier) => {
      if (!verifier.canDerive) return Effect.fail(configurationFailure(id, 'Verifier is read-only'));
      return verifier.derive(token);
    }),
    verify: (token, hash, descriptor) => Effect.flatMap(find(descriptor.id), (verifier) =>
      Effect.flatMap(decodeMetadata(verifier, descriptor.metadata), (metadata) =>
        verifier.verify(token, hash, { ...descriptor, metadata }))),
    needsUpgrade: (descriptor, targetVerifierId) => {
      if (descriptor.id !== targetVerifierId) return Effect.succeed(true);
      return Effect.flatMap(find(targetVerifierId), (verifier) =>
        Effect.map(decodeMetadata(verifier, descriptor.metadata), (metadata) =>
          verifier.needsUpgrade?.({ ...descriptor, metadata }) ?? false));
    },
  };
};

const emptyMetadata = Schema.Record({ key: Schema.String, value: Schema.Never });
const constantTimeHexEqual = (actual: string, expected: string): boolean => {
  if (!/^[a-f0-9]+$/i.test(actual) || !/^[a-f0-9]+$/i.test(expected)) return false;
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

export const LegacySha256ApiKeyVerifier: ApiKeyVerifier = {
  id: API_KEY_VERIFIER_IDS.legacySha256,
  metadataSchema: emptyMetadata,
  canDerive: false,
  derive: () => Effect.fail(configurationFailure(API_KEY_VERIFIER_IDS.legacySha256, 'Legacy SHA-256 is read-only')),
  verify: (token, hash) => Effect.sync(() => constantTimeHexEqual(
    createHash('sha256').update(token, 'utf8').digest('hex'),
    hash,
  )),
};

export interface Argon2idVerifierOptions {
  readonly memoryCost?: number;
  readonly timeCost?: number;
}

export const makeArgon2idApiKeyVerifier = (options: Argon2idVerifierOptions = {}): ApiKeyVerifier => {
  const memoryCost = options.memoryCost ?? 19_456;
  const timeCost = options.timeCost ?? 2;
  if (!Number.isInteger(memoryCost) || memoryCost < 4_096 || memoryCost > 262_144
    || !Number.isInteger(timeCost) || timeCost < 1 || timeCost > 10) {
    throw configurationFailure(API_KEY_VERIFIER_IDS.argon2id, 'Argon2id costs are outside safe bounds');
  }
  const metadata = { memoryCost, timeCost };
  const metadataSchema = Schema.Struct({
    memoryCost: Schema.Number.pipe(Schema.int(), Schema.between(4_096, 262_144)),
    timeCost: Schema.Number.pipe(Schema.int(), Schema.between(1, 10)),
  });
  return {
    id: API_KEY_VERIFIER_IDS.argon2id,
    metadataSchema,
    canDerive: true,
    derive: (token) => Effect.try({
      try: () => ({
        verifier: { id: API_KEY_VERIFIER_IDS.argon2id, version: 1, metadata },
        hash: Bun.password.hashSync(token, { algorithm: 'argon2id', memoryCost, timeCost }),
      }),
      catch: operationFailure(API_KEY_VERIFIER_IDS.argon2id, 'derive'),
    }),
    verify: (token, hash) => Effect.try({
      try: () => Bun.password.verifySync(token, hash, 'argon2id'),
      catch: operationFailure(API_KEY_VERIFIER_IDS.argon2id, 'verify'),
    }),
  };
};

const ScryptMetadata = Schema.Struct({
  salt: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{32}$/)),
  cost: Schema.Number.pipe(
    Schema.int(),
    Schema.between(4_096, 65_536),
    Schema.filter((value) => (value & (value - 1)) === 0, {
      message: () => 'scrypt cost must be a power of two',
    }),
  ),
  blockSize: Schema.Number.pipe(Schema.int(), Schema.between(8, 16)),
  parallelization: Schema.Number.pipe(Schema.int(), Schema.between(1, 4)),
  keyLength: Schema.Number.pipe(Schema.int(), Schema.between(32, 64)),
});

export const makeScryptApiKeyVerifier = (
  options: { readonly cost?: number; readonly blockSize?: number; readonly parallelization?: number } = {},
): ApiKeyVerifier => {
  const cost = options.cost ?? 16_384;
  const blockSize = options.blockSize ?? 8;
  const parallelization = options.parallelization ?? 1;
  if (!Number.isInteger(cost) || cost < 4_096 || cost > 65_536 || (cost & (cost - 1)) !== 0
    || !Number.isInteger(blockSize) || blockSize < 8 || blockSize > 16
    || !Number.isInteger(parallelization) || parallelization < 1 || parallelization > 4) {
    throw configurationFailure(
      API_KEY_VERIFIER_IDS.scrypt,
      'scrypt parameters are outside safe bounds or cost is not a power of two',
    );
  }
  const base = { salt: '0'.repeat(32), cost, blockSize, parallelization, keyLength: 32 } as const;
  return {
    id: API_KEY_VERIFIER_IDS.scrypt,
    metadataSchema: ScryptMetadata,
    canDerive: true,
    derive: (token) => Effect.try({
      try: () => {
        const metadata = { ...base, salt: randomBytes(16).toString('hex') };
        const hash = scryptSync(token, Buffer.from(metadata.salt, 'hex'), metadata.keyLength, {
          N: metadata.cost, r: metadata.blockSize, p: metadata.parallelization,
          maxmem: 128 * metadata.cost * metadata.blockSize + 1_048_576,
        }).toString('hex');
        return { verifier: { id: API_KEY_VERIFIER_IDS.scrypt, version: 1, metadata }, hash };
      },
      catch: operationFailure(API_KEY_VERIFIER_IDS.scrypt, 'derive'),
    }),
    verify: (token, hash, descriptor) => Effect.flatMap(Schema.decodeUnknown(ScryptMetadata)(descriptor.metadata).pipe(
      Effect.mapError(() => configurationFailure(API_KEY_VERIFIER_IDS.scrypt, 'Invalid verifier metadata')),
    ), (metadata) => Effect.try({
      try: () => constantTimeHexEqual(scryptSync(
        token,
        Buffer.from(metadata.salt, 'hex'),
        metadata.keyLength,
        { N: metadata.cost, r: metadata.blockSize, p: metadata.parallelization, maxmem: 128 * metadata.cost * metadata.blockSize + 1_048_576 },
      ).toString('hex'), hash),
      catch: operationFailure(API_KEY_VERIFIER_IDS.scrypt, 'verify'),
    })),
  };
};

const Pbkdf2Metadata = Schema.Struct({
  salt: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{32}$/)),
  iterations: Schema.Number.pipe(Schema.int(), Schema.between(100_000, 2_000_000)),
  keyLength: Schema.Number.pipe(Schema.int(), Schema.between(32, 64)),
  digest: Schema.Literal('sha256'),
});

export const makePbkdf2ApiKeyVerifier = (iterations = 600_000): ApiKeyVerifier => {
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) {
    throw configurationFailure(API_KEY_VERIFIER_IDS.pbkdf2, 'PBKDF2 iterations are outside safe bounds');
  }
  const base = { salt: '0'.repeat(32), iterations, keyLength: 32, digest: 'sha256' } as const;
  return {
    id: API_KEY_VERIFIER_IDS.pbkdf2,
    metadataSchema: Pbkdf2Metadata,
    canDerive: true,
    derive: (token) => Effect.try({
      try: () => {
        const metadata = { ...base, salt: randomBytes(16).toString('hex') };
        return {
          verifier: { id: API_KEY_VERIFIER_IDS.pbkdf2, version: 1, metadata },
          hash: pbkdf2Sync(token, Buffer.from(metadata.salt, 'hex'), metadata.iterations, metadata.keyLength, metadata.digest).toString('hex'),
        };
      },
      catch: operationFailure(API_KEY_VERIFIER_IDS.pbkdf2, 'derive'),
    }),
    verify: (token, hash, descriptor) => Effect.flatMap(Schema.decodeUnknown(Pbkdf2Metadata)(descriptor.metadata).pipe(
      Effect.mapError(() => configurationFailure(API_KEY_VERIFIER_IDS.pbkdf2, 'Invalid verifier metadata')),
    ), (metadata) => Effect.try({
      try: () => constantTimeHexEqual(
        pbkdf2Sync(token, Buffer.from(metadata.salt, 'hex'), metadata.iterations, metadata.keyLength, metadata.digest).toString('hex'),
        hash,
      ),
      catch: operationFailure(API_KEY_VERIFIER_IDS.pbkdf2, 'verify'),
    })),
  };
};

const HmacMetadata = Schema.Struct({
  keyId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  digest: Schema.Literal('sha256'),
});

export const makeHmacApiKeyVerifier = (options: {
  readonly currentKeyId: string;
  readonly keys: Readonly<Record<string, string>>;
}): ApiKeyVerifier => {
  const current = options.keys[options.currentKeyId];
  if (current === undefined || current.length < 32) {
    throw configurationFailure(API_KEY_VERIFIER_IDS.hmac, 'Current HMAC key is missing or shorter than 32 characters');
  }
  const digest = (token: string, keyId: string) => {
    const key = options.keys[keyId];
    return key === undefined
      ? Effect.fail(configurationFailure(API_KEY_VERIFIER_IDS.hmac, 'Configured HMAC key id is unavailable'))
      : Effect.succeed(createHmac('sha256', key).update(token, 'utf8').digest('hex'));
  };
  return {
    id: API_KEY_VERIFIER_IDS.hmac,
    metadataSchema: HmacMetadata,
    canDerive: true,
    needsUpgrade: (descriptor) => descriptor.metadata.keyId !== options.currentKeyId,
    derive: (token) => Effect.map(digest(token, options.currentKeyId), (hash) => ({
      verifier: {
        id: API_KEY_VERIFIER_IDS.hmac,
        version: 1,
        metadata: { keyId: options.currentKeyId, digest: 'sha256' },
      },
      hash,
    })),
    verify: (token, hash, descriptor) => Effect.flatMap(Schema.decodeUnknown(HmacMetadata)(descriptor.metadata).pipe(
      Effect.mapError(() => configurationFailure(API_KEY_VERIFIER_IDS.hmac, 'Invalid verifier metadata')),
    ), (metadata) => Effect.map(digest(token, metadata.keyId), (actual) => constantTimeHexEqual(actual, hash))),
  };
};

export const makeDefaultApiKeyVerifierRegistry = (options: {
  readonly defaultVerifierId?: string;
  readonly hmac?: { readonly currentKeyId: string; readonly keys: Readonly<Record<string, string>> };
} = {}): ApiKeyVerifierRegistryService => makeApiKeyVerifierRegistry([
  makeArgon2idApiKeyVerifier(),
  makeScryptApiKeyVerifier(),
  makePbkdf2ApiKeyVerifier(),
  ...(options.hmac === undefined ? [] : [makeHmacApiKeyVerifier(options.hmac)]),
  LegacySha256ApiKeyVerifier,
], options.defaultVerifierId ?? API_KEY_VERIFIER_IDS.argon2id);
