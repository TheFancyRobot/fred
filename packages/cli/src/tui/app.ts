/**
 * Top-level TUI app wiring
 *
 * Integrates state model, keymap, and layout with OpenTUI renderer.
 * OpenTUI manages alternate screen, raw mode, cursor, and cleanup.
 */

import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  TextAttributes,
  type KeyEvent,
  type CliRenderer,
  type MouseEvent,
} from '@opentui/core';
import type { TuiState, FocusablePaneId } from './state.js';
import {
  createInitialTuiStateWithPlugins,
  applySessionList,
  addSession,
  submitInput,
  appendAssistant,
  appendUserMessage,
  finishStreaming,
  recordStreamingError,
  startStreaming,
  getSelectedCommandPaletteAction,
  setFocusedPane,
  nextFocusablePane,
  prevFocusablePane,
  scrollTranscript,
  selectNextSession,
  selectPreviousSession,
  selectSidebarSelection,
  upsertSessionTranscript,
  openDeleteConfirm,
  closeDeleteConfirm,
  isNewSessionActionSelected,
  shouldOpenStartupChooser,
  openStartupChooser,
  closeStartupChooser,
  setStartupWarning,
} from './state.js';
import { mapKeyToAction, applyKeyAction } from './keymap.js';
import {
  renderSidebarContent,
  renderTranscriptContent,
  renderInputContent,
  selectInputPlaceholder,
  renderStatusContent,
  DEFAULT_LAYOUT,
  type InputPlaceholder,
} from './layout.js';
import {
  createStreamingController,
  type StreamingController,
  type StreamingBatch,
} from './streaming.js';
import {
  loadSessions,
  createSession,
  loadSessionTranscript,
  type SessionServiceDependencies,
  deleteSession,
} from './session.js';
import type { PluginSlashCommandExecutionContext } from '../plugin/api.js';

/**
 * TUI app configuration
 */
export interface TuiAppConfig {
  showStartupHint?: boolean;
  startupWarning?: string | null;
  streamingFrameMs?: number;
  maxRenderQueue?: number;
  sessionService?: SessionServiceDependencies;
  initialSessionId?: string | null;
  pluginSlashCommands?: ReadonlyArray<PluginSlashCommandRuntime>;
}

export interface PluginSlashCommandRuntime {
  pluginId: string;
  commandId: string;
  summary: string;
  usage?: string;
  available: boolean;
  execute: (args: string, context: PluginSlashCommandExecutionContext) => Promise<string | void> | string | void;
}

/**
 * TUI app lifecycle events
 */
export interface TuiAppEvents {
  onStateChange?: (state: TuiState) => void;
  onSubmit?: (text: string, sessionId: string | null) => void;
  onQuit?: () => void;
  onError?: (error: Error) => void;
}

/**
 * TUI app instance backed by OpenTUI
 */
export class FredTuiApp {
  private state: TuiState;
  private renderer: CliRenderer;
  private events: TuiAppEvents;
  private config: TuiAppConfig;
  private running: boolean = false;
  private streamingController: StreamingController;
  private sessionService?: SessionServiceDependencies;
  private pluginSlashRegistry = new Map<string, PluginSlashCommandRuntime>();

  // OpenTUI component references
  private sidebarTitle!: TextRenderable;
  private sidebarItems!: ScrollBoxRenderable;
  private transcriptContent!: ScrollBoxRenderable;
  private inputText!: TextRenderable;
  private statusText!: TextRenderable;
  private sidebarBox!: BoxRenderable;
  private transcriptBox!: BoxRenderable;
  private inputBar!: BoxRenderable;
  private inputPlaceholder: InputPlaceholder;
  private statusThrottleMs = 100;
  private lastStatusRenderMs = 0;
  private lastStatusLine = '';
  private previousStreamingState = false;
  private awaitingStartupResumeSelection = false;

  private static readonly INPUT_TOKEN_COST_USD = 0.0000015;
  private static readonly OUTPUT_TOKEN_COST_USD = 0.000002;

