/** Strip terminal escape and control sequences from untrusted display text. */
export function sanitizeForTerminalDisplay(text: string): string {
  return text
    // OSC (e.g. OSC52), DCS/PM/APC payloads, CSI, and simple ESC sequences.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[P^_][\s\S]*?\x1b\\/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x9b[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    // Keep layout-friendly whitespace while removing remaining C0/C1 controls.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
}

/** Sanitize and flatten one value before measuring or rendering a table cell. */
export function sanitizeForTerminalTableCell(text: string): string {
  return sanitizeForTerminalDisplay(text).replace(/[\t\n\r]/g, ' ');
}
