#!/usr/bin/env bun

import { Fred } from './index';
import { watch } from 'fs';
import { resolve } from 'path';

/**
 * Development chat interface with hot reload
 * Maintains conversation context until terminal is closed
 */

let fred: Fred;
let conversationId: string;
let isReloading = false;

/**
 * Initialize or reload Fred instance
 */
async function initializeFred() {
  if (isReloading) return;
  isReloading = true;

  try {
    console.log('\n🔄 Reloading Fred...');
    
    // Create new Fred instance
    const newFred = new Fred();
    
    // Try to load config if it exists
    const configPaths = [
      resolve(process.cwd(), 'config.json'),
      resolve(process.cwd(), 'fred.config.json'),
      resolve(process.cwd(), 'config.yaml'),
      resolve(process.cwd(), 'fred.config.yaml'),
    ];

    let configLoaded = false;
    for (const configPath of configPaths) {
      try {
        await newFred.initializeFromConfig(configPath);
        console.log(`✅ Loaded config from ${configPath}`);
        configLoaded = true;
        break;
      } catch {
        // Config file doesn't exist or invalid, continue
      }
    }

    if (!configLoaded) {
      // Register default providers if no config
      newFred.registerDefaultProviders();
      console.log('✅ Using default providers (set OPENAI_API_KEY or GROQ_API_KEY)');
    }

    // Preserve conversation context if it exists
    if (fred && conversationId) {
      const contextManager = fred.getContextManager();
      const history = await contextManager.getHistory(conversationId);
      
      if (history.length > 0) {
        const newContextManager = newFred.getContextManager();
        await newContextManager.addMessages(conversationId, history);
        console.log(`✅ Preserved conversation context (${history.length} messages)`);
      }
    }

    fred = newFred;
    console.log('✅ Fred reloaded successfully!\n');
  } catch (error) {
    console.error('❌ Error reloading Fred:', error);
  } finally {
    isReloading = false;
  }
}

/**
 * Watch for file changes and reload
 */
function setupFileWatcher() {
  const watchPaths = [
    resolve(process.cwd(), 'src'),
    resolve(process.cwd(), 'config.json'),
    resolve(process.cwd(), 'fred.config.json'),
    resolve(process.cwd(), 'config.yaml'),
    resolve(process.cwd(), 'fred.config.yaml'),
  ];

  for (const watchPath of watchPaths) {
    try {
      watch(watchPath, { recursive: true }, (eventType, filename) => {
        if (filename && !filename.includes('node_modules') && !filename.includes('.git')) {
          // Debounce reloads
          setTimeout(() => {
            initializeFred();
          }, 500);
        }
      });
    } catch {
      // Path doesn't exist, skip
    }
  }
}

/**
 * Read a line from stdin using Bun's built-in functionality
 */
async function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';

    const onData = (data: string) => {
      for (const char of data) {
        if (char === '\n' || char === '\r') {
          stdin.pause();
          stdin.removeListener('data', onData);
          resolve(input);
          return;
        } else if (char === '\u0003') {
          // Ctrl+C
          stdin.pause();
          stdin.removeListener('data', onData);
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
  
  // Generate conversation ID
  conversationId = fred.getContextManager().generateConversationId();
  console.log(`\n💬 Fred Dev Chat (Conversation ID: ${conversationId})`);
  console.log('Type your messages and press Enter. Type "exit" or "quit" to stop.');
  console.log('💡 Tip: Code changes will automatically reload Fred while preserving context!\n');

  while (true) {
    process.stdout.write('> ');
    const message = await readLine();

    if (!message.trim()) {
      continue;
    }

    if (message.toLowerCase() === 'exit' || message.toLowerCase() === 'quit') {
      console.log('\n👋 Goodbye!');
      process.exit(0);
      return;
    }

    if (message.toLowerCase() === 'clear' || message.toLowerCase() === '/clear') {
      const contextManager = fred.getContextManager();
      await contextManager.clearContext(conversationId);
      conversationId = fred.getContextManager().generateConversationId();
      console.log('\n🧹 Conversation cleared. New conversation started.\n');
      continue;
    }

    if (message.toLowerCase() === 'help' || message.toLowerCase() === '/help') {
      console.log('\n📖 Commands:');
      console.log('  exit, quit  - Exit the chat');
      console.log('  clear, /clear - Clear conversation context');
      console.log('  help, /help - Show this help message\n');
      continue;
    }

    try {
      // Process message
      const response = await fred.processMessage(message, {
        conversationId,
      });

      if (response) {
        console.log(`\n🤖 ${response.content}\n`);
      } else {
        console.log('\n❌ No response. Make sure you have a default agent set or matching intents.\n');
      }
    } catch (error) {
      console.error('\n❌ Error:', error instanceof Error ? error.message : error);
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
