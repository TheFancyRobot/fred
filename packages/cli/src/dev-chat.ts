import type { Fred } from '@fancyrobot/fred';
import { handleChatCommand } from './commands/chat.js';

export type DevChatSetupHook = (fred: Fred) => Promise<void> | void;

/**
 * Start the CLI-owned interactive chat implementation.
 *
 * @deprecated Use the `fred chat` command or {@link handleChatCommand}.
 * This adapter remains for the final `@fancyrobot/fred-dev` compatibility release.
 */
export function startDevChat(setupHook?: DevChatSetupHook): Promise<void> {
  return handleChatCommand({ projectSetupHook: setupHook });
}