  private constructor(renderer: CliRenderer, events: TuiAppEvents = {}, config: TuiAppConfig = {}) {
    this.state = createInitialTuiStateWithPlugins(
      (config.pluginSlashCommands ?? []).map((command) => ({
        pluginId: command.pluginId,
        commandId: command.commandId,
        summary: command.summary,
        usage: command.usage,
        available: command.available,
      })),
    );
    this.state = setStartupWarning(this.state, config.startupWarning ?? null);
    this.renderer = renderer;
    this.events = events;
    this.config = config;
    this.inputPlaceholder = selectInputPlaceholder();
    this.streamingController = createStreamingController({
      frameMs: config.streamingFrameMs,
      maxRenderQueue: config.maxRenderQueue,
      callbacks: {
        onBatch: (batch) => this.handleStreamingBatch(batch),
        onError: (error) => this.handleStreamError(error),
      },
    });
    this.sessionService = config.sessionService;
    for (const command of config.pluginSlashCommands ?? []) {
      this.pluginSlashRegistry.set(`/${command.pluginId}:${command.commandId}`, command);
    }
  }

  /**
   * Create app with CLI renderer (production)
   */
  static async create(events: TuiAppEvents = {}, config: TuiAppConfig = {}): Promise<FredTuiApp> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      useMouse: true,
    });
    const app = new FredTuiApp(renderer, events, config);
    app.buildComponentTree();
    app.registerKeyboardHandler();
    await app.initializeSessions(config.initialSessionId ?? null);
    app.syncStateToUI();
    app.running = true;
    return app;
  }

  /**
   * Create app with injected renderer (testing)
   */
  static createWithRenderer(
    renderer: CliRenderer,
    events: TuiAppEvents = {},
    config: TuiAppConfig = {},
  ): FredTuiApp {
    const app = new FredTuiApp(renderer, events, config);
    app.buildComponentTree();
    app.registerKeyboardHandler();
    void app.initializeSessions(config.initialSessionId ?? null);
    app.syncStateToUI();
    app.running = true;
    return app;
  }

  private async initializeSessions(initialSessionId: string | null): Promise<void> {
    if (!this.sessionService) {
      return;
    }

    try {
      const items = await loadSessions(this.sessionService);
      this.state = applySessionList(this.state, items, initialSessionId);

      if (shouldOpenStartupChooser(items, initialSessionId)) {
        this.state = openStartupChooser(this.state);
        this.state = setFocusedPane(this.state, 'input');
        this.events.onStateChange?.(this.state);
        return;
      }

      const selectedId = this.state.sessions.selectedId;
      if (selectedId) {
        const messages = await loadSessionTranscript(this.sessionService, selectedId);
        this.state = upsertSessionTranscript(this.state, selectedId, messages, { pinnedToBottom: true });
      }
      this.state = setFocusedPane(this.state, 'input');
      this.events.onStateChange?.(this.state);
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async confirmStartupChooserSelection(): Promise<void> {
    const selected = this.state.startup.chooser.selected;
    this.state = closeStartupChooser(this.state);

    if (!this.sessionService) {
      this.state = setFocusedPane(this.state, 'input');
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      return;
    }

    try {
      if (selected === 'start-new-session') {
        this.awaitingStartupResumeSelection = false;
        const item = await createSession(this.sessionService);
        this.state = addSession(this.state, item, { select: true });
        const messages = await loadSessionTranscript(this.sessionService, item.id);
        this.state = upsertSessionTranscript(this.state, item.id, messages, { pinnedToBottom: true });
      } else {
        this.awaitingStartupResumeSelection = true;
        this.state = setFocusedPane(this.state, 'sidebar');
        this.events.onStateChange?.(this.state);
        this.syncStateToUI();
        return;
      }
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
    }

    this.state = setFocusedPane(this.state, 'input');
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  private async ensureSessionSelected(): Promise<void> {
    if (!this.sessionService) {
      return;
    }
    if (this.state.sessions.selectedId) {
      return;
    }

    try {
      const item = await createSession(this.sessionService);
      this.state = addSession(this.state, item, { select: true });
      const messages = await loadSessionTranscript(this.sessionService, item.id);
      this.state = upsertSessionTranscript(this.state, item.id, messages, { pinnedToBottom: true });
      this.events.onStateChange?.(this.state);
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Build the OpenTUI component tree
   *
   * root (Box, column, 100%x100%)
   * +-- mainArea (Box, row, flexGrow: 1)
   * |   +-- sidebar (Box, width: 30, border: rounded)
   * |   |   +-- sidebarTitle (Text, "[Sessions]")
   * |   |   +-- sidebarItems (ScrollBox, flexGrow: 1)
   * |   +-- transcript (Box, flexGrow: 1, border: rounded)
   * |       +-- transcriptContent (ScrollBox, flexGrow: 1)
   * +-- inputBar (Box, height: 3, border: single)
   * |   +-- prompt (Text, "> ")
   * |   +-- inputText (Text, flexGrow: 1)
   * +-- statusBar (Box, height: 1, inverse bg)
   *     +-- statusText (Text)
   */
  private buildComponentTree(): void {
    const r = this.renderer;

    // Root container
    const root = new BoxRenderable(r, {
      id: 'root',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
    });

    // Main area (sidebar + transcript)
    const mainArea = new BoxRenderable(r, {
      id: 'main-area',
      flexDirection: 'row',
      flexGrow: 1,
    });

    // Sidebar
    this.sidebarBox = new BoxRenderable(r, {
      id: 'sidebar',
      width: DEFAULT_LAYOUT.sidebarWidth,
      border: true,
      borderStyle: 'rounded',
      flexDirection: 'column',
    });

    this.sidebarTitle = new TextRenderable(r, {
      id: 'sidebar-title',
      content: '[Sessions]',
      attributes: TextAttributes.BOLD,
      fg: '#00FFFF',
    });

    this.sidebarItems = new ScrollBoxRenderable(r, {
      id: 'sidebar-items',
      flexGrow: 1,
      verticalScrollbarOptions: { visible: false },
      horizontalScrollbarOptions: { visible: false },
    });
    this.sidebarItems.selectable = false;

    this.sidebarBox.add(this.sidebarTitle);
    this.sidebarBox.add(this.sidebarItems);

    // Transcript
    this.transcriptBox = new BoxRenderable(r, {
      id: 'transcript',
      flexGrow: 1,
      border: true,
      borderStyle: 'rounded',
      flexDirection: 'column',
      onMouseScroll: (event) => this.handleTranscriptMouseScroll(event),
    });

    this.transcriptContent = new ScrollBoxRenderable(r, {
      id: 'transcript-content',
      flexGrow: 1,
      onMouseScroll: (event) => this.handleTranscriptMouseScroll(event),
      verticalScrollbarOptions: { visible: false },
      horizontalScrollbarOptions: { visible: false },
    });
    this.transcriptContent.selectable = true;

    this.transcriptBox.add(this.transcriptContent);

    mainArea.add(this.sidebarBox);
    mainArea.add(this.transcriptBox);

    // Input bar
    this.inputBar = new BoxRenderable(r, {
      id: 'input-bar',
      height: DEFAULT_LAYOUT.inputHeight,
      border: true,
      borderStyle: 'single',
      flexDirection: 'column',
    });

    this.inputText = new TextRenderable(r, {
      id: 'input-text',
      content: '',
      flexGrow: 1,
    });
    this.inputText.selectable = false;

    this.inputBar.add(this.inputText);

    // Status bar
    const statusBar = new BoxRenderable(r, {
      id: 'status-bar',
      height: DEFAULT_LAYOUT.statusHeight,
      backgroundColor: '#444444',
    });

    this.statusText = new TextRenderable(r, {
      id: 'status-text',
      content: '',
      attributes: TextAttributes.INVERSE,
    });
    this.statusText.selectable = false;

    statusBar.add(this.statusText);

    // Compose tree
    root.add(mainArea);
    root.add(this.inputBar);
    root.add(statusBar);

    r.root.add(root);
  }

  /**
   * Register keyboard handler on the renderer
   */
  private registerKeyboardHandler(): void {
    this.renderer.keyInput.on('keypress', (key: KeyEvent) => {
      if (!this.running) return;
      this.processKey(key);
    });
  }

  /**
   * Process a key event through the state machine
   */
  processKey(key: KeyEvent): void {
    if (this.state.focusedPane === 'input' && !this.state.commandPalette.isOpen && key.ctrl && key.name === 'u') {
      this.state = {
        ...this.state,
        input: {
          ...this.state.input,
          text: '',
          cursorPosition: 0,
          history: {
            ...this.state.input.history,
            currentIndex: -1,
          },
        },
      };
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      return;
    }

    const action = mapKeyToAction(key, this.state);

    if (action.type === 'quit') {
      this.stop();
      return;
    }

    if (action.type === 'palette-submit') {
      this.executeSelectedCommandPaletteAction();
      return;
    }

    if (action.type === 'submit') {
      this.submitCurrentInput();
      return;
    }

    if (action.type === 'confirm-delete-session') {
      void this.confirmDeleteSession();
      return;
    }

    if (action.type === 'cancel-delete-session') {
      this.state = closeDeleteConfirm(this.state);
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      return;
    }

    if (action.type === 'copy-transcript') {
      this.copyTranscriptToClipboard();
      return;
    }

    if (action.type === 'session-select') {
      if (isNewSessionActionSelected(this.state)) {
        if (this.awaitingStartupResumeSelection) {
          void this.handleCreateSession({ focusInputAfterCreate: true });
        } else {
          void this.handleCreateSession();
        }
        return;
      }
      this.state = selectSidebarSelection(this.state);
      if (this.awaitingStartupResumeSelection) {
        this.events.onStateChange?.(this.state);
        this.syncStateToUI();
        void this.confirmStartupSidebarSelection();
        return;
      }
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      return;
    }

    if (action.type === 'startup-chooser-confirm') {
      void this.confirmStartupChooserSelection();
      return;
    }

    if (action.type === 'delete-session') {
      const selectedId = this.state.sessions.selectedId;
      if (selectedId) {
        this.state = openDeleteConfirm(this.state, selectedId);
        this.events.onStateChange?.(this.state);
        this.syncStateToUI();
      }
      return;
    }

    const newState = applyKeyAction(this.state, action);
    this.state = newState;
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  startAssistantStream(nowMs = Date.now()): void {
    this.state = startStreaming(this.state, nowMs);
    this.streamingController.start();
    this.refreshSessionCost(true);
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  pushAssistantToken(token: string, tokenCount = 1): void {
    this.streamingController.pushToken(token, tokenCount);
  }

  completeAssistantStream(nowMs = Date.now()): void {
    this.streamingController.finish();
    this.finalizeStreamingTelemetry();
    this.state = finishStreaming(this.state, nowMs);
    this.refreshSessionCost(false);
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  failAssistantStream(error: unknown, nowMs = Date.now()): void {
    this.streamingController.fail(error);
    const message = error instanceof Error ? error.message : String(error);
    this.finalizeStreamingTelemetry();
    this.state = recordStreamingError(this.state, message, nowMs);
    this.refreshSessionCost(false);
    this.events.onError?.(error instanceof Error ? error : new Error(message));
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  updateTelemetryModel(model: string, provider: string): void {
    this.state = {
      ...this.state,
      telemetry: {
        ...this.state.telemetry,
        model,
        provider,
      },
    };
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  private handleStreamingBatch(batch: StreamingBatch): void {
    this.state = appendAssistant(this.state, batch.text, batch.tokenCount);
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  private handleStreamError(error: Error): void {
    this.finalizeStreamingTelemetry();
    this.state = recordStreamingError(this.state, error.message);
    this.refreshSessionCost(false);
    this.events.onError?.(error);
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  private submitCurrentInput(): void {
    const { state: clearedState, submittedText } = submitInput(this.state);
    this.state = clearedState;
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
    if (!submittedText.trim()) {
      return;
    }

    this.state = appendUserMessage(this.state, submittedText);

    const slashInvocation = this.parseSlashInvocation(submittedText);
    if (slashInvocation) {
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      void this.executePluginSlashCommand(slashInvocation.canonicalName, slashInvocation.args);
      return;
    }

    this.state = {
      ...this.state,
      telemetry: {
        ...this.state.telemetry,
        inputTokenCount: this.state.telemetry.inputTokenCount + this.estimateTokenCount(submittedText),
      },
    };

    if (!this.state.streaming.isStreaming) {
      this.state = startStreaming(this.state);
      this.streamingController.start();
    }

    this.refreshSessionCost(true);
    this.events.onStateChange?.(this.state);
    this.events.onSubmit?.(submittedText, this.state.sessions.selectedId);
    this.syncStateToUI();

    if (this.state.sessions.selectedId === null) {
      void this.ensureSessionSelected();
    }
  }

  private executeSelectedCommandPaletteAction(): void {
    const selectedAction = getSelectedCommandPaletteAction(this.state);
    this.state = {
      ...this.state,
      commandPalette: {
        ...this.state.commandPalette,
        isOpen: false,
        query: '',
        selectedIndex: 0,
      },
    };

    if (!selectedAction) {
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      return;
    }

    if (selectedAction.kind === 'plugin-slash' && selectedAction.plugin) {
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      void this.executePluginSlashCommand(selectedAction.plugin.canonicalName, '');
      return;
    }

    switch (selectedAction.id) {
      case 'focus-next-pane':
        this.state = setFocusedPane(this.state, nextFocusablePane(this.state.focusedPane));
        break;
      case 'focus-previous-pane':
        this.state = setFocusedPane(this.state, prevFocusablePane(this.state.focusedPane));
        break;
      case 'jump-sidebar-pane':
        this.state = setFocusedPane(this.state, 'sidebar');
        break;
      case 'jump-transcript-pane':
        this.state = setFocusedPane(this.state, 'transcript');
        break;
      case 'jump-input-pane':
        this.state = setFocusedPane(this.state, 'input');
        break;
      case 'scroll-transcript-up':
        this.state = scrollTranscript(this.state, -1);
        break;
      case 'scroll-transcript-down':
        this.state = scrollTranscript(this.state, 1);
        break;
      case 'clear-input':
        this.state = {
          ...this.state,
          input: {
            ...this.state.input,
            text: '',
            cursorPosition: 0,
          },
        };
        break;
      case 'submit-input':
        this.submitCurrentInput();
        return;
      case 'select-next-session':
        this.state = selectNextSession(this.state);
        break;
      case 'select-previous-session':
        this.state = selectPreviousSession(this.state);
        break;
      case 'create-session':
        void this.handleCreateSession();
        return;
      case 'delete-session':
        this.state = openDeleteConfirm(this.state, this.state.sessions.selectedId);
        break;
      default:
        break;
    }

    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  private parseSlashInvocation(text: string): { canonicalName: string; args: string } | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) {
      return null;
    }

    const [commandToken] = trimmed.split(/\s+/, 1);
    if (!commandToken.includes(':')) {
      return null;
    }

    const args = trimmed.slice(commandToken.length).trimStart();
    return {
      canonicalName: commandToken,
      args,
    };
  }

  private async executePluginSlashCommand(canonicalName: string, args: string): Promise<void> {
    const command = this.pluginSlashRegistry.get(canonicalName);
    if (!command || !command.available) {
      this.state = appendAssistant(
        this.state,
        `[plugin slash] unavailable command: ${canonicalName}`,
        1,
      );
      this.state = recordStreamingError(this.state, `[plugin slash] unavailable command: ${canonicalName}`);
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      return;
    }

    try {
      const output = await command.execute(args, {
        cwd: process.cwd(),
        sessionId: this.state.sessions.selectedId ?? undefined,
      });
      this.state = appendAssistant(
        this.state,
        typeof output === 'string' && output.length > 0
          ? output
          : `[plugin:${command.pluginId}] ${canonicalName} completed`,
        1,
      );
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      // Sanitize: take only the first line and cap length to avoid leaking stack traces or internal paths
      const sanitized = rawMessage.split('\n')[0].slice(0, 200);
      const userFacing = `[plugin:${command.pluginId}] ${canonicalName} failed: ${sanitized}`;
      this.state = appendAssistant(this.state, userFacing, 1);
      this.state = recordStreamingError(this.state, userFacing);
      // Full error details forwarded to onError for internal logging/debugging
      this.events.onError?.(error instanceof Error ? error : new Error(rawMessage));
    }

    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  private estimateTokenCount(text: string): number {
    const normalized = text.trim();
    if (!normalized) {
      return 0;
    }

    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    return Math.max(1, wordCount);
  }

  private async handleCreateSessionWithOptions(options: { focusInputAfterCreate: boolean }): Promise<void> {
    if (!this.sessionService) {
      return;
    }

    try {
      const item = await createSession(this.sessionService);
      this.state = addSession(this.state, item, { select: true });
      const messages = await loadSessionTranscript(this.sessionService, item.id);
      this.state = upsertSessionTranscript(this.state, item.id, messages, { pinnedToBottom: true });
      this.awaitingStartupResumeSelection = false;
      if (options.focusInputAfterCreate) {
        this.state = setFocusedPane(this.state, 'input');
      }
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async handleCreateSession(options?: { focusInputAfterCreate?: boolean }): Promise<void> {
    return this.handleCreateSessionWithOptions({ focusInputAfterCreate: options?.focusInputAfterCreate ?? false });
  }

  private async confirmStartupSidebarSelection(): Promise<void> {
    const selectedId = this.state.sessions.selectedId;
    this.awaitingStartupResumeSelection = false;

    if (!selectedId || !this.sessionService) {
      this.state = setFocusedPane(this.state, 'input');
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      return;
    }

    try {
      const messages = await loadSessionTranscript(this.sessionService, selectedId);
      this.state = upsertSessionTranscript(this.state, selectedId, messages, { pinnedToBottom: true });
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
    }

    this.state = setFocusedPane(this.state, 'input');
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  private async confirmDeleteSession(): Promise<void> {
    if (!this.sessionService) {
      return;
    }
    const sessionId = this.state.deleteConfirm.sessionId;
    if (!sessionId) {
      this.state = closeDeleteConfirm(this.state);
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      return;
    }

    try {
      this.state = await deleteSession(this.sessionService, this.state, sessionId);
      this.state = closeDeleteConfirm(this.state);
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private finalizeStreamingTelemetry(): void {
    if (this.state.streaming.outputTokenCount <= 0) {
      return;
    }

    this.state = {
      ...this.state,
      telemetry: {
        ...this.state.telemetry,
        outputTokenCount: this.state.telemetry.outputTokenCount + this.state.streaming.outputTokenCount,
      },
    };
  }

  private refreshSessionCost(includeActiveStream: boolean): void {
    const activeOutput = includeActiveStream ? this.state.streaming.outputTokenCount : 0;
    const totalOutput = this.state.telemetry.outputTokenCount + activeOutput;
    const sessionCostUsd =
      (this.state.telemetry.inputTokenCount * FredTuiApp.INPUT_TOKEN_COST_USD)
      + (totalOutput * FredTuiApp.OUTPUT_TOKEN_COST_USD);

    this.state = {
      ...this.state,
      telemetry: {
        ...this.state.telemetry,
        sessionCostUsd,
      },
    };
  }

  private getRendererWidth(): number {
    const candidate = (this.renderer as unknown as { width?: number; terminal?: { width?: number } }).width
      ?? (this.renderer as unknown as { terminal?: { width?: number } }).terminal?.width
      ?? 120;
    return typeof candidate === 'number' && candidate > 0 ? candidate : 120;
  }

  private getRendererHeight(): number {
    const candidate = (this.renderer as unknown as { height?: number; terminal?: { height?: number } }).height
      ?? (this.renderer as unknown as { terminal?: { height?: number } }).terminal?.height
      ?? 40;
    return typeof candidate === 'number' && candidate > 0 ? candidate : 40;
  }

  private getTranscriptPlainText(): string {
    if (this.state.transcript.messages.length === 0) {
      return '';
    }

    return this.state.transcript.messages
      .map((message) => `${message.role}:\n${message.content}`)
      .join('\n\n');
  }

  private copyTranscriptToClipboard(): void {
    const text = this.getTranscriptPlainText();
    if (!text) {
      return;
    }

    this.renderer.copyToClipboardOSC52(text);
  }

  /**
   * Push current state to OpenTUI renderables
   */
  private syncStateToUI(): void {
    const r = this.renderer;

    // Input text (calculate first so transcript viewport can account for dynamic composer height)
    const inputData = renderInputContent(
      this.state,
      this.state.focusedPane === 'input',
      this.inputPlaceholder,
    );
    this.inputBar.height = inputData.height;

    const rendererHeight = this.getRendererHeight();
    const transcriptVisibleLines = Math.max(
      3,
      rendererHeight - inputData.height - DEFAULT_LAYOUT.statusHeight - 2,
    );
    if (this.state.transcript.viewport.visibleLines !== transcriptVisibleLines) {
      this.state = {
        ...this.state,
        transcript: {
          ...this.state.transcript,
          viewport: {
            ...this.state.transcript.viewport,
            visibleLines: transcriptVisibleLines,
          },
        },
      };
    }

    // Sidebar content
    const sidebarContent = renderSidebarContent(
      this.state,
      this.state.focusedPane === 'sidebar'
    );
    const sidebarHeader = sidebarContent.lines[0] ?? '[Sessions]';

    const itemLines = sidebarContent.lines.slice(1);
    this.repopulateScrollBox(this.sidebarItems, itemLines, (line, i) => {
      const text = new TextRenderable(r, {
        id: `sidebar-item-${i}`,
        content: line,
        fg: this.state.focusedPane === 'sidebar' ? '#FFFFFF' : '#888888',
      });
      text.selectable = false;
      return text;
    });

    // Sidebar title styling based on focus
    this.sidebarTitle = this.rebuildText(
      this.sidebarTitle,
      'sidebar-title',
      sidebarHeader,
      this.state.focusedPane === 'sidebar' ? '#00FFFF' : '#888888',
      TextAttributes.BOLD,
    );

    // Transcript content
    const transcriptData = renderTranscriptContent(
      this.state,
      this.state.focusedPane === 'transcript',
      {
        maxWidth: Math.max(20, this.getRendererWidth() - DEFAULT_LAYOUT.sidebarWidth - 8),
      },
    );

    if (
      this.state.transcript.viewport.totalLines !== transcriptData.totalLines
      || this.state.transcript.viewport.scrollOffset !== transcriptData.scrollOffset
      || this.state.transcript.viewport.pinnedToBottom !== transcriptData.pinnedToBottom
    ) {
      this.state = {
        ...this.state,
        transcript: {
          ...this.state.transcript,
          viewport: {
            ...this.state.transcript.viewport,
            totalLines: transcriptData.totalLines,
            scrollOffset: transcriptData.scrollOffset,
            pinnedToBottom: transcriptData.pinnedToBottom,
          },
        },
      };
    }

    this.repopulateScrollBox(this.transcriptContent, transcriptData.lines, (line, i) => {
      const isRoleLabel = line.endsWith(':') && (line === 'user:' || line === 'assistant:');
      const isStartupChooserLine = this.state.startup.chooser.isOpen;
      const isStartupHeader = isStartupChooserLine && i === 0;
      const isStartupWarning = isStartupChooserLine && line.startsWith('warning:');
      const isStartupSelectedOption = isStartupChooserLine && line.startsWith('>> ');
      const isStartupInstruction = isStartupChooserLine && line.startsWith('Use Up/Down');

      let fg = isRoleLabel
        ? '#00FFFF'
        : (this.state.focusedPane === 'transcript' ? '#FFFFFF' : '#CCCCCC');
      let attributes = isRoleLabel ? TextAttributes.BOLD : 0;

      if (isStartupHeader) {
        fg = '#FFD166';
        attributes = TextAttributes.BOLD;
      } else if (isStartupSelectedOption) {
        fg = '#7CE38B';
        attributes = TextAttributes.BOLD;
      } else if (isStartupWarning) {
        fg = '#FF9E64';
      } else if (isStartupInstruction) {
        fg = '#FFD166';
      }

      const text = new TextRenderable(r, {
        id: `transcript-line-${i}`,
        content: line,
        fg,
        attributes,
      });
      text.selectable = true;
      return text;
    });

    this.inputText.destroy();
    this.inputText = new TextRenderable(r, {
      id: 'input-text',
      content: inputData.lines.join('\n'),
      flexGrow: 1,
      fg: this.state.input.text ? '#FFFFFF' : '#666666',
    });
    this.inputText.selectable = false;
    this.inputBar.add(this.inputText);

    // Status bar
    const nowMs = Date.now();
    const shouldThrottleStatus = this.state.streaming.isStreaming;
    const streamingTransitioned = this.state.streaming.isStreaming !== this.previousStreamingState;
    const shouldRenderFreshStatus = !shouldThrottleStatus
      || streamingTransitioned
      || this.lastStatusLine.length === 0
      || (nowMs - this.lastStatusRenderMs) >= this.statusThrottleMs;

    if (shouldRenderFreshStatus) {
      const statusState = this.state.streaming.isStreaming
        ? this.state
        : {
            ...this.state,
            streaming: {
              ...this.state.streaming,
              outputTokenCount: 0,
            },
          };

      const statusData = renderStatusContent(statusState, {
        maxWidth: Math.max(40, this.getRendererWidth() - 4),
        nowMs,
      });
      this.lastStatusLine = statusData.lines[0] ?? '';
      this.lastStatusRenderMs = nowMs;
    }
    this.previousStreamingState = this.state.streaming.isStreaming;

    const statusFg = this.state.streaming.lastError
      ? '#ff6b6b'
      : this.state.streaming.isStreaming
        ? '#5dade2'
        : '#7bd88f';

    this.statusText.destroy();
    this.statusText = new TextRenderable(r, {
      id: 'status-text',
      content: ` ${this.lastStatusLine} `,
      attributes: TextAttributes.INVERSE,
      fg: statusFg,
    });
    this.statusText.selectable = false;
    const statusBar = r.root.getRenderable('root')?.getRenderable('status-bar');
    if (statusBar) {
      statusBar.add(this.statusText);
    }

    // Border highlighting for focused pane
    this.updateBorderFocus();
  }

  /**
   * Helper: rebuild a TextRenderable in place
   */
  private rebuildText(
    existing: TextRenderable,
    id: string,
    content: string,
    fg: string,
    attributes: number,
  ): TextRenderable {
    existing.destroy();
    const newText = new TextRenderable(this.renderer, {
      id,
      content,
      fg,
      attributes,
    });
    newText.selectable = false;
    this.sidebarBox.add(newText);
    return newText;
  }

  private repopulateScrollBox(
    scrollBox: ScrollBoxRenderable,
    lines: string[],
    renderLine: (line: string, index: number) => TextRenderable,
  ): void {
    const children = scrollBox.getChildren();
    for (const child of children) {
      scrollBox.remove(child.id);
    }

    for (let i = 0; i < lines.length; i += 1) {
      scrollBox.add(renderLine(lines[i], i));
    }
  }

  private handleTranscriptMouseScroll(event: MouseEvent): void {
    const direction = event.scroll?.direction;
    if (!direction) {
      return;
    }

    const delta = event.scroll?.delta ?? 1;
    const lines = Math.max(1, Math.round(delta));

    if (direction === 'up') {
      this.state = scrollTranscript(this.state, -lines);
    } else if (direction === 'down') {
      this.state = scrollTranscript(this.state, lines);
    } else {
      return;
    }

    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  /**
   * Update border colors to indicate focus
   */
  private updateBorderFocus(): void {
    const focusColor = '#7aa2f7';
    const dimColor = '#444444';

    // We can't dynamically change border color on BoxRenderable after creation
    // without rebuilding, so we rely on the content styling to indicate focus.
    // The title/text color changes above provide visual focus indication.
  }

  /**
   * Get current state (for testing)
   */
  getState(): TuiState {
    return this.state;
  }

  /**
   * Get the renderer (for testing)
   */
  getRenderer(): CliRenderer {
    return this.renderer;
  }

  /**
   * Stop the TUI app and restore terminal
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.streamingController.stop();
    this.renderer.destroy();
    this.events.onQuit?.();
  }

  /**
   * Check if app is running
   */
  isRunning(): boolean {
    return this.running;
  }
}

/**
 * Create and start TUI app (convenience function)
 */
export async function createFredTuiApp(
  events?: TuiAppEvents,
  config?: TuiAppConfig,
): Promise<FredTuiApp> {
  return FredTuiApp.create(events, config);
}
