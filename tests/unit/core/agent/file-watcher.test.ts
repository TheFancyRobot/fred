import { afterEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AgentConfig } from '../../../../packages/core/src/agent/agent';
import { AgentFileWatcher, type AgentFileChangeEvent } from '../../../../packages/core/src/agent/file-watcher';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'fred-agent-watcher-'));
  tempDirs.push(directory);
  return directory;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const writeAgentDefinition = (filePath: string, id: string): void => {
  writeFileSync(
    filePath,
    `---
id: ${id}
platform: openai
model: gpt-4o-mini
---

You are ${id}.
`
  );
};

const withWatcher = async (
  setup: (args: {
    root: string;
    watcher: AgentFileWatcher;
    events: AgentFileChangeEvent[];
    partialEvents: Array<{ partialName: string; filePath: string }>;
    warnings: string[];
  }) => Promise<void> | void,
  options?: {
    partialDirs?: string[];
  }
): Promise<void> => {
  const root = makeTempDir();
  const warnings: string[] = [];
  const events: AgentFileChangeEvent[] = [];
  const partialEvents: Array<{ partialName: string; filePath: string }> = [];
  const originalWarn = console.warn;
  console.warn = mock((...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(' '));
  });

  const watcher = new AgentFileWatcher(['./agents'], root, (event) => {
    events.push(event);
  }, {
    debounceMs: 10,
    partialDirs: options?.partialDirs,
    onPartialChanged: (partialName, filePath) => {
      partialEvents.push({ partialName, filePath });
    },
  } as any);

  try {
    await setup({ root, watcher, events, partialEvents, warnings });
  } finally {
    watcher.close();
    console.warn = originalWarn;
  }
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('AgentFileWatcher', () => {
  it('constructor accepts dirs, basePath, callback, and debounce option', () => {
    const root = makeTempDir();
    const watcher = new AgentFileWatcher(['./agents'], root, () => {}, { debounceMs: 25 });
    expect(watcher).toBeDefined();
    watcher.close();
  });

  it('coalesces rapid writes into a single reload event', async () => {
    await withWatcher(async ({ root, watcher, events }) => {
      const agentDir = join(root, 'agents');
      mkdirSync(agentDir, { recursive: true });
      const filePath = join(agentDir, 'assistant.md');
      watcher.start();

      writeAgentDefinition(filePath, 'assistant-v1');
      writeAgentDefinition(filePath, 'assistant-v2');
      writeAgentDefinition(filePath, 'assistant-v3');

      await sleep(60);

      expect(events).toHaveLength(1);
      expect(events[0]?.filePath).toBe(filePath);
      expect(events[0]?.config?.id).toBe('assistant-v3');
    });
  });

  it('emits config and previousId for updates', async () => {
    await withWatcher(async ({ root, watcher, events }) => {
      const agentDir = join(root, 'agents');
      mkdirSync(agentDir, { recursive: true });
      const filePath = join(agentDir, 'support.md');

      watcher.registerKnownAgent(filePath, 'support-v1');
      watcher.start();

      writeAgentDefinition(filePath, 'support-v2');
      await sleep(60);

      expect(events).toHaveLength(1);
      expect(events[0]?.previousId).toBe('support-v1');
      expect(events[0]?.config?.id).toBe('support-v2');
    });
  });

  it('emits null config for deleted files when known id exists', async () => {
    await withWatcher(async ({ root, watcher, events }) => {
      const agentDir = join(root, 'agents');
      mkdirSync(agentDir, { recursive: true });
      const filePath = join(agentDir, 'delete-me.md');

      watcher.registerKnownAgent(filePath, 'delete-agent');

      (watcher as any).handleFileChange(filePath);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ filePath, config: null, previousId: 'delete-agent' });
    });
  });

  it('logs warnings and emits error event when parsing invalid frontmatter', async () => {
    await withWatcher(async ({ root, watcher, events, warnings }) => {
      const agentDir = join(root, 'agents');
      mkdirSync(agentDir, { recursive: true });
      const filePath = join(agentDir, 'broken.md');
      writeFileSync(filePath, '---\nid: broken\nplatform: openai\n---\n');

      expect(() => (watcher as any).handleFileChange(filePath)).not.toThrow();
      expect(events).toHaveLength(1);
      expect(events[0]?.config).toBeNull();
      expect(events[0]?.error).toBeString();
      expect(warnings.some((line) => line.includes('Error reloading'))).toBe(true);
    });
  });

  it('ignores plain markdown files without frontmatter', async () => {
    await withWatcher(async ({ root, watcher, events }) => {
      const agentDir = join(root, 'agents');
      mkdirSync(agentDir, { recursive: true });
      const filePath = join(agentDir, 'plain.md');
      writeFileSync(filePath, 'This is a plain prompt file and should be ignored.');

      (watcher as any).handleFileChange(filePath);

      expect(events).toHaveLength(0);
    });
  });

  it('close() stops watching and clears pending debounce timers', async () => {
    await withWatcher(async ({ root, watcher, events }) => {
      const agentDir = join(root, 'agents');
      mkdirSync(agentDir, { recursive: true });
      const filePath = join(agentDir, 'closing.md');

      watcher.start();
      writeAgentDefinition(filePath, 'closing-agent');
      watcher.close();

      await sleep(40);

      expect(events).toHaveLength(0);
      expect(((watcher as any).debounceTimers as Map<string, ReturnType<typeof setTimeout>>).size).toBe(0);
    });
  });

  it('starts watcher for configured partial directories', async () => {
    await withWatcher(async ({ root, watcher }) => {
      const agentDir = join(root, 'agents');
      const partialDir = join(root, 'partials');
      mkdirSync(agentDir, { recursive: true });
      mkdirSync(partialDir, { recursive: true });

      watcher.start();

      expect(((watcher as any).watchers as unknown[]).length).toBe(2);
    }, { partialDirs: ['./partials'] });
  });

  it('emits partial changed callback with normalized partial name for markdown files', async () => {
    await withWatcher(async ({ root, watcher, partialEvents }) => {
      const agentDir = join(root, 'agents');
      const partialDir = join(root, 'partials');
      mkdirSync(agentDir, { recursive: true });
      mkdirSync(partialDir, { recursive: true });

      watcher.start();
      const partialPath = join(partialDir, 'safety.md');
      writeFileSync(partialPath, 'always be safe');

      await sleep(60);

      expect(partialEvents).toHaveLength(1);
      expect(partialEvents[0]).toEqual({
        partialName: 'safety',
        filePath: partialPath,
      });
    }, { partialDirs: ['./partials'] });
  });

  it('ignores non-markdown changes in partial directories', async () => {
    await withWatcher(async ({ root, watcher, partialEvents }) => {
      const agentDir = join(root, 'agents');
      const partialDir = join(root, 'partials');
      mkdirSync(agentDir, { recursive: true });
      mkdirSync(partialDir, { recursive: true });

      watcher.start();
      writeFileSync(join(partialDir, 'ignore.txt'), 'not markdown');

      await sleep(60);

      expect(partialEvents).toHaveLength(0);
    }, { partialDirs: ['./partials'] });
  });
});
