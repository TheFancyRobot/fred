import { existsSync, readdirSync, readFileSync } from 'fs';
import { extname, resolve } from 'path';
import yaml from 'js-yaml';
import { Eta, EtaParseError } from 'eta';
import { Schema } from 'effect';
import type { AgentConfig, ToolRetryPolicy } from './agent';
import { AgentFileParseError } from './errors';
import type { FrameworkConfig } from '../config/types';
import { ProviderConnectionId, ProviderConnectionNamespace } from '../platform/connections';
import { buildFrontmatterContext } from '../template/context';
import { containsEtaSyntax } from '../template/engine';
import { SECURITY_HEADER } from '../template/security';

type VariableValue = string | number | boolean;

type AgentConfigWithVars = AgentConfig & {
  vars?: Record<string, VariableValue>;
};

export interface ParsedAgentFile {
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
  readonly filePath: string;
  readonly vars?: Record<string, VariableValue>;
}

export interface AgentFileTemplateOptions {
  globalVars: Record<string, VariableValue>;
  filteredEnv: Record<string, string>;
  fredConfig: Partial<FrameworkConfig>;
}

const REQUIRED_FRONTMATTER_FIELDS = ['id', 'platform', 'model'] as const;

const throwParseError = (filePath: string, message: string): never => {
  throw new AgentFileParseError({ filePath, message });
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isVariableValue = (value: unknown): value is VariableValue =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const extractFrontmatterVars = (frontmatter: Record<string, unknown>, filePath: string): Record<string, VariableValue> | undefined => {
  if (!('vars' in frontmatter) || frontmatter.vars === undefined) {
    return undefined;
  }

  const varsBlock = frontmatter.vars;

  if (!isPlainRecord(varsBlock)) {
    throwParseError(filePath, 'frontmatter vars must be an object with string, number, or boolean values');
  }

  const varsRecord = varsBlock as Record<string, unknown>;
  const normalized: Record<string, VariableValue> = {};
  for (const [key, value] of Object.entries(varsRecord)) {
    if (!isVariableValue(value)) {
      throwParseError(filePath, `frontmatter vars.${key} must be a string, number, or boolean`);
    }
    normalized[key] = value as VariableValue;
  }

  return normalized;
};

const isToolChoice = (value: unknown): value is AgentConfig['toolChoice'] => {
  if (value === 'auto' || value === 'required' || value === 'none') {
    return true;
  }

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const asRecord = value as Record<string, unknown>;
  if (asRecord.type === 'tool' && typeof asRecord.toolName === 'string' && asRecord.toolName.length > 0) {
    return true;
  }

  if (typeof asRecord.tool === 'string' && asRecord.tool.length > 0) {
    return true;
  }

  return Array.isArray(asRecord.oneOf)
    && asRecord.oneOf.every((toolName) => typeof toolName === 'string' && toolName.length > 0)
    && (asRecord.mode === undefined || asRecord.mode === 'auto' || asRecord.mode === 'required');
};

const isToolRetryPolicy = (value: unknown): value is ToolRetryPolicy => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const policy = value as Record<string, unknown>;
  if (policy.maxRetries !== undefined && !isPositiveNumber(policy.maxRetries)) {
    return false;
  }
  if (policy.backoffMs !== undefined && !isPositiveNumber(policy.backoffMs)) {
    return false;
  }
  if (policy.maxBackoffMs !== undefined && !isPositiveNumber(policy.maxBackoffMs)) {
    return false;
  }
  if (policy.jitterMs !== undefined && !isPositiveNumber(policy.jitterMs)) {
    return false;
  }

  return true;
};

const getClosingDelimiter = (content: string, searchFrom: number): { yamlEnd: number; bodyStart: number } | null => {
  let cursor = searchFrom;

  while (cursor < content.length) {
    const markerIndex = content.indexOf('\n---', cursor);
    if (markerIndex === -1) {
      return null;
    }

    const afterDashes = markerIndex + 4;
    const nextChar = content[afterDashes];
    if (nextChar === '\n') {
      return { yamlEnd: markerIndex, bodyStart: afterDashes + 1 };
    }
    if (nextChar === '\r' && content[afterDashes + 1] === '\n') {
      return { yamlEnd: markerIndex, bodyStart: afterDashes + 2 };
    }
    if (afterDashes === content.length) {
      return { yamlEnd: markerIndex, bodyStart: afterDashes };
    }

    cursor = markerIndex + 1;
  }

  return null;
};

