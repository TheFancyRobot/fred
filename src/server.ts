#!/usr/bin/env bun

import { Fred } from './index';
import { ServerApp } from './server/app';

/**
 * Server mode entry point
 * Can be run with: bun run src/server.ts
 * Or with config: bun run src/server.ts --config path/to/config.json
 */

async function main() {
  const fred = new Fred();
  const app = new ServerApp(fred);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  const portIndex = args.indexOf('--port');
  
  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1]) : 3000;

  // Initialize from config if provided
  if (configPath) {
    try {
      await fred.initializeFromConfig(configPath);
      console.log(`Initialized from config: ${configPath}`);
    } catch (error) {
      console.error(`Failed to load config: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  } else {
    // Register default providers
    fred.registerDefaultProviders();
    console.log('No config file provided. Using default providers.');
    console.log('Register agents, intents, and tools programmatically or provide a config file.');
  }

  // Start server
  await app.start(port);
}

// Run if this is the main module
// @ts-ignore - Bun global
if (import.meta.main) {
  main().catch((error) => {
    console.error('Failed to start server:', error);
    // @ts-ignore - Bun global
    if (typeof process !== 'undefined') {
      // @ts-ignore - Bun global
      process.exit(1);
    }
  });
}

export { ServerApp };

