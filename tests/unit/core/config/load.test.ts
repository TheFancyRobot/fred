/**
 * Phase 61 / STEP-61-05: schema-first validated config loading.
 *
 * Positive parity — every example config loads through the validated path.
 * Negative — bad configs throw a single ConfigValidationError aggregating all
 * problems with remediation, and valid configs pass through losslessly.
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  loadValidatedConfig,
  validateParsedConfig,
} from '../../../../packages/core/src/config/load';
import {
  ConfigError,
  ConfigValidationError,
  configValidationError,
} from '../../../../packages/core/src/config/errors';

const EXAMPLES_DIR = join(import.meta.dir, '../../../../examples');

describe('loadValidatedConfig — example fixtures (golden parity)', () => {
  const exampleConfigs = existsSync(EXAMPLES_DIR)
    ? readdirSync(EXAMPLES_DIR)
        .map((dir) => join(EXAMPLES_DIR, dir, 'config.yaml'))
        .filter((p) => existsSync(p))
    : [];

  it('discovers example config fixtures', () => {
    expect(exampleConfigs.length).toBeGreaterThan(0);
  });

  for (const configPath of exampleConfigs) {
    const label = configPath.slice(EXAMPLES_DIR.length + 1);
    it(`loads ${label} without error`, () => {
      expect(() => loadValidatedConfig(configPath)).not.toThrow();
    });
  }
});

describe('validateParsedConfig — passthrough & losslessness', () => {
  it('returns the original object unchanged for a valid config', () => {
    const input = {
      providers: [{ id: 'openai', modelDefaults: { model: 'gpt-4' } }],
      routing: { defaultAgent: 'assistant', rules: [] },
      // an unknown top-level key must survive (validation gate, not a transform)
      customExtension: { keep: 'me' },
    };
    const out = validateParsedConfig(input);
    expect(out).toBe(input as never);
    expect((out as Record<string, unknown>).customExtension).toEqual({ keep: 'me' });
  });
});

describe('validateParsedConfig — aggregated errors', () => {
  it('throws ConfigValidationError listing every semantic problem at once', () => {
    let thrown: unknown;
    try {
      validateParsedConfig({ agents: [{ id: 'a1' }, { id: 'a2' }] });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ConfigValidationError);
    const err = thrown as ConfigValidationError;
    // Two agents, each missing systemMessage/default, platform, model => 6.
    expect(err.errors.length).toBeGreaterThanOrEqual(6);
    expect(err.errors.every((e) => e._tag === 'ConfigError')).toBe(true);
    // Remediation surfaces in the rendered output.
    expect(err.toString()).toContain('How to fix');
  });

  it('throws on a structural problem (bad persistence adapter)', () => {
    expect(() => validateParsedConfig({ persistence: { adapter: 'mongodb' } })).toThrow(
      ConfigValidationError,
    );
  });

  it('reports structural errors before running semantic rules', () => {
    // agentDirs is the wrong type (structural); message should reference it.
    let thrown: ConfigValidationError | undefined;
    try {
      validateParsedConfig({ agentDirs: 'nope' });
    } catch (e) {
      thrown = e as ConfigValidationError;
    }
    expect(thrown).toBeInstanceOf(ConfigValidationError);
    expect(thrown!.errors.some((e) => e.path.startsWith('agentDirs'))).toBe(true);
  });

  it('composes a single-error message as that error message', () => {
    const only = new ConfigError({ path: 'x', issue: 'bad', message: 'x: bad' });
    expect(configValidationError([only]).message).toBe('x: bad');
  });

  it('composes a multi-error message that summarises the count', () => {
    const errs = [
      new ConfigError({ path: 'x', issue: 'a', message: 'x: a' }),
      new ConfigError({ path: 'y', issue: 'b', message: 'y: b' }),
    ];
    const agg = configValidationError(errs);
    expect(agg.message).toContain('2 config problems');
    expect(agg.message).toContain('x: a');
    expect(agg.message).toContain('y: b');
  });
});
