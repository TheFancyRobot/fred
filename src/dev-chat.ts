#!/usr/bin/env bun

import { Fred } from './index';
import { resolve, join } from 'path';
import { existsSync } from 'fs';

/**
 * Development chat interface with hot reload
 * Maintains conversation context until terminal is closed
 */

let fred: Fred | null = null;
let conversationId: string;
let isReloading = false;
let reloadTimer: Timer | null = null;
let isWaitingForInput = false;

/**
 * Initialize or reload Fred instance
 */
async function initializeFred() {
  if (isReloading) return;
  isReloading = true;

  try {
    // Clear any pending reload timers
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }

    // Show reload message (but don't interrupt if user is typing)
    if (!isWaitingForInput) {
      console.log('\n🔄 Reloading Fred...');
    }
    
    // Create new Fred instance
    const newFred = new Fred();
    
    // Try to load config files
    const configPaths = [
      resolve(process.cwd(), 'src', 'config.json'),
      resolve(process.cwd(), 'config.json'),
      resolve(process.cwd(), 'fred.config.json'),
      resolve(process.cwd(), 'src', 'config.yaml'),
      resolve(process.cwd(), 'config.yaml'),
      resolve(process.cwd(), 'fred.config.yaml'),
    ];

    let configLoaded = false;
    for (const configPath of configPaths) {
      if (existsSync(configPath)) {
        try {
          await newFred.initializeFromConfig(configPath);
          if (!isWaitingForInput) {
            console.log(`✅ Loaded config from ${configPath}`);
          }
          configLoaded = true;
          break;
        } catch (error: any) {
          // Config file exists but invalid, continue to next
          if (!isWaitingForInput && error.message) {
            console.warn(`⚠️  Config file ${configPath} exists but has errors: ${error.message}`);
          }
        }
      }
    }

    if (!configLoaded) {
      // Register default providers if no config
      newFred.registerDefaultProviders();
      if (!isWaitingForInput) {
        console.log('✅ Using default providers (set OPENAI_API_KEY or GROQ_API_KEY)');
        console.log('💡 Tip: Create a config.json file or use initializeFromConfig() in your code');
      }
    }

    // Preserve conversation context if it exists
    if (fred && conversationId) {
      const contextManager = fred.getContextManager();
      const history = await contextManager.getHistory(conversationId);
      
      if (history.length > 0) {
        const newContextManager = newFred.getContextManager();
        await newContextManager.addMessages(conversationId, history);
        if (!isWaitingForInput) {
          console.log(`✅ Preserved conversation context (${history.length} messages)`);
        }
      }
    } else if (!conversationId) {
      // Generate new conversation ID on first load
      conversationId = newFred.getContextManager().generateConversationId();
    }

    fred = newFred;
    if (!isWaitingForInput) {
      console.log('✅ Fred reloaded successfully!\n');
    }
  } catch (error) {
    if (!isWaitingForInput) {
      console.error('❌ Error reloading Fred:', error instanceof Error ? error.message : error);
    }
  } finally {
    isReloading = false;
  }
}

/**
 * Watch for file changes and reload using Bun's watch API
 */
function setupFileWatcher() {
  const watchPaths = [
    resolve(process.cwd(), 'src'),
    resolve(process.cwd(), 'config.json'),
    resolve(process.cwd(), 'fred.config.json'),
    resolve(process.cwd(), 'config.yaml'),
    resolve(process.cwd(), 'fred.config.yaml'),
  ];

  // Use Bun's watch API if available, otherwise fall back to fs.watch
  if (typeof Bun !== 'undefined' && Bun.watch) {
    const watcher = Bun.watch(watchPaths.filter(p => existsSync(p)), {
      recursive: true,
    });

    watcher.on('change', (event, filename) => {
      // Ignore node_modules, .git, and other irrelevant files
      if (
        filename.includes('node_modules') ||
        filename.includes('.git') ||
        filename.includes('dist') ||
        filename.includes('lib') ||
        filename.includes('.log')
      ) {
        return;
      }

      // Debounce reloads to avoid multiple rapid reloads
      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }

      reloadTimer = setTimeout(() => {
        initializeFred();
      }, 300);
    });

    watcher.on('error', (error) => {
      console.error('File watcher error:', error);
    });
  } else {
    // Fallback to fs.watch for Node.js compatibility
    const { watch } = require('fs');
    for (const watchPath of watchPaths) {
      if (existsSync(watchPath)) {
        try {
          watch(watchPath, { recursive: true }, (eventType, filename) => {
            if (
              filename &&
              !filename.includes('node_modules') &&
              !filename.includes('.git') &&
              !filename.includes('dist') &&
              !filename.includes('lib')
            ) {
              if (reloadTimer) {
                clearTimeout(reloadTimer);
              }

              reloadTimer = setTimeout(() => {
                initializeFred();
              }, 300);
            }
          });
        } catch {
          // Path doesn't exist or can't be watched, skip
        }
      }
    }
  }
}

