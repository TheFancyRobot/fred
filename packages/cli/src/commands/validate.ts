import {
  previewTemplate,
  validateAllTemplates,
  filterEnvVars,
  DEFAULT_ENV_ALLOWLIST,
  type BodyContext,
} from '@fancyrobot/fred';
import { Effect } from 'effect';
import { dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { aggregateDiagnostics } from '../project/diagnostics.js';

export interface ValidateCommandIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

const DEFAULT_IO: ValidateCommandIO = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

const formatDiagnostic = (diagnostic: {
  severity: string;
  code: string;
  message: string;
  path?: string;
  line?: number;
  column?: number;
  fix?: string;
}): string => {
  const lines: string[] = [`${diagnostic.severity}[${diagnostic.code}]: ${diagnostic.message}`];

  if (diagnostic.path) {
    let location = diagnostic.path;
    if (diagnostic.line !== undefined) {
      location += `:${diagnostic.line}`;
      if (diagnostic.column !== undefined) {
        location += `:${diagnostic.column}`;
      }
    }
    lines.push(`  --> ${location}`);
  }

  if (diagnostic.fix) {
    lines.push(`  = fix: ${diagnostic.fix}`);
  }

  return lines.join('\n');
};

const getAgentDirs = (configPath: string, configuredDirs?: string[]): string[] => {
  if (configuredDirs && configuredDirs.length > 0) {
    return configuredDirs;
  }

  const basePath = dirname(configPath);
  const defaultDir = `${basePath}/agents`;
  if (existsSync(defaultDir)) {
    return ['./agents'];
  }

  return [];
};

const extractFrontmatterBlock = (content: string): string | null => {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return null;
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match?.[1] ?? null;
};

const parseFrontmatterValue = (raw: string, key: string): string | undefined => {
  const match = raw.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim();
};

const parseFrontmatterNumber = (raw: string, key: string): number | undefined => {
  const value = parseFrontmatterValue(raw, key);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildPreviewContext = (
  filePath: string,
  config: {
    defaultSystemMessage?: string;
    agentDirs?: string[];
    template?: { envAllowlist?: string[] };
  }
): BodyContext | null => {
  const rawFrontmatter = extractFrontmatterBlock(readFileSync(filePath, 'utf-8'));
  if (!rawFrontmatter) {
    return null;
  }

  const id = parseFrontmatterValue(rawFrontmatter, 'id');
  const model = parseFrontmatterValue(rawFrontmatter, 'model');
  const platform = parseFrontmatterValue(rawFrontmatter, 'platform');
  if (!id || !model || !platform) {
    return null;
  }
  const envAllowlist = config.template?.envAllowlist ?? [...DEFAULT_ENV_ALLOWLIST];
  const filteredEnv = filterEnvVars(process.env as Record<string, string | undefined>, envAllowlist);

  return {
    vars: {},
    env: filteredEnv,
    config: {
      defaultSystemMessage: config.defaultSystemMessage,
      agentDirs: config.agentDirs,
    },
    agent: {
      id,
      model,
      platform,
      temperature: parseFrontmatterNumber(rawFrontmatter, 'temperature'),
      maxTokens: parseFrontmatterNumber(rawFrontmatter, 'maxTokens'),
    },
  };
};

export async function handleValidateCommand(
  _args: string[],
  options: Record<string, unknown>,
  io: ValidateCommandIO = DEFAULT_IO
): Promise<number> {
  const configResult = resolveProjectConfig();
  const preview = options.preview === true;

  if (!configResult.success) {
    const { errors, summary } = aggregateDiagnostics(configResult.diagnostics);
    for (const diagnostic of configResult.diagnostics) {
      io.stderr(formatDiagnostic(diagnostic));
    }
    io.stderr(`\n${summary}`);
    return errors > 0 ? 1 : 2;
  }

  const config = configResult.config!;
  const configPath = configResult.configPath!;
  const basePath = dirname(configPath);
  const agentDirs = getAgentDirs(configPath, config.agentDirs);
  if (agentDirs.length === 0) {
    io.stdout('No agent directories configured or discovered.');
    return 0;
  }

  const results = await Effect.runPromise(validateAllTemplates(agentDirs, basePath, {
    partialDirs: config.template?.partialDirs,
    envAllowlist: config.template?.envAllowlist,
  }));

  if (results.length === 0) {
    io.stdout('No markdown agent templates found to validate.');
    return 0;
  }

  let hasErrors = false;
  for (const result of results) {
    if (result.valid) {
      io.stdout(`✓ ${result.filePath}`);
      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          io.stdout(`  ! ${warning}`);
        }
      }
      continue;
    }

    hasErrors = true;
    io.stderr(`✗ ${result.filePath}`);
    io.stderr(`  ${result.error ?? 'Unknown template validation error'}`);
    if (result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        io.stderr(`  ! ${warning}`);
      }
    }
  }

  if (preview) {
    for (const result of results) {
      if (!result.valid) {
        continue;
      }

      const context = buildPreviewContext(result.filePath, config);
      if (context === null) {
        continue;
      }

      const resolved = await Effect.runPromise(previewTemplate(result.filePath, context, {
        partialDirs: config.template?.partialDirs,
      }));

      io.stdout(`\n--- preview: ${result.filePath} ---`);
      io.stdout(resolved);
    }
  }

  if (hasErrors) {
    return 1;
  }

  io.stdout(`Validated ${results.length} template${results.length === 1 ? '' : 's'} successfully.`);
  return 0;
}
