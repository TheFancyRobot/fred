/**
 * TTY-aware color utility
 *
 * Provides ANSI color codes when outputting to a TTY, plain text otherwise.
 */

export interface Colors {
  green: (text: string) => string;
  yellow: (text: string) => string;
  red: (text: string) => string;
  gray: (text: string) => string;
  bold: (text: string) => string;
}

/**
 * Create a color utility instance.
 *
 * @param isTTY - Whether to enable color output. Defaults to process.stdout.isTTY
 * @returns Object with color methods
 */
export function createColors(isTTY?: boolean): Colors {
  const useColor = isTTY ?? (process.stdout.isTTY ?? false);

  if (!useColor) {
    // Plain text mode
    return {
      green: (text) => text,
      yellow: (text) => text,
      red: (text) => text,
      gray: (text) => text,
      bold: (text) => text,
    };
  }

  // ANSI color mode
  return {
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    gray: (text) => `\x1b[90m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[0m`,
  };
}
