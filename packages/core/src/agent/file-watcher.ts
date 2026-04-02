import { existsSync, readFileSync, watch, type FSWatcher } from 'fs';
import { join, resolve } from 'path';
import type { AgentConfig } from './agent';
import { parseAgentFile, toAgentConfig, validateAgentFrontmatter } from './file-loader';

export interface AgentFileChangeEvent {
  readonly filePath: string;
  readonly config: AgentConfig | null;
  readonly previousId?: string;
  readonly error?: string;
}

export type AgentFileChangeHandler = (event: AgentFileChangeEvent) => void | Promise<void>;

type PartialFileChangeHandler = (partialName: string, filePath: string) => void | Promise<void>;

interface AgentFileWatcherOptions {
  debounceMs?: number;
  partialDirs?: string[];
  onPartialChanged?: PartialFileChangeHandler;
}

export class AgentFileWatcher {
  private watchers: FSWatcher[] = [];
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private knownAgentIds = new Map<string, string>();
  private readonly debounceMs: number;
  private readonly partialDirs: string[];
  private readonly onPartialChanged?: PartialFileChangeHandler;

  constructor(
    private readonly dirs: string[],
    private readonly basePath: string,
    private readonly onFileChanged: AgentFileChangeHandler,
    options?: AgentFileWatcherOptions
  ) {
    this.debounceMs = options?.debounceMs ?? 100;
    this.partialDirs = options?.partialDirs ?? [];
    this.onPartialChanged = options?.onPartialChanged;
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

    for (const partialDir of this.partialDirs) {
      const resolvedDir = resolve(this.basePath, partialDir);
      if (!existsSync(resolvedDir)) {
        continue;
      }

      try {
        const watcher = watch(resolvedDir, { recursive: true }, (_eventType, filename) => {
          if (typeof filename !== 'string' || !filename.endsWith('.md')) {
            return;
          }

          const filePath = join(resolvedDir, filename);
          const partialName = filename.replace(/\.md$/, '').replace(/\\/g, '/');
          this.schedulePartialReload(partialName, filePath);
        });
        this.watchers.push(watcher);
      } catch (error) {
        console.warn(
          `[AgentFileWatcher] Failed to watch partial directory "${resolvedDir}": ${error instanceof Error ? error.message : String(error)}`
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

  private schedulePartialReload(partialName: string, filePath: string): void {
    const timerKey = `partial:${filePath}`;
    const existing = this.debounceTimers.get(timerKey);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(timerKey);
      this.handlePartialChange(partialName, filePath);
    }, this.debounceMs);
    this.debounceTimers.set(timerKey, timer);
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
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[AgentFileWatcher] Error reloading "${filePath}": ${message}`
      );

      if (previousId) {
        this.knownAgentIds.delete(filePath);
      }
      void this.onFileChanged({ filePath, config: null, previousId, error: message });
    }
  }

  private handlePartialChange(partialName: string, filePath: string): void {
    try {
      if (existsSync(filePath)) {
        readFileSync(filePath, 'utf-8');
      }

      void this.onPartialChanged?.(partialName, filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[AgentFileWatcher] Error processing partial "${filePath}": ${message}`);
    }
  }
}