/**
 * Read a line from stdin with better handling
 */
async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    isWaitingForInput = true;
    const stdin = process.stdin;
    
    // Set raw mode for better control (if available)
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';

    const cleanup = () => {
      isWaitingForInput = false;
      stdin.pause();
      if (stdin.isTTY && stdin.setRawMode) {
        stdin.setRawMode(false);
      }
      stdin.removeListener('data', onData);
    };

    const onData = (data: string) => {
      for (const char of data) {
        if (char === '\n' || char === '\r') {
          cleanup();
          process.stdout.write('\n');
          resolve(input);
          return;
        } else if (char === '\u0003') {
          // Ctrl+C
          cleanup();
          console.log('\n\n👋 Goodbye!');
          process.exit(0);
          return;
        } else if (char === '\u007f' || char === '\b') {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char >= ' ') {
          // Printable character
          input += char;
          process.stdout.write(char);
        }
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Interactive chat interface
 */
async function startChat() {
  // Initialize Fred
  await initializeFred();
  
  if (!fred) {
    console.error('❌ Failed to initialize Fred');
    process.exit(1);
  }

  // Generate conversation ID if not already set
  if (!conversationId) {
    conversationId = fred.getContextManager().generateConversationId();
  }

  console.log(`\n💬 Fred Dev Chat`);
  console.log(`📝 Conversation ID: ${conversationId}`);
  console.log('💡 Type your messages and press Enter. Code changes auto-reload!');
  console.log('📖 Type "help" for commands\n');

  while (true) {
    // Ensure fred is still available (might have been cleared during reload)
    if (!fred) {
      await initializeFred();
      if (!fred) {
        console.error('❌ Failed to reload Fred');
        continue;
      }
    }

    process.stdout.write('> ');
    const message = await readLine();

    if (!message.trim()) {
      continue;
    }

    const cmd = message.toLowerCase().trim();

    if (cmd === 'exit' || cmd === 'quit') {
      console.log('\n👋 Goodbye!');
      process.exit(0);
      return;
    }

    if (cmd === 'clear' || cmd === '/clear') {
      if (fred) {
        const contextManager = fred.getContextManager();
        await contextManager.clearContext(conversationId);
        conversationId = fred.getContextManager().generateConversationId();
        console.log(`\n🧹 Conversation cleared. New ID: ${conversationId}\n`);
      }
      continue;
    }

    if (cmd === 'help' || cmd === '/help') {
      console.log('\n📖 Commands:');
      console.log('  exit, quit     - Exit the chat');
      console.log('  clear, /clear   - Clear conversation context');
      console.log('  help, /help    - Show this help message');
      console.log('  reload, /reload - Manually reload Fred\n');
      continue;
    }

    if (cmd === 'reload' || cmd === '/reload') {
      console.log('\n🔄 Manually reloading...');
      await initializeFred();
      continue;
    }

    try {
      // Process message
      if (!fred) {
        console.log('\n⚠️  Fred not initialized. Reloading...');
        await initializeFred();
        if (!fred) {
          console.log('\n❌ Failed to initialize Fred\n');
          continue;
        }
      }

      const response = await fred.processMessage(message, {
        conversationId,
      });

      if (response) {
        console.log(`\n🤖 ${response.content}\n`);
        if (response.toolCalls && response.toolCalls.length > 0) {
          console.log(`🔧 Tools used: ${response.toolCalls.map(tc => tc.toolId).join(', ')}\n`);
        }
      } else {
        console.log('\n❌ No response. Make sure you have a default agent set or matching intents.');
        console.log('💡 Tip: Create src/index.ts to set up your agents, tools, and intents\n');
      }
    } catch (error) {
      console.error('\n❌ Error:', error instanceof Error ? error.message : error);
      if (error instanceof Error && error.stack) {
        console.error(error.stack);
      }
      console.log('');
    }
  }
}

/**
 * Main function
 */
async function main() {
  // Setup file watcher for hot reload
  setupFileWatcher();
  
  // Start chat interface
  await startChat();
}

// Run if this is the main module
// @ts-ignore - Bun global
if (import.meta.main) {
  main().catch((error) => {
    console.error('Failed to start dev chat:', error);
    process.exit(1);
  });
}
