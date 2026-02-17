/**
 * Init command handler
 *
 * Provides `fred init` — scaffolds a minimal Fred project with a starter
 * config file that is immediately runnable with `fred chat`.
 */

import { existsSync as nodeExistsSync } from 'fs';
import { writeFile as nodeWriteFile } from 'fs/promises';
import { join, basename } from 'path';
import { sanitizeErrorForCli } from './error-sanitize.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitCommandIO {
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
}

export interface InitCommandDependencies {
  io?: InitCommandIO;
  writeFile?: (path: string, content: string) => Promise<void>;
  existsSync?: (path: string) => boolean;
  cwd?: () => string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_IO: InitCommandIO = {
  stdout: (msg) => console.log(msg),
  stderr: (msg) => console.error(msg),
};

// ---------------------------------------------------------------------------
// Scaffold templates
// ---------------------------------------------------------------------------

/**
 * Starter config template.
 *
 * Requirements:
 * - One agent ("assistant") using OpenAI gpt-4o-mini
 * - One tool reference (built-in calculator)
 * - Helpful inline comments
 * - Immediately runnable with just OPENAI_API_KEY set
 */
const CONFIG_TEMPLATE = `import type { FrameworkConfig } from '@fancyrobot/fred';

/**
 * Fred project configuration
 *
 * This starter config defines a single assistant agent backed by OpenAI.
 * To get started:
 *   1. Set your OPENAI_API_KEY environment variable
 *   2. Run: fred chat
 *
 * See the documentation for all available options:
 *   https://docs.fancyrobot.dev/config
 */
const config: FrameworkConfig = {
  // Agents are AI-powered entities that handle conversations.
  // Each agent has its own system prompt, model, and set of tools.
  agents: [
    {
      id: 'assistant',
      systemMessage: 'You are a helpful assistant. Be concise and informative.',
      platform: 'openai',
      model: 'gpt-4o-mini',
      // Tools this agent can use (references built-in or custom tools)
      tools: ['calculator'],
    },
  ],

  // Tools are functions your agents can call during a conversation.
  // The 'calculator' tool is built-in and available out of the box.
  // Add your own tools here:
  // tools: [
  //   {
  //     id: 'my-tool',
  //     name: 'My Custom Tool',
  //     description: 'What this tool does',
  //     parameters: {
  //       type: 'object',
  //       properties: {
  //         input: { type: 'string', description: 'Tool input' },
  //       },
  //       required: ['input'],
  //     },
  //   },
  // ],
};

export default config;
`;

/**
 * Files to scaffold, in order.
 * Each entry is [relative path, content].
 */
const SCAFFOLD_FILES: Array<[string, string]> = [
  ['fred.config.ts', CONFIG_TEMPLATE],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the status label for file creation/skipping.
 */
function statusLabel(action: 'create' | 'skip'): string {
  return action === 'create' ? '  create' : '  skip  ';
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Handle the `fred init` command.
 *
 * Scaffolds a minimal Fred project in the current (or specified) directory.
 * Existing files are never overwritten — they are skipped with a notice.
 *
 * @param _args   - Positional arguments (currently unused)
 * @param _options - Parsed CLI options (currently unused)
 * @param deps    - Injectable dependencies for testing
 * @returns Exit code (0 = success, 1 = error)
 */
export async function handleInitCommand(
  _args: string[],
  _options: Record<string, unknown>,
  deps: InitCommandDependencies = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const existsSync = deps.existsSync ?? nodeExistsSync;
  const writeFileFn = deps.writeFile ?? (async (p: string, c: string) => {
    await nodeWriteFile(p, c, 'utf-8');
  });
  const cwd = deps.cwd?.() ?? process.cwd();

  let created = 0;
  let skipped = 0;

  for (const [relativePath, content] of SCAFFOLD_FILES) {
    const absolutePath = join(cwd, relativePath);
    const displayName = relativePath;

    if (existsSync(absolutePath)) {
      io.stdout(`${statusLabel('skip')} ${displayName} (already exists)`);
      skipped++;
      continue;
    }

    try {
      await writeFileFn(absolutePath, content);
      io.stdout(`${statusLabel('create')} ${displayName}`);
      created++;
    } catch (error) {
      const message = sanitizeErrorForCli(error);
      io.stderr(`  error  ${displayName}: ${message}`);
      return 1;
    }
  }

  // Final summary
  io.stdout('');
  io.stdout('✓ Fred project initialized');
  io.stdout("  Run 'fred chat' to start chatting with your agent");

  return 0;
}
