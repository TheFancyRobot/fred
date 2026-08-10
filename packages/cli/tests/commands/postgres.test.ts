import { describe, expect, test } from 'bun:test';
import {
  handlePostgresCommand,
  type LegacyImportRequest,
  type PostgresCommandDependencies,
} from '../../src/commands/postgres';
import type { LegacyPostgresStoreImportResult } from '@fancyrobot/fred-postgres';

const ALL_MODULES = ['context', 'checkpoints', 'http-api-keys', 'http-rate-limits'] as const;
const pending: readonly LegacyPostgresStoreImportResult[] = [{
  sourceTable: '"public"."conversations"',
  destinationTable: '"fred"."conversations"',
  rowCount: 2,
  checksum: 'abc123',
  imported: false,
  status: 'pending',
}];
const imported: readonly LegacyPostgresStoreImportResult[] = pending.map((row) => ({
  ...row,
  imported: true,
  status: 'imported',
}));
const verified: readonly LegacyPostgresStoreImportResult[] = pending.map((row) => ({
  ...row,
  status: 'verified',
}));

const capture = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { stdout: (message: string) => stdout.push(message), stderr: (message: string) => stderr.push(message) },
  };
};

const dependencies = (
  output: ReturnType<typeof capture>,
  calls: LegacyImportRequest[],
  overrides: Partial<PostgresCommandDependencies> = {},
): PostgresCommandDependencies => ({
  io: output.io,
  isTTY: false,
  importLegacy: async (request) => {
    calls.push(request);
    return request.dryRun === true ? pending : imported;
  },
  ...overrides,
});

describe('postgres import-legacy command', () => {
  test('prints command help without requiring database configuration', async () => {
    const output = capture();
    const exitCode = await handlePostgresCommand(['import-legacy'], { help: true }, { io: output.io });

    expect(exitCode).toBe(0);
    expect(output.stdout[0]).toContain('fred postgres import-legacy');
  });

  test('rejects connection strings in command arguments without echoing them', async () => {
    const output = capture();
    const calls: LegacyImportRequest[] = [];
    const exitCode = await handlePostgresCommand(
      ['import-legacy'],
      { postgres: 'postgres://user:secret@db.example/fred' },
      dependencies(output, calls),
    );

    expect(exitCode).toBe(2);
    expect(calls).toEqual([]);
    expect(JSON.stringify(output)).not.toContain('secret');
  });

  test('dry-runs the existing importer without requesting confirmation', async () => {
    const output = capture();
    const calls: LegacyImportRequest[] = [];
    const exitCode = await handlePostgresCommand(
      ['import-legacy'],
      { 'dry-run': true, json: true, modules: 'context' },
      dependencies(output, calls),
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ modules: ['context'], dryRun: true }]);
    expect(JSON.parse(output.stdout[0] ?? '{}')).toMatchObject({ ok: true, dryRun: true, data: [{ status: 'pending' }] });
  });

  test('requires --yes when headless and never starts the copying call', async () => {
    const output = capture();
    const calls: LegacyImportRequest[] = [];
    const exitCode = await handlePostgresCommand(
      ['import-legacy'],
      { modules: 'context' },
      dependencies(output, calls),
    );

    expect(exitCode).toBe(2);
    expect(calls).toEqual([{ modules: ['context'], dryRun: true }]);
    expect(output.stderr).toEqual(['Use --yes to run a legacy import non-interactively.']);
  });

  test('requires --yes when stdin does not expose isTTY', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: undefined });
    try {
      const output = capture();
      const calls: LegacyImportRequest[] = [];
      let prompted = false;
      const exitCode = await handlePostgresCommand(['import-legacy'], { modules: 'context' }, {
        io: output.io,
        importLegacy: async (request) => {
          calls.push(request);
          return request.dryRun === true ? pending : imported;
        },
        confirm: async () => {
          prompted = true;
          return true;
        },
      });

      expect(exitCode).toBe(2);
      expect(calls).toEqual([{ modules: ['context'], dryRun: true }]);
      expect(prompted).toBe(false);
      expect(output.stderr).toEqual(['Use --yes to run a legacy import non-interactively.']);
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(process.stdin, 'isTTY');
      else Object.defineProperty(process.stdin, 'isTTY', descriptor);
    }
  });

  test('returns an explicit unchanged result when every table is already verified', async () => {
    const output = capture();
    const calls: LegacyImportRequest[] = [];
    const exitCode = await handlePostgresCommand(['import-legacy'], { json: true }, {
      io: output.io,
      isTTY: false,
      importLegacy: async (request) => {
        calls.push(request);
        return verified;
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toEqual([{ modules: ALL_MODULES, dryRun: true }]);
    expect(JSON.parse(output.stdout[0] ?? '{}')).toMatchObject({ changed: false, data: [{ status: 'verified' }] });
  });

  test('preflights, imports, and reports verification metadata with --yes', async () => {
    const output = capture();
    const calls: LegacyImportRequest[] = [];
    const exitCode = await handlePostgresCommand(
      ['import-legacy'],
      { yes: true, json: true, modules: 'context', schema: 'fred_test' },
      dependencies(output, calls),
    );

    expect(exitCode).toBe(0);
    expect(calls).toEqual([
      { schema: 'fred_test', modules: ['context'], dryRun: true },
      { schema: 'fred_test', modules: ['context'] },
    ]);
    const payload = JSON.parse(output.stdout[0] ?? '{}');
    expect(payload).toMatchObject({ ok: true, dryRun: false, preflight: [{ status: 'pending' }], data: [{ status: 'imported' }] });
    expect(JSON.stringify(output)).not.toContain('postgres://');
  });

  test('requires explicit confirmation and stops cleanly when declined', async () => {
    const output = capture();
    const calls: LegacyImportRequest[] = [];
    const exitCode = await handlePostgresCommand(
      ['import-legacy'],
      { modules: 'context' },
      dependencies(output, calls, { isTTY: true, confirm: async () => false }),
    );

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(output.stdout.at(-1)).toBe('Aborted.');
  });

  test('sanitizes importer failures', async () => {
    const output = capture();
    const exitCode = await handlePostgresCommand(['import-legacy'], { 'dry-run': true, json: true }, {
      io: output.io,
      importLegacy: async () => { throw new Error('postgres://user:secret@db.example/fred'); },
    });

    expect(exitCode).toBe(1);
    expect(JSON.stringify(output)).toContain('Legacy import failed.');
    expect(JSON.stringify(output)).not.toContain('secret');
  });
});
