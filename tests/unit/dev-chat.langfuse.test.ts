import { describe, expect, test } from 'bun:test';
import { getLangfuseConfigFromEnv, checkLangfusePackages } from '../../src/dev-chat';

describe('checkLangfusePackages', () => {
  test('returns correct structure with all packages status', async () => {
    const result = await checkLangfusePackages();
    
    expect(result).toHaveProperty('@langfuse/client');
    expect(result).toHaveProperty('@langfuse/otel');
    expect(result).toHaveProperty('@opentelemetry/sdk-node');
    expect(result).toHaveProperty('allInstalled');
    expect(result).toHaveProperty('missing');
    expect(Array.isArray(result.missing)).toBe(true);
  });

  test('missing array contains packages that are not installed', async () => {
    const result = await checkLangfusePackages();
    
    // The missing array should only contain packages that couldn't be resolved
    for (const pkg of result.missing) {
      expect(['@langfuse/client', '@langfuse/otel', '@opentelemetry/sdk-node']).toContain(pkg);
    }
  });

  test('allInstalled is true only when no packages are missing', async () => {
    const result = await checkLangfusePackages();
    
    if (result.missing.length === 0) {
      expect(result.allInstalled).toBe(true);
    } else {
      expect(result.allInstalled).toBe(false);
    }
  });
});

describe('getLangfuseConfigFromEnv', () => {
  test('returns null when disabled via flag', () => {
    const env = {
      LANGFUSE_SECRET_KEY: 'secret',
      LANGFUSE_PUBLIC_KEY: 'public',
      LANGFUSE_BASE_URL: 'https://example.com',
    } as NodeJS.ProcessEnv;

    const result = getLangfuseConfigFromEnv(env, true);
    expect(result).toBeNull();
  });

  test('returns null when required keys are missing', () => {
    const env = {
      LANGFUSE_SECRET_KEY: 'secret',
    } as NodeJS.ProcessEnv;

    const result = getLangfuseConfigFromEnv(env);
    expect(result).toBeNull();
  });

  test('returns config when both keys are present', () => {
    const env = {
      LANGFUSE_SECRET_KEY: 'secret',
      LANGFUSE_PUBLIC_KEY: 'public',
      LANGFUSE_BASE_URL: 'https://example.com',
    } as NodeJS.ProcessEnv;

    const result = getLangfuseConfigFromEnv(env);
    expect(result).toEqual({
      secretKey: 'secret',
      publicKey: 'public',
      baseUrl: 'https://example.com',
    });
  });
});
