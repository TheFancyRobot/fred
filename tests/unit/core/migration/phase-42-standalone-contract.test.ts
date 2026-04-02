/**
 * Phase 42 Standalone Contract Guard Tests
 *
 * These tests enforce static migration guarantees for Phase 42:
 * - No pipeline/service.ts imports from pipeline/manager.ts
 * - No "not yet migrated to Effect" stubs in execute/resume methods
 * - No message-processor/service.ts imports from manager classes
 * - No stubs in MessageProcessorService implementation
 *
 * These guards prevent regressions of removed stubs and delegation seams.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Project root for resolving file paths
// import.meta.dir is tests/unit/core/migration, so we need to go up 4 levels to reach fred/
const PROJECT_ROOT = path.resolve(import.meta.dir, '../../../..');
const PIPELINE_SERVICE_PATH = path.join(PROJECT_ROOT, 'packages/core/src/pipeline/service.ts');
const MESSAGE_PROCESSOR_SERVICE_PATH = path.join(PROJECT_ROOT, 'packages/core/src/message-processor/service.ts');

describe('Phase 42 Static Migration Contracts', () => {
  describe('PipelineService', () => {
    test('has no imports from pipeline/manager.ts', () => {
      const content = fs.readFileSync(PIPELINE_SERVICE_PATH, 'utf-8');
      
      // Check for any import from './manager'
      const managerImportPattern = /from\s+['"]\.\/manager['"]/;
      expect(managerImportPattern.test(content)).toBe(false);
      
      // Also check for relative imports that could be manager
      const relativeManagerPattern = /from\s+['"]\.\.\/manager['"]/;
      expect(relativeManagerPattern.test(content)).toBe(false);
    });

    test('has no "not yet migrated to Effect" stubs in execute methods', () => {
      const content = fs.readFileSync(PIPELINE_SERVICE_PATH, 'utf-8');
      
      // Find all method definitions for execute* methods
      const executeMethodPattern = /execute(?:Pipeline(?:V2)?)?\s*\([^)]*\)[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
      const executeMatches = content.match(executeMethodPattern) || [];
      
      for (const match of executeMatches) {
        expect(match).not.toContain('not yet migrated to Effect');
      }
    });

    test('has no "not yet migrated to Effect" stubs in resume methods', () => {
      const content = fs.readFileSync(PIPELINE_SERVICE_PATH, 'utf-8');
      
      // Find all method definitions for resume* methods
      const resumeMethodPattern = /resume(?:WithHumanInput)?\s*\([^)]*\)[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
      const resumeMatches = content.match(resumeMethodPattern) || [];
      
      for (const match of resumeMatches) {
        expect(match).not.toContain('not yet migrated to Effect');
      }
    });

    test('uses standalone Effect implementation for executePipelineV2', () => {
      const content = fs.readFileSync(PIPELINE_SERVICE_PATH, 'utf-8');
      
      // Verify executePipelineV2 exists and uses Effect.gen
      expect(content).toContain('executePipelineV2');
      expect(content).toContain('Effect.gen');
      
      // Verify it doesn't delegate to a manager
      expect(content).not.toContain('this.manager.executePipeline');
    });

    test('uses standalone Effect implementation for resume', () => {
      const content = fs.readFileSync(PIPELINE_SERVICE_PATH, 'utf-8');
      
      // Verify resume method exists and uses Effect.gen
      expect(content).toContain('resume(runId:');
      expect(content).toContain('Effect.gen');
      
      // Verify it doesn't delegate to a manager
      expect(content).not.toContain('this.manager.resume');
    });

    test('uses standalone Effect implementation for resumeWithHumanInput', () => {
      const content = fs.readFileSync(PIPELINE_SERVICE_PATH, 'utf-8');
      
      // Verify resumeWithHumanInput method exists
      expect(content).toContain('resumeWithHumanInput');
      
      // Verify it doesn't delegate to a manager
      expect(content).not.toContain('this.manager.resumeWithHumanInput');
    });
  });

  describe('MessageProcessorService', () => {
    test('has no imports from manager classes', () => {
      const content = fs.readFileSync(MESSAGE_PROCESSOR_SERVICE_PATH, 'utf-8');
      
      // Check for any import from './manager' or similar
      const managerImportPattern = /from\s+['"]\.\/manager['"]/;
      expect(managerImportPattern.test(content)).toBe(false);
      
      // Also check for relative imports that could be manager
      const relativeManagerPattern = /from\s+['"]\.\.\/manager['"]/;
      expect(relativeManagerPattern.test(content)).toBe(false);
    });

    test('has no "not yet migrated to Effect" stubs', () => {
      const content = fs.readFileSync(MESSAGE_PROCESSOR_SERVICE_PATH, 'utf-8');
      expect(content).not.toContain('not yet migrated to Effect');
    });

    test('uses standalone Effect implementation for processMessage', () => {
      const content = fs.readFileSync(MESSAGE_PROCESSOR_SERVICE_PATH, 'utf-8');
      
      // Verify processMessage exists and uses Effect patterns
      expect(content).toContain('processMessage');
      expect(content).toContain('Effect.gen');
      
      // Verify it doesn't delegate to a manager
      expect(content).not.toContain('this.manager.processMessage');
    });

    test('uses standalone Effect implementation for streamMessage', () => {
      const content = fs.readFileSync(MESSAGE_PROCESSOR_SERVICE_PATH, 'utf-8');
      
      // Verify streamMessage exists
      expect(content).toContain('streamMessage');
      
      // Verify it uses Stream (Effect pattern)
      expect(content).toContain('Stream');
      
      // Verify it doesn't delegate to a manager
      expect(content).not.toContain('this.manager.streamMessage');
    });
  });

  describe('Service Layer Composition', () => {
    test('PipelineService layer does not depend on manager imports', () => {
      const content = fs.readFileSync(PIPELINE_SERVICE_PATH, 'utf-8');
      
      // Check that imports are from Effect or other services, not managers
      const importLines = content.split('\n').filter(line => 
        line.trim().startsWith('import ') && line.includes('from ')
      );
      
      for (const line of importLines) {
        // Manager imports would be from './manager' or '../manager'
        expect(line).not.toMatch(/from\s+['"]\.\.?\/manager['"]/);
      }
    });

    test('MessageProcessorService layer does not depend on manager imports', () => {
      const content = fs.readFileSync(MESSAGE_PROCESSOR_SERVICE_PATH, 'utf-8');
      
      // Check that imports are from Effect or other services, not managers
      const importLines = content.split('\n').filter(line => 
        line.trim().startsWith('import ') && line.includes('from ')
      );
      
      for (const line of importLines) {
        // Manager imports would be from './manager' or '../manager'
        expect(line).not.toMatch(/from\s+['"]\.\.?\/manager['"]/);
      }
    });
  });
});
