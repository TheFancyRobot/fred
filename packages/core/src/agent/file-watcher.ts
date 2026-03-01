import { existsSync, readFileSync, watch, type FSWatcher } from 'fs';
import { join, resolve } from 'path';
import type { AgentConfig } from './agent';
import { parseAgentFile, toAgentConfig, validateAgentFrontmatter } from './file-loader';

export interface AgentFileChangeEvent {
  readonly filePath: string;
  readonly config: AgentConfig | null;
  readonly previousId?: string;
}

export type AgentFileChangeHandler = (event: AgentFileChangeEvent) => void | Promise<void>;

export class AgentFileWatcher {
  private watchers: FSWatcher[] = [];
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private knownAgentIds = new Map<string, string>();
  private readonly debounceMs: number;

  constructor(
    private readonly dirs: string[],
    private readonly basePath: string,
    private readonly onFileChanged: AgentFileChangeHandler,
    options?: { debounceMs?: number }
  ) {
    this.debounceMs = options?.debounceMs ?? 100;
  }

  start(): void {
    for (const dir of this.dirs) {
      const resolvedDir = resolve(this.basePath, dir);
      if (!existsSync(resolvedDir)) {
        continue;
      }

      try {
        const watcher = watch(resolvedDir, { recursive: true }, (_eventType, filename) => {
          if (typeof filename !== 'string' || !filename.endsWith('.md')) {
            return;
          }
          const filePath = join(resolvedDir, filename);
          this.scheduleReload(filePath);
        });
        this.watchers.push(watcher);
      } catch (error) {
        console.warn(
          `[AgentFileWatcher] Failed to watch directory "${resolvedDir}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  registerKnownAgent(filePath: string, agentId: string): void {
    this.knownAgentIds.set(filePath, agentId);
  }

  close(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private scheduleReload(filePath: string): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.handleFileChange(filePath);
    }, this.debounceMs);
    this.debounceTimers.set(filePath, timer);
  }

  private handleFileChange(filePath: string): void {
    const previousId = this.knownAgentIds.get(filePath);

    if (!existsSync(filePath)) {
      if (previousId) {
        this.knownAgentIds.delete(filePath);
        void this.onFileChanged({ filePath, config: null, previousId });
      }
      return;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = parseAgentFile(content, filePath);

      if (parsed === null) {
        return;
      }

      validateAgentFrontmatter(parsed.frontmatter, filePath);
      const config = toAgentConfig(parsed);
      this.knownAgentIds.set(filePath, config.id);
      void this.onFileChanged({ filePath, config, previousId });
    } catch (error) {
      console.warn(
        `[AgentFileWatcher] Error reloading "${filePath}": ${error instanceof Error ? error.message : String(error)}`
      );

      if (previousId) {
        this.knownAgentIds.delete(filePath);
        void this.onFileChanged({ filePath, config: null, previousId });
      }
    }
  }
}
