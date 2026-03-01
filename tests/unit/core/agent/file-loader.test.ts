import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  parseAgentFile,
  validateAgentFrontmatter,
  toAgentConfig,
  discoverAgentFiles,
  loadAgentFiles,
  type ParsedAgentFile,
} from '../../../../packages/core/src/agent/file-loader';
import { AgentFileParseError } from '../../../../packages/core/src/agent/errors';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'fred-agent-loader-'));
  tempDirs.push(directory);
  return directory;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('file-loader', () => {
  describe('parseAgentFile', () => {
    it('parses frontmatter and markdown body', () => {
      const content = `---
id: support-agent
platform: openai
model: gpt-4o-mini
temperature: 0.3
---

You are a support assistant.
`;

      const parsed = parseAgentFile(content, '/tmp/support.md');
      expect(parsed).not.toBeNull();
      if (parsed === null) {
        throw new Error('Expected parsed output');
      }

      expect(parsed.filePath).toBe('/tmp/support.md');
      expect(parsed.frontmatter.id).toBe('support-agent');
      expect(parsed.frontmatter.platform).toBe('openai');
      expect(parsed.body).toBe('You are a support assistant.');
    });

    it('returns null for markdown files without frontmatter delimiters', () => {
      const parsed = parseAgentFile('Plain prompt file content', '/tmp/plain.md');
      expect(parsed).toBeNull();
    });

    it('throws for unterminated frontmatter', () => {
      const content = `---
id: broken
platform: openai
model: gpt-4o-mini
`;

      expect(() => parseAgentFile(content, '/tmp/broken.md')).toThrow(AgentFileParseError);
      expect(() => parseAgentFile(content, '/tmp/broken.md')).toThrow('Unterminated YAML frontmatter');
    });

    it('throws for empty body below frontmatter', () => {
      const content = `---
id: empty
platform: openai
model: gpt-4o-mini
---
`;

      expect(() => parseAgentFile(content, '/tmp/empty.md')).toThrow(AgentFileParseError);
      expect(() => parseAgentFile(content, '/tmp/empty.md')).toThrow('Agent file must have prompt content below frontmatter');
    });

    it('throws for whitespace-only body below frontmatter', () => {
      const content = `---
id: blank
platform: openai
model: gpt-4o-mini
---


   
`;

      expect(() => parseAgentFile(content, '/tmp/blank.md')).toThrow(AgentFileParseError);
      expect(() => parseAgentFile(content, '/tmp/blank.md')).toThrow('Agent file must have prompt content below frontmatter');
    });

    it('supports CRLF line endings', () => {
      const content = ['---', 'id: windows-agent', 'platform: openai', 'model: gpt-4o-mini', '---', '', 'Line one.', 'Line two.'].join('\r\n');
      const parsed = parseAgentFile(content, '/tmp/windows.md');

      expect(parsed).not.toBeNull();
      if (parsed === null) {
        throw new Error('Expected parsed output');
      }
      expect(parsed.frontmatter.id).toBe('windows-agent');
      expect(parsed.body).toBe('Line one.\r\nLine two.');
    });
  });

  describe('validateAgentFrontmatter', () => {
    it('accepts required fields', () => {
      expect(() => validateAgentFrontmatter({ id: 'a', platform: 'openai', model: 'gpt-4o-mini' }, '/tmp/valid.md')).not.toThrow();
    });

    it('rejects missing id', () => {
      expect(() => validateAgentFrontmatter({ platform: 'openai', model: 'gpt-4o-mini' }, '/tmp/missing-id.md')).toThrow('Missing required frontmatter field: id');
    });

    it('rejects missing platform', () => {
      expect(() => validateAgentFrontmatter({ id: 'x', model: 'gpt-4o-mini' }, '/tmp/missing-platform.md')).toThrow('Missing required frontmatter field: platform');
    });

    it('rejects missing model', () => {
      expect(() => validateAgentFrontmatter({ id: 'x', platform: 'openai' }, '/tmp/missing-model.md')).toThrow('Missing required frontmatter field: model');
    });

    it('rejects systemMessage in frontmatter', () => {
      expect(() => validateAgentFrontmatter({ id: 'x', platform: 'openai', model: 'gpt-4o-mini', systemMessage: 'Nope' }, '/tmp/system-message.md')).toThrow(
        'systemMessage should not appear in frontmatter -- the markdown body below the frontmatter IS the system prompt'
      );
    });

    it('ignores unknown keys', () => {
      expect(() =>
        validateAgentFrontmatter({ id: 'x', platform: 'openai', model: 'gpt-4o-mini', experimentalFlag: true }, '/tmp/unknown-key.md')
      ).not.toThrow();
    });

    it('validates temperature range and tools type', () => {
      expect(() => validateAgentFrontmatter({ id: 'x', platform: 'openai', model: 'gpt-4o-mini', temperature: 1.4, tools: ['calculator'] }, '/tmp/ok.md')).not.toThrow();
      expect(() => validateAgentFrontmatter({ id: 'x', platform: 'openai', model: 'gpt-4o-mini', temperature: 3 }, '/tmp/bad-temp.md')).toThrow(
        'temperature must be a number between 0 and 2'
      );
      expect(() => validateAgentFrontmatter({ id: 'x', platform: 'openai', model: 'gpt-4o-mini', tools: ['calculator', 1] }, '/tmp/bad-tools.md')).toThrow(
        'tools must be an array of strings'
      );
    });
  });

  describe('toAgentConfig', () => {
    it('converts parsed file to AgentConfig', () => {
      const parsed: ParsedAgentFile = {
        filePath: '/tmp/convert.md',
        frontmatter: {
          id: 'convert-agent',
          platform: 'openai',
          model: 'gpt-4o-mini',
          temperature: 0.2,
        },
        body: 'System prompt content',
      };

      const config = toAgentConfig(parsed);
      expect(config).toEqual({
        id: 'convert-agent',
        platform: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.2,
        systemMessage: 'System prompt content',
      });
    });

    it('preserves optional fields and trims body edges only', () => {
      const parsed: ParsedAgentFile = {
        filePath: '/tmp/optional.md',
        frontmatter: {
          id: 'optional-agent',
          platform: 'openai',
          model: 'gpt-4o-mini',
          tools: ['calculator'],
          maxTokens: 512,
          utterances: ['hello'],
          mcpServers: ['mcp-local'],
          maxSteps: 7,
          toolChoice: { type: 'tool', toolName: 'calculator' },
          toolTimeout: 1000,
          persistHistory: false,
          toolRetry: { maxRetries: 2, backoffMs: 10, maxBackoffMs: 20, jitterMs: 3 },
        },
        body: '  line one\n\nline three  ',
      };

      const config = toAgentConfig(parsed);
      expect(config.systemMessage).toBe('line one\n\nline three');
      expect(config.tools).toEqual(['calculator']);
      expect(config.toolRetry).toEqual({ maxRetries: 2, backoffMs: 10, maxBackoffMs: 20, jitterMs: 3 });
    });
  });

  describe('discoverAgentFiles and loadAgentFiles', () => {
    it('discovers md files recursively and skips non-md files', () => {
      const root = makeTempDir();
      const base = join(root, 'agents');
      mkdirSync(join(base, 'support', 'billing'), { recursive: true });
      writeFileSync(join(base, 'root.md'), '---\nid: a\nplatform: openai\nmodel: gpt-4o-mini\n---\nPrompt');
      writeFileSync(join(base, 'support', 'child.md'), '---\nid: b\nplatform: openai\nmodel: gpt-4o-mini\n---\nPrompt');
      writeFileSync(join(base, 'support', 'billing', 'deep.md'), '---\nid: c\nplatform: openai\nmodel: gpt-4o-mini\n---\nPrompt');
      writeFileSync(join(base, 'skip.txt'), 'ignore');

      const files = discoverAgentFiles(['./agents'], root);
      const sorted = [...files].sort();

      expect(sorted.length).toBe(3);
      expect(sorted.every((path) => path.endsWith('.md'))).toBe(true);
      expect(sorted[0]).toContain(root);
    });

    it('skips missing directories and returns empty array for empty dirs', () => {
      const root = makeTempDir();
      const empty = join(root, 'empty-agents');
      mkdirSync(empty, { recursive: true });

      expect(discoverAgentFiles(['./missing-dir'], root)).toEqual([]);
      expect(discoverAgentFiles(['./empty-agents'], root)).toEqual([]);
    });

    it('loads only md files with frontmatter into AgentConfig[]', () => {
      const root = makeTempDir();
      const base = join(root, 'agents');
      mkdirSync(base, { recursive: true });

      writeFileSync(
        join(base, 'assistant.md'),
        `---
id: assistant
platform: openai
model: gpt-4o-mini
unknownKey: keep-ignored
---

You are an assistant.
`
      );

      writeFileSync(join(base, 'prompt-only.md'), 'Just a plain prompt file without frontmatter delimiters.');

      const configs = loadAgentFiles(['./agents'], root);

      expect(configs).toHaveLength(1);
      expect(configs[0]).toEqual({
        id: 'assistant',
        platform: 'openai',
        model: 'gpt-4o-mini',
        systemMessage: 'You are an assistant.',
      });
    });
  });
});
