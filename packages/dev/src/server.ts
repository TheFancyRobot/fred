#!/usr/bin/env bun

import { startServer } from '@fancyrobot/fred-http';

function parseArgs(): { configPath?: string; port?: number } {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  const portIndex = args.indexOf('--port');

  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1]) : undefined;

  return { configPath, port };
}

if (import.meta.main) {
  startServer(parseArgs());
}