const parseYamlFrontmatter = (yamlContent: string, filePath: string): Record<string, unknown> => {
  let loaded: unknown;
  try {
    loaded = yaml.load(yamlContent);
  } catch (error) {
    return throwParseError(filePath, `Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isPlainRecord(loaded)) {
    return throwParseError(filePath, 'YAML frontmatter must be an object');
  }

  return loaded;
};

const parseFrontmatterAndBody = (
  content: string,
  filePath: string
): {
  frontmatterYaml: string;
  frontmatter: Record<string, unknown>;
  body: string;
} | null => {
  let yamlStart = 0;
  if (content.startsWith('---\n')) {
    yamlStart = 4;
  } else if (content.startsWith('---\r\n')) {
    yamlStart = 5;
  } else {
    return null;
  }

  const delimiter = getClosingDelimiter(content, yamlStart);
  if (delimiter === null) {
    return throwParseError(filePath, 'Unterminated YAML frontmatter');
  }

  const frontmatterYaml = content.slice(yamlStart, delimiter.yamlEnd);
  const frontmatter = parseYamlFrontmatter(frontmatterYaml, filePath);

  const body = content.slice(delimiter.bodyStart).trim();
  if (body.length === 0) {
    return throwParseError(filePath, 'Agent file must have prompt content below frontmatter');
  }

  return {
    frontmatterYaml,
    frontmatter,
    body,
  };
};

export const parseAgentFile = (content: string, filePath: string): ParsedAgentFile | null => {
  const parsed = parseFrontmatterAndBody(content, filePath);
  if (parsed === null) {
    return null;
  }

  return {
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    filePath,
  };
};

export const validateAgentFrontmatter = (frontmatter: Record<string, unknown>, filePath: string): void => {
  for (const key of REQUIRED_FRONTMATTER_FIELDS) {
    if (typeof frontmatter[key] !== 'string' || frontmatter[key].trim().length === 0) {
      throwParseError(filePath, `Missing required frontmatter field: ${key}`);
    }
  }

  if ('systemMessage' in frontmatter) {
    throwParseError(
      filePath,
      'systemMessage should not appear in frontmatter -- the markdown body below the frontmatter IS the system prompt'
    );
  }

  if (frontmatter.temperature !== undefined) {
    if (typeof frontmatter.temperature !== 'number' || frontmatter.temperature < 0 || frontmatter.temperature > 2) {
      throwParseError(filePath, 'temperature must be a number between 0 and 2');
    }
  }

  if (frontmatter.maxTokens !== undefined && !isPositiveNumber(frontmatter.maxTokens)) {
    throwParseError(filePath, 'maxTokens must be a positive number');
  }

  if (frontmatter.maxSteps !== undefined && !isPositiveNumber(frontmatter.maxSteps)) {
    throwParseError(filePath, 'maxSteps must be a positive number');
  }

  if (frontmatter.toolTimeout !== undefined && !isPositiveNumber(frontmatter.toolTimeout)) {
    throwParseError(filePath, 'toolTimeout must be a positive number');
  }

  if (frontmatter.tools !== undefined && !isStringArray(frontmatter.tools)) {
    throwParseError(filePath, 'tools must be an array of strings');
  }

  if (frontmatter.utterances !== undefined && !isStringArray(frontmatter.utterances)) {
    throwParseError(filePath, 'utterances must be an array of strings');
  }

  if (frontmatter.mcpServers !== undefined && !isStringArray(frontmatter.mcpServers)) {
    throwParseError(filePath, 'mcpServers must be an array of strings');
  }

  if (frontmatter.connectionId !== undefined) {
    try {
      Schema.decodeUnknownSync(ProviderConnectionId)(frontmatter.connectionId);
    } catch {
      throwParseError(filePath, 'connectionId must be a UUID');
    }
  }

  if ((frontmatter.connectionId === undefined) !== (frontmatter.connectionNamespace === undefined)) {
    throwParseError(filePath, 'connectionId and connectionNamespace must be configured together');
  }

  if (frontmatter.connectionNamespace !== undefined) {
    try {
      Schema.decodeUnknownSync(ProviderConnectionNamespace)(frontmatter.connectionNamespace);
    } catch {
      throwParseError(filePath, 'connectionNamespace must be a non-empty string');
    }
  }

  if (frontmatter.persistHistory !== undefined && typeof frontmatter.persistHistory !== 'boolean') {
    throwParseError(filePath, 'persistHistory must be a boolean');
  }

  if (frontmatter.toolChoice !== undefined && !isToolChoice(frontmatter.toolChoice)) {
    throwParseError(filePath, 'toolChoice must be auto, required, none, { type: "tool", toolName: string }, { tool: string }, or { mode?: "auto" | "required", oneOf: string[] }');
  }

  if (frontmatter.toolRetry !== undefined && !isToolRetryPolicy(frontmatter.toolRetry)) {
    throwParseError(
      filePath,
      'toolRetry must be an object with positive numeric values for maxRetries, backoffMs, maxBackoffMs, and jitterMs'
    );
  }
};

export const toAgentConfig = (parsed: ParsedAgentFile): AgentConfig => {
  const { frontmatter, body } = parsed;

  const config: AgentConfig = {
    id: frontmatter.id as string,
    platform: frontmatter.platform as string,
    model: frontmatter.model as string,
    systemMessage: body.trim(),
  };

  if (frontmatter.tools !== undefined) config.tools = frontmatter.tools as string[];
  if (frontmatter.temperature !== undefined) config.temperature = frontmatter.temperature as number;
  if (frontmatter.maxTokens !== undefined) config.maxTokens = frontmatter.maxTokens as number;
  if (frontmatter.utterances !== undefined) config.utterances = frontmatter.utterances as string[];
  if (frontmatter.mcpServers !== undefined) config.mcpServers = frontmatter.mcpServers as string[];
  if (frontmatter.connectionId !== undefined) {
    config.connectionId = Schema.decodeUnknownSync(ProviderConnectionId)(frontmatter.connectionId);
    config.connectionNamespace = Schema.decodeUnknownSync(ProviderConnectionNamespace)(frontmatter.connectionNamespace);
  }
  if (frontmatter.maxSteps !== undefined) config.maxSteps = frontmatter.maxSteps as number;
  if (frontmatter.toolChoice !== undefined) config.toolChoice = frontmatter.toolChoice as AgentConfig['toolChoice'];
  if (frontmatter.toolTimeout !== undefined) config.toolTimeout = frontmatter.toolTimeout as number;
  if (frontmatter.persistHistory !== undefined) config.persistHistory = frontmatter.persistHistory as boolean;
  if (frontmatter.toolRetry !== undefined) config.toolRetry = frontmatter.toolRetry as ToolRetryPolicy;
  if (parsed.vars !== undefined) {
    (config as AgentConfigWithVars).vars = { ...parsed.vars };
  }

  return config;
};

const collectMarkdownFiles = (directory: string, files: string[]): void => {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(fullPath, files);
      continue;
    }
    if (entry.isFile() && extname(entry.name) === '.md') {
      files.push(fullPath);
    }
  }
};

export const discoverAgentFiles = (dirs: string[], basePath: string): string[] => {
  const files: string[] = [];

  for (const dir of dirs) {
    const resolvedDir = resolve(basePath, dir);
    if (!existsSync(resolvedDir)) {
      continue;
    }
    collectMarkdownFiles(resolvedDir, files);
  }

  return files;
};

export const loadAgentFiles = (dirs: string[], basePath: string, templateOptions?: AgentFileTemplateOptions): AgentConfig[] => {
  const discoveredFiles = discoverAgentFiles(dirs, basePath);
  const agents: AgentConfig[] = [];
  const eta = templateOptions
    ? new Eta({
        autoEscape: false,
        useWith: true,
        cache: true,
        debug: true,
        tags: ['<%', '%>'],
        autoTrim: [false, false],
        functionHeader: SECURITY_HEADER,
      })
    : undefined;

  for (const filePath of discoveredFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = parseAgentFile(content, filePath);
    if (parsed === null) {
      continue;
    }

    let frontmatter = parsed.frontmatter;
    if (templateOptions) {
      const raw = parseFrontmatterAndBody(content, filePath);
      if (raw !== null && containsEtaSyntax(raw.frontmatterYaml) && eta) {
        const frontmatterContext = buildFrontmatterContext(
          templateOptions.globalVars,
          templateOptions.filteredEnv,
          templateOptions.fredConfig
        );

        const resolvedFrontmatterYaml = (() => {
          try {
            return eta.renderString(raw.frontmatterYaml, frontmatterContext as Record<string, unknown>);
          } catch (error) {
            const message = error instanceof EtaParseError
              ? `Frontmatter ETA template compile error: ${error.message}`
              : `Frontmatter ETA template resolution error: ${error instanceof Error ? error.message : String(error)}`;
            return throwParseError(filePath, message);
          }
        })();

        frontmatter = parseYamlFrontmatter(resolvedFrontmatterYaml, filePath);
      }
    }

    const frontmatterVars = extractFrontmatterVars(frontmatter, filePath);
    const mergedVars = templateOptions
      ? {
          ...templateOptions.globalVars,
          ...(frontmatterVars ?? {}),
        }
      : undefined;

    validateAgentFrontmatter(frontmatter, filePath);
    agents.push(
      toAgentConfig({
        ...parsed,
        frontmatter,
        vars: mergedVars,
      })
    );
  }

  return agents;
};
