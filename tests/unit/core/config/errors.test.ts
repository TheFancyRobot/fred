/**
 * Phase 61 / STEP-61-01: ConfigError foundation.
 *
 * Covers the tagged error shape and the ParseResult.ArrayFormatter ->
 * ConfigError[] plumbing (path formatting, per-issue mapping, resolver-based
 * remediation/docs enrichment).
 */
import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import { ConfigError, formatConfigIssues } from '../../../../packages/core/src/config/errors';

describe('ConfigError', () => {
  it('is a tagged error carrying path/issue/message with optional remediation + docs', () => {
    const err = new ConfigError({
      path: 'agents[0].platform',
      issue: 'is missing',
      message: 'agents[0].platform: is missing',
      remediation: 'Add a `platform` (e.g. openai).',
      docsUrl: 'https://example.com/docs',
    });

    expect(err._tag).toBe('ConfigError');
    expect(err.message).toBe('agents[0].platform: is missing');
    const rendered = err.toString();
    expect(rendered).toContain('ConfigError at agents[0].platform');
    expect(rendered).toContain('Problem: is missing');
    expect(rendered).toContain('How to fix: Add a `platform` (e.g. openai).');
    expect(rendered).toContain('Docs: https://example.com/docs');
  });

  it('omits remediation/docs lines when not provided', () => {
    const err = new ConfigError({
      path: '(root)',
      issue: 'unexpected shape',
      message: '(root): unexpected shape',
    });
    const rendered = err.toString();
    expect(rendered).not.toContain('How to fix');
    expect(rendered).not.toContain('Docs:');
  });
});

describe('formatConfigIssues', () => {
  const Person = Schema.Struct({
    name: Schema.String,
    age: Schema.Number,
  });

  it('maps every decode issue to a ConfigError with composed message', () => {
    const result = Schema.decodeUnknownEither(Person)({ name: 123 }, { errors: 'all' });
    expect(result._tag).toBe('Left');
    if (result._tag !== 'Left') return;

    const errors = formatConfigIssues(result.left);
    const paths = errors.map((e) => e.path);
    expect(paths).toContain('name'); // wrong type
    expect(paths).toContain('age'); // missing required key

    for (const e of errors) {
      expect(e._tag).toBe('ConfigError');
      expect(e.message).toBe(`${e.path}: ${e.issue}`);
      expect(e.remediation).toBeUndefined();
    }
  });

  it('renders array-index paths as [n]', () => {
    const List = Schema.Struct({
      items: Schema.Array(Schema.Struct({ id: Schema.String })),
    });
    const result = Schema.decodeUnknownEither(List)({ items: [{ id: 1 }] }, { errors: 'all' });
    if (result._tag !== 'Left') throw new Error('expected decode failure');

    const errors = formatConfigIssues(result.left);
    expect(errors.some((e) => e.path === 'items[0].id')).toBe(true);
  });

  it('renders a whole-value failure as (root)', () => {
    const result = Schema.decodeUnknownEither(Person)('not-an-object');
    if (result._tag !== 'Left') throw new Error('expected decode failure');

    const errors = formatConfigIssues(result.left);
    expect(errors[0]?.path).toBe('(root)');
  });

  it('enriches specific paths with remediation/docs via a resolver', () => {
    const result = Schema.decodeUnknownEither(Person)({ name: 123, age: 'old' }, { errors: 'all' });
    if (result._tag !== 'Left') throw new Error('expected decode failure');

    const errors = formatConfigIssues(result.left, {
      resolve: (issue) =>
        issue.path[0] === 'name'
          ? { remediation: 'Use a string for `name`.', docsUrl: 'https://d' }
          : undefined,
    });

    const nameErr = errors.find((e) => e.path === 'name');
    const ageErr = errors.find((e) => e.path === 'age');
    expect(nameErr?.remediation).toBe('Use a string for `name`.');
    expect(nameErr?.docsUrl).toBe('https://d');
    expect(ageErr?.remediation).toBeUndefined();
  });
});
