export type MCPSecurityErrorCode = 'COMMAND_DENIED' | 'URL_DENIED' | 'SCHEME_DENIED';

export class MCPSecurityError extends Error {
  readonly code: MCPSecurityErrorCode;

  constructor(code: MCPSecurityErrorCode, message: string) {
    super(message);
    this.name = 'MCPSecurityError';
    this.code = code;
  }
}

export const DEFAULT_ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'SHELL', 'NODE_ENV', 'LANG', 'TERM'];

export const validateCommand = (command: string, allowedCommands?: string[]): void => {
  if (allowedCommands === undefined) {
    return;
  }

  if (!allowedCommands.includes(command)) {
    throw new MCPSecurityError(
      'COMMAND_DENIED',
      `MCP stdio command '${command}' is not allowed. Allowed commands: [${allowedCommands.join(', ')}]`
    );
  }
};

export const validateUrl = (
  url: string,
  allowedHosts?: string[],
  allowedSchemes?: string[]
): void => {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new MCPSecurityError('URL_DENIED', `Invalid MCP URL: '${url}'`);
  }

  const scheme = parsedUrl.protocol.replace(':', '');
  const effectiveAllowedSchemes =
    allowedSchemes ?? (allowedHosts !== undefined ? ['https'] : undefined);

  if (effectiveAllowedSchemes !== undefined && !effectiveAllowedSchemes.includes(scheme)) {
    throw new MCPSecurityError(
      'SCHEME_DENIED',
      `MCP URL scheme '${scheme}' is not allowed. Allowed schemes: [${effectiveAllowedSchemes.join(', ')}]`
    );
  }

  if (allowedHosts !== undefined && !allowedHosts.includes(parsedUrl.hostname)) {
    throw new MCPSecurityError(
      'URL_DENIED',
      `MCP URL host '${parsedUrl.hostname}' is not allowed. Allowed hosts: [${allowedHosts.join(', ')}]`
    );
  }
};

export const filterEnv = (
  envAllowlist?: string[],
  explicitEnv?: Record<string, string>
): Record<string, string> => {
  const allowlist = envAllowlist ?? DEFAULT_ENV_ALLOWLIST;
  const filtered: Record<string, string> = {};

  for (const key of allowlist) {
    const value = process.env[key];
    if (value !== undefined) {
      filtered[key] = value;
    }
  }

  return {
    ...filtered,
    ...explicitEnv,
  };
};
