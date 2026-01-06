import { FrameworkConfig } from './types';
import { parseConfigFile } from './parser';
import { Intent } from '../core/intent/intent';
import { AgentConfig } from '../core/agent/agent';
import { Tool } from '../core/tool/tool';

/**
 * Load configuration from a file
 */
export function loadConfig(filePath: string): FrameworkConfig {
  return parseConfigFile(filePath);
}

/**
 * Validate config structure
 */
export function validateConfig(config: FrameworkConfig): void {
  if (config.intents) {
    for (const intent of config.intents) {
      if (!intent.id) {
        throw new Error('Intent must have an id');
      }
      if (!intent.utterances || intent.utterances.length === 0) {
        throw new Error(`Intent "${intent.id}" must have at least one utterance`);
      }
      if (!intent.action) {
        throw new Error(`Intent "${intent.id}" must have an action`);
      }
      if (!intent.action.type || !intent.action.target) {
        throw new Error(`Intent "${intent.id}" action must have type and target`);
      }
    }
  }

  if (config.agents) {
    for (const agent of config.agents) {
      if (!agent.id) {
        throw new Error('Agent must have an id');
      }
      if (!agent.systemMessage) {
        throw new Error(`Agent "${agent.id}" must have a systemMessage`);
      }
      if (!agent.platform) {
        throw new Error(`Agent "${agent.id}" must have a platform`);
      }
      if (!agent.model) {
        throw new Error(`Agent "${agent.id}" must have a model`);
      }
    }
  }

  if (config.tools) {
    for (const tool of config.tools) {
      if (!tool.id) {
        throw new Error('Tool must have an id');
      }
      if (!tool.name) {
        throw new Error(`Tool "${tool.id}" must have a name`);
      }
      if (!tool.description) {
        throw new Error(`Tool "${tool.id}" must have a description`);
      }
      if (!tool.parameters) {
        throw new Error(`Tool "${tool.id}" must have parameters`);
      }
    }
  }
}

/**
 * Extract intents from config
 */
export function extractIntents(config: FrameworkConfig): Intent[] {
  return config.intents || [];
}

/**
 * Extract agents from config
 */
export function extractAgents(config: FrameworkConfig): AgentConfig[] {
  return config.agents || [];
}

/**
 * Extract tools from config (without execute functions)
 */
export function extractTools(config: FrameworkConfig): Omit<Tool, 'execute'>[] {
  return config.tools || [];
}


