/**
 * Config command handlers
 *
 * Provides `fred config validate` — validates project config and shows
 * Rust-compiler-style diagnostics on failure, or an entity count summary
 * on success.
 */

import { resolveProjectConfig } from '../project/resolve-config.js';
import { aggregateDiagnostics } from '../project/diagnostics.js';
import type { ConfigDiagnostic, ConfigResolutionResult } from '../project/types.js';
import type { FrameworkConfig } from '../../../core/src/config/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigCommandIO {
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
}

export interface ConfigCommandDependencies {
  io?: ConfigCommandIO;
  resolveConfig?: (startDir?: string) => ConfigResolutionResult<FrameworkConfig>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_IO: ConfigCommandIO = {
  stdout: (msg) => console.log(msg),
  stderr: (msg) => console.error(msg),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a single diagnostic in Rust-compiler-style presentation.
 *
 * ```
 * error[config-parse-error]: Unexpected token at position 42
 *   --> fred.config.ts:5:12
 *   = fix: Check JSON syntax or TypeScript export format
 * ```
 */
function formatDiagnosticDisplay(d: ConfigDiagnostic): string {
  const lines: string[] = [];

  // severity[code]: message
  lines.push(`${d.severity}[${d.code}]: ${d.message}`);

  // --> path:line:col  (only when location info is present)
  if (d.path) {
    let loc = d.path;
    if (d.line !== undefined) {
      loc += `:${d.line}`;
      if (d.column !== undefined) {
        loc += `:${d.column}`;
      }
    }
    lines.push(`  --> ${loc}`);
  }

  // = fix: hint
  if (d.fix) {
    lines.push(`  = fix: ${d.fix}`);
  }

  return lines.join('\n');
}

/**
 * Count entities from the raw config without instantiating Fred.
 *
 * Avoids the heavyweight async Fred initialisation that pulls in providers,
 * MCP servers, etc.  We only need counts for the success summary.
 */
function countEntities(config: FrameworkConfig): {
  agents: number;
  tools: number;
  intents: number;
  pipelines: number;
  workflows: number;
} {
  return {
    agents: config.agents?.length ?? 0,
    tools: config.tools?.length ?? 0,
    intents: config.intents?.length ?? 0,
    pipelines: (config.pipelines?.length ?? 0) +
      Object.keys(config.pipelinesV2 ?? {}).length,
    workflows: Object.keys(config.workflows ?? {}).length,
  };
}

/**
 * Build human-readable counts line, e.g.
 * "3 agents, 2 tools, 1 intent, 0 pipelines, 0 workflows"
 */
function entityCountLine(counts: ReturnType<typeof countEntities>): string {
  return [
    `${counts.agents} agent${counts.agents !== 1 ? 's' : ''}`,
    `${counts.tools} tool${counts.tools !== 1 ? 's' : ''}`,
    `${counts.intents} intent${counts.intents !== 1 ? 's' : ''}`,
    `${counts.pipelines} pipeline${counts.pipelines !== 1 ? 's' : ''}`,
    `${counts.workflows} workflow${counts.workflows !== 1 ? 's' : ''}`,
  ].join(', ');
}

// ---------------------------------------------------------------------------
// Validate subcommand
// ---------------------------------------------------------------------------

function handleValidate(
  options: Record<string, unknown>,
  deps: ConfigCommandDependencies,
): number {
  const io = deps.io ?? DEFAULT_IO;
  const resolve = deps.resolveConfig ?? resolveProjectConfig;

  const result = resolve();
  const jsonMode = options.json === true;

  // --- Failure path ---
  if (!result.success) {
    const { errors, summary } = aggregateDiagnostics(result.diagnostics);

    if (jsonMode) {
      io.stdout(JSON.stringify({
        ok: false,
        command: 'validate',
        configPath: result.configPath ?? null,
        diagnostics: result.diagnostics,
      }, null, 2));
    } else {
      for (const d of result.diagnostics) {
        io.stderr(formatDiagnosticDisplay(d));
      }
      io.stderr(`\n${summary}`);
    }

    // exit 1 for errors, exit 2 for warnings-only
    return errors > 0 ? 1 : 2;
  }

  // --- Success path ---
  const counts = countEntities(result.config!);

  if (jsonMode) {
    io.stdout(JSON.stringify({
      ok: true,
      command: 'validate',
      configPath: result.configPath ?? null,
      summary: counts,
    }, null, 2));
  } else {
    const configName = result.configPath ?? 'fred.config.ts';
    io.stdout(`✓ Config valid: ${configName}`);
    io.stdout(`  ${entityCountLine(counts)}`);
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Handle the `fred config <subcommand>` command.
 *
 * @param args    - Positional arguments (args[0] is the subcommand)
 * @param options - Parsed CLI options (e.g. `--json`)
 * @param deps    - Injectable dependencies for testing
 * @returns Exit code (0 = success, 1 = errors, 2 = warnings only)
 */
export async function handleConfigCommand(
  args: string[],
  options: Record<string, unknown>,
  deps: ConfigCommandDependencies = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const subcommand = args[0];

  if (!subcommand) {
    io.stderr('Missing config subcommand. Available: validate');
    return 1;
  }

  switch (subcommand) {
    case 'validate':
      return handleValidate(options, deps);
    default:
      io.stderr(`Unknown config subcommand: ${subcommand}. Available: validate`);
      return 1;
  }
}
