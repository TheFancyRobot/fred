#!/usr/bin/env node
/**
 * Postinstall script to ensure Langfuse packages stay in peerDependencies only
 * This fixes Bun's behavior of adding them to devDependencies when running bun add -d
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

const langfusePackages = [
  '@langfuse/client',
  '@langfuse/otel',
  '@opentelemetry/sdk-node',
];

let modified = false;

// Check if any Langfuse packages are in devDependencies
if (packageJson.devDependencies) {
  for (const pkg of langfusePackages) {
    if (packageJson.devDependencies[pkg]) {
      const version = packageJson.devDependencies[pkg];
      
      // Remove from devDependencies
      delete packageJson.devDependencies[pkg];
      
      // Ensure peerDependencies exists
      if (!packageJson.peerDependencies) {
        packageJson.peerDependencies = {};
      }
      
      // Always update peerDependencies with the version from devDependencies
      // This fixes Bun's behavior of clearing version strings in peerDependencies
      const currentPeerVersion = packageJson.peerDependencies[pkg];
      if (!currentPeerVersion || currentPeerVersion === '' || currentPeerVersion !== version) {
        packageJson.peerDependencies[pkg] = version;
        modified = true;
      }
      // Always mark as modified since we removed from devDependencies
      modified = true;
    }
  }
}

// Also fix any empty version strings in peerDependencies (Bun sometimes clears them)
if (packageJson.peerDependencies) {
  for (const pkg of langfusePackages) {
    if (packageJson.peerDependencies[pkg] === '') {
      // Set default versions if empty (these are the latest versions as of now)
      const defaultVersions = {
        '@langfuse/client': '^4.5.1',
        '@langfuse/otel': '^4.5.1',
        '@opentelemetry/sdk-node': '^0.210.0',
      };
      packageJson.peerDependencies[pkg] = defaultVersions[pkg] || 'latest';
      modified = true;
    }
  }
}

// Also fix any empty version strings in peerDependencies (Bun sometimes clears them)
if (packageJson.peerDependencies) {
  for (const pkg of langfusePackages) {
    if (packageJson.peerDependencies[pkg] === '') {
      // Set default versions if empty (these are the latest versions as of now)
      const defaultVersions = {
        '@langfuse/client': '^4.5.1',
        '@langfuse/otel': '^4.5.1',
        '@opentelemetry/sdk-node': '^0.210.0',
      };
      packageJson.peerDependencies[pkg] = defaultVersions[pkg] || 'latest';
      modified = true;
    }
  }
}

if (modified) {
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
  if (packageJson.devDependencies && (packageJson.devDependencies['@langfuse/client'] || packageJson.devDependencies['@langfuse/otel'] || packageJson.devDependencies['@opentelemetry/sdk-node'])) {
    console.log('✅ Moved Langfuse packages from devDependencies to peerDependencies');
  } else {
    console.log('✅ Fixed empty version strings in peerDependencies');
  }
}
