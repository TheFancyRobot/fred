import type { PluginCommandDescriptor } from './runtime.js';

export function renderPluginHelpSection(
  commands: readonly PluginCommandDescriptor[],
): string {
  if (commands.length === 0) {
    return '';
  }

  const lines = ['Plugin Commands:'];

  for (const command of commands) {
    const topLevelLabel = command.topLevelAvailable
      ? command.topLevelName
      : `${command.topLevelName} (unavailable: ${command.topLevelUnavailableReason})`;

    lines.push(`  ${topLevelLabel}`);
    lines.push(`    namespaced: ${command.namespacedName}`);
    lines.push(`    ${command.summary}`);
  }

  return `${lines.join('\n')}\n`;
}
