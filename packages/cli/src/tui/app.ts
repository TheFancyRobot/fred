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
  CodeRenderable,
  SyntaxStyle,
  TextAttributes,
  MacOSScrollAccel,
  type KeyEvent,
  type PasteEvent,
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
  toggleSidebarVisibility,
  addToolCall,
  completeToolCall,
  clearStreamingAssistant,
  failToolCall,
  hasInProgressToolBlocks,
  getToolBlocksForMessage,
  queuePendingSubmission,
  dequeuePendingSubmission,
  hasPendingSubmissions,
  setSystemNotice,
} from './state.js';
import { mapKeyToAction, applyKeyAction } from './keymap.js';
import {
  renderSidebarContent,
  renderTranscriptContent,
  renderInputContent,
  selectInputPlaceholder,
  renderStatusContent,
  getTranscriptMessages,
  buildUserMessageRenderable,
  buildAssistantMessageRenderable,
  buildThinkingRenderable,
  getSpinnerFrame,
  getToolBlockSummaryPresentation,
  THINKING_SPINNER_ID_PREFIX,
  buildStreamingCursorText,
  buildToolGroupRenderable,
  sortToolBlocksByParent,
  buildSystemNoticeRenderable,
  sanitizeForTerminalDisplay,
  DEFAULT_LAYOUT,
  type InputPlaceholder,
} from './layout.js';
import { DEFAULT_TUI_THEME, getMarkdownSyntaxTheme } from './theme.js';
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
import { sanitizeErrorForCli } from '../commands/error-sanitize.js';

/**
 * TUI app configuration
 */
export interface TuiAppConfig {
  showStartupHint?: boolean;
  startupWarning?: string | null;
  streamingFrameMs?: number;
  streamingFlushStrategy?: 'frame' | 'token';
  maxRenderQueue?: number;
  sessionService?: SessionServiceDependencies;
  initialSessionId?: string | null;
  pluginSlashCommands?: ReadonlyArray<PluginSlashCommandRuntime>;

  /**
   * How to handle stream timeouts when waiting for the first token.
   * - 'fail' (default): Show error and abort after STREAM_TIMEOUT_MS
   * - 'patient': Suppress error, keep streaming, optionally show messages
   */
  streamTimeoutMode?: 'fail' | 'patient';

  /**
   * Message(s) to display while waiting in patient mode. Only used when
   * streamTimeoutMode is 'patient'.
   *
   * - string: show the same message on every tick
   * - string[]: rotate through messages in order, cycling back to start
   * - () => string: call on each tick, display the return value
   * - undefined: no message, just silently keep waiting
   */
  patienceMessage?: string | readonly string[] | (() => string);

  /**
   * Interval in milliseconds between patience messages (default: 15000).
   * Only used when streamTimeoutMode is 'patient'.
   */
  patienceIntervalMs?: number;
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
  private sidebarFooter!: TextRenderable;
  private sidebarItems!: ScrollBoxRenderable;
  private transcriptContent!: ScrollBoxRenderable;
  private inputText!: TextRenderable;
  private statusText!: TextRenderable;
  private statusBar!: BoxRenderable;
  private sidebarBox!: BoxRenderable;
  private transcriptBox!: BoxRenderable;
  private inputBar!: BoxRenderable;
  private inputPlaceholder: InputPlaceholder;

  // Overlay component references
  private slashOverlay!: BoxRenderable;
  private slashOverlayText!: TextRenderable;
  private helpOverlay!: BoxRenderable;
  private helpOverlayText!: TextRenderable;

  private awaitingStartupResumeSelection = false;

  // Renderable-based transcript state
  private syntaxStyle: SyntaxStyle | null = null;
  private streamingSyntaxStyle: SyntaxStyle | null = null;
  private activeStreamingMdId: string | null = null;
  private lastRenderedMessageCount = 0;
  private lastTranscriptFingerprint: string = '';

  // Tool block spinner animation timer
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;

  // Cursor blink timer
  private cursorBlinkInterval: ReturnType<typeof setInterval> | null = null;
  private cursorVisible = true;

  // Stream timeout timer (fires if no tokens arrive within 30s)
  private streamTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly STREAM_TIMEOUT_MS = 30_000;
  private static readonly DEFAULT_PATIENCE_INTERVAL_MS = 15_000;

  // Patient timeout mode config
  private streamTimeoutMode: 'fail' | 'patient';
  private patienceMessage?: string | readonly string[] | (() => string);
  private patienceIntervalMs?: number;
  private patienceTickIndex = 0;

  // Thinking spinner — absolutely positioned at top-right of user message
  private thinkingSpinnerId: string | null = null;

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
      flushStrategy: config.streamingFlushStrategy,
      maxRenderQueue: config.maxRenderQueue,
      callbacks: {
        onBatch: (batch) => this.handleStreamingBatch(batch),
        onError: (error) => this.handleStreamError(error),
      },
    });
    this.sessionService = config.sessionService;
    this.streamTimeoutMode = config.streamTimeoutMode ?? 'fail';
    this.patienceMessage = config.patienceMessage;
    this.patienceIntervalMs = config.patienceIntervalMs;
    this.syntaxStyle = SyntaxStyle.fromTheme(getMarkdownSyntaxTheme(DEFAULT_TUI_THEME));
    this.streamingSyntaxStyle = this.syntaxStyle;
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

      // No previous sessions and no initialSessionId -- auto-create a session
      if (items.length === 0 && !initialSessionId) {
        const item = await createSession(this.sessionService);
        this.state = addSession(this.state, item, { select: true });
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
        // Load transcript for the already-selected first session
        void this.loadSelectedSessionTranscript(null);
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
      // Capture existing transcript messages before session creation so
      // messages from an in-flight stream are not discarded.
      const existingMessages = [...this.state.transcript.messages];
      const item = await createSession(this.sessionService);
      this.state = addSession(this.state, item, { select: true });

      // Bind an active stream (started before the session existed) to the new session
      if (this.state.streaming.isStreaming && this.state.streaming.sessionId === null) {
        this.state = {
          ...this.state,
          streaming: { ...this.state.streaming, sessionId: item.id },
        };
      }

      const storedMessages = await loadSessionTranscript(this.sessionService, item.id);
      // Merge: stored messages (empty for a brand-new session) + existing
      // transcript messages that were accumulated before the session existed.
      const merged = storedMessages.length > 0 ? storedMessages : existingMessages;
      this.state = upsertSessionTranscript(this.state, item.id, merged, { pinnedToBottom: true });
      this.events.onStateChange?.(this.state);
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Build the OpenTUI component tree
   *
   * root (Box, row, 100%x100%, bg: base, padding: outerPadding, gap: regionGap)
   * +-- sidebar (Box, width: 30, bg: elevated, padding: 1, height: 100%)
   * |   +-- sidebarTitle (Text, "[Sessions]")
   * |   +-- sidebarItems (ScrollBox, flexGrow: 1)
   * |   +-- sidebarFooter (Text)
   * +-- mainColumn (Box, column, flexGrow: 1, height: 100%, gap: regionGap)
   *     +-- transcript (Box, flexGrow: 1, bg: surface, padding: 1)
   *     |   +-- transcriptContent (ScrollBox, flexGrow: 1)
   *     +-- inputBar (Box, height: 3, bg: elevated, padding: 1)
   *     |   +-- inputText (Text, flexGrow: 1)
   *     +-- statusBar (Box, height: 1, bg: status)
   *         +-- statusText (Text)
   */
  private buildComponentTree(): void {
    const r = this.renderer;
    const theme = DEFAULT_TUI_THEME;

    // Root container
    const root = new BoxRenderable(r, {
      id: 'root',
      width: '100%',
      height: '100%',
      flexDirection: 'row',
      backgroundColor: theme.bg.base,
      padding: DEFAULT_LAYOUT.outerPadding,
      gap: DEFAULT_LAYOUT.regionGap,
    });

    // Main column (transcript + input + status)
    const mainColumn = new BoxRenderable(r, {
      id: 'main-column',
      flexDirection: 'column',
      flexGrow: 1,
      height: '100%',
      gap: DEFAULT_LAYOUT.regionGap,
    });

    // Sidebar
    this.sidebarBox = new BoxRenderable(r, {
      id: 'sidebar',
      width: DEFAULT_LAYOUT.sidebarWidth,
      height: '100%',
      flexDirection: 'column',
      backgroundColor: theme.bg.elevated,
      padding: 1,
    });

    this.sidebarTitle = new TextRenderable(r, {
      id: 'sidebar-title',
      content: '[Sessions]',
      attributes: TextAttributes.BOLD,
      fg: theme.accent.primary,
    });
    this.sidebarTitle.selectable = false;

    this.sidebarItems = new ScrollBoxRenderable(r, {
      id: 'sidebar-items',
      flexGrow: 1,
      verticalScrollbarOptions: { visible: false },
      horizontalScrollbarOptions: { visible: false },
    });
    this.sidebarItems.selectable = false;

    this.sidebarFooter = new TextRenderable(r, {
      id: 'sidebar-footer',
      content: '',
      fg: theme.fg.dim,
    });
    this.sidebarFooter.selectable = false;

    this.sidebarBox.add(this.sidebarTitle);
    this.sidebarBox.add(this.sidebarItems);
    this.sidebarBox.add(this.sidebarFooter);

    // Transcript
    this.transcriptBox = new BoxRenderable(r, {
      id: 'transcript',
      flexGrow: 1,
      flexDirection: 'column',
      backgroundColor: theme.bg.surface,
      padding: 1,
      onMouseScroll: (event) => this.handleTranscriptMouseScroll(event),
    });

    this.transcriptContent = new ScrollBoxRenderable(r, {
      id: 'transcript-content',
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: 'bottom',
      scrollAcceleration: new MacOSScrollAccel(),
      onMouseScroll: (event) => this.handleTranscriptMouseScroll(event),
      verticalScrollbarOptions: { visible: false },
      horizontalScrollbarOptions: { visible: false },
    });
    this.transcriptContent.selectable = true;

    this.transcriptBox.add(this.transcriptContent);

    mainColumn.add(this.transcriptBox);

    // Input bar
    this.inputBar = new BoxRenderable(r, {
      id: 'input-bar',
      height: DEFAULT_LAYOUT.inputHeight,
      flexDirection: 'column',
      backgroundColor: theme.bg.elevated,
      padding: 1,
    });

    this.inputText = new TextRenderable(r, {
      id: 'input-text',
      content: '',
      flexGrow: 1,
    });
    this.inputText.selectable = false;

    this.inputBar.add(this.inputText);

    // Status bar
    this.statusBar = new BoxRenderable(r, {
      id: 'status-bar',
      height: DEFAULT_LAYOUT.statusHeight,
      backgroundColor: theme.bg.status,
    });

    this.statusText = new TextRenderable(r, {
      id: 'status-text',
      content: '',
      fg: theme.fg.secondary,
    });
    this.statusText.selectable = false;

    this.statusBar.add(this.statusText);

    // Compose tree
    mainColumn.add(this.inputBar);
    mainColumn.add(this.statusBar);
    root.add(this.sidebarBox);
    root.add(mainColumn);

    // Slash autocomplete overlay (positioned above input bar)
    this.slashOverlay = new BoxRenderable(r, {
      id: 'slash-overlay',
      position: 'absolute',
      bottom: DEFAULT_LAYOUT.statusHeight + DEFAULT_LAYOUT.inputHeight,
      left: DEFAULT_LAYOUT.sidebarWidth + DEFAULT_LAYOUT.outerPadding + 1,
      width: 40,
      maxHeight: 8,
      flexDirection: 'column',
      backgroundColor: theme.bg.elevated,
      padding: 1,
    });
    this.slashOverlay.visible = false;
    this.slashOverlay.zIndex = 10;

    this.slashOverlayText = new TextRenderable(r, {
      id: 'slash-overlay-text',
      content: '',
      fg: theme.fg.primary,
    });
    this.slashOverlayText.selectable = false;
    this.slashOverlay.add(this.slashOverlayText);

    // Help modal overlay (centered over transcript)
    this.helpOverlay = new BoxRenderable(r, {
      id: 'help-overlay',
      position: 'absolute',
      top: 3,
      left: DEFAULT_LAYOUT.sidebarWidth + DEFAULT_LAYOUT.outerPadding + 4,
      width: 50,
      flexDirection: 'column',
      backgroundColor: theme.bg.elevated,
      padding: 1,
    });
    this.helpOverlay.visible = false;
    this.helpOverlay.zIndex = 20;

    this.helpOverlayText = new TextRenderable(r, {
      id: 'help-overlay-text',
      content: '',
      fg: theme.fg.primary,
    });
    this.helpOverlayText.selectable = false;
    this.helpOverlay.add(this.helpOverlayText);

    root.add(this.slashOverlay);
    root.add(this.helpOverlay);

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

    this.renderer.keyInput.on('paste', (event: PasteEvent) => {
      if (!this.running) return;
      if (this.state.helpModal.isOpen) return;
      if (this.state.focusedPane !== 'input') return;
      if (this.state.commandPalette.isOpen) return;

      // Insert pasted text at cursor position (flatten newlines for single-line input)
      // Cap paste length to prevent resource exhaustion from extremely large pastes
      const MAX_PASTE_LENGTH = 100_000;
      const text = event.text
        .slice(0, MAX_PASTE_LENGTH)
        .replace(/\n/g, ' ')
        // Strip control chars except tab/carriage return to prevent terminal control abuse.
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
      const before = this.state.input.text.slice(0, this.state.input.cursorPosition);
      const after = this.state.input.text.slice(this.state.input.cursorPosition);
      this.state = {
        ...this.state,
        input: {
          ...this.state.input,
          text: before + text + after,
          cursorPosition: this.state.input.cursorPosition + text.length,
        },
      };
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
    });
  }

  /**
   * Process a key event through the state machine
   */
  processKey(key: KeyEvent): void {
    if (this.state.helpModal.isOpen && key.name !== 'escape' && key.name !== 'f1') {
      return;
    }
    const previousSelectedId = this.state.sessions.selectedId;

    // Reset cursor blink on every key press so cursor stays visible while typing
    if (this.state.focusedPane === 'input') {
      this.resetCursorBlink();
    }

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
      void this.loadSelectedSessionTranscript(previousSelectedId);
      return;
    }

    if (action.type === 'copy-transcript') {
      this.copyTranscriptToClipboard();
      return;
    }

    if (action.type === 'copy-last-message') {
      this.copyLastAssistantMessage();
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
      void this.loadSelectedSessionTranscript(previousSelectedId);
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
    if (action.type === 'session-next' || action.type === 'session-prev') {
      void this.loadSelectedSessionTranscript(previousSelectedId);
    }
  }

  startAssistantStream(nowMs = Date.now()): void {
    this.state = startStreaming(this.state, nowMs);
    this.streamingController.start();
    this.startSpinnerInterval();
    this.showThinkingAnimation();

    // Start stream timeout — auto-fail if no tokens arrive (or patience tick in patient mode)
    this.resetStreamTimeout();

    this.refreshSessionCost(true);
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  pushAssistantToken(token: string, tokenCount = 1): void {
    this.streamingController.pushToken(token, tokenCount);
  }

  clearAssistantStreamContent(nowMs = Date.now()): void {
    this.streamingController.clear();
    this.state = clearStreamingAssistant(this.state, nowMs);
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  completeAssistantStream(nowMs = Date.now()): void {
    this.streamingController.finish();
    this.clearStreamTimeout();
    this.clearPatienceState();
    this.hideThinkingAnimationImmediate();
    this.finalizeStreamingTelemetry();
    this.state = finishStreaming(this.state, nowMs);
    this.stopSpinnerInterval();
    this.refreshSessionCost(false);
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();

    // Drain any queued submissions after stream completion
    this.drainPendingSubmissionQueue();
  }

  failAssistantStream(error: unknown, nowMs = Date.now()): void {
    this.streamingController.fail(error);
    this.clearStreamTimeout();
    this.clearPatienceState();
    this.hideThinkingAnimationImmediate();
    const normalized = error instanceof Error ? error : new Error(String(error));
    const message = sanitizeErrorForCli(normalized);
    this.finalizeStreamingTelemetry();
    this.state = recordStreamingError(this.state, message, nowMs);
    // Show error in transcript so the user can see what went wrong
    this.state = appendAssistant(this.state, `[Error: ${message}]`, 0, nowMs);
    this.stopSpinnerInterval();
    this.refreshSessionCost(false);
    this.events.onError?.(normalized);
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();

    // Drain any queued submissions after stream error
    this.drainPendingSubmissionQueue();
  }

  /**
   * Set or clear a transient system notice (e.g. hot reload warnings).
   * Pass null to clear.
   */
  setSystemNotice(message: string | null): void {
    this.state = setSystemNotice(this.state, message);
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  /**
   * Push a tool call event into the TUI state (tool started executing)
   */
  pushToolCall(event: {
    messageId: string;
    step: number;
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    startedAt: number;
    originAgentId?: string;
    depth?: number;
    kind?: 'tool' | 'task';
  }): void {
    this.state = addToolCall(this.state, event);
    this.resetStreamTimeout();
    this.startSpinnerInterval();
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  /**
   * Push a tool result event (tool completed, possibly with error)
   */
  pushToolResult(event: {
    toolCallId: string;
    toolName: string;
    output: unknown;
    completedAt: number;
    durationMs: number;
    error?: { message: string };
  }): void {
    this.state = completeToolCall(this.state, {
      toolCallId: event.toolCallId,
      output: event.output,
      completedAt: event.completedAt,
      durationMs: event.durationMs,
      error: event.error,
    });
    this.resetStreamTimeout();
    if (!hasInProgressToolBlocks(this.state)) {
      this.stopSpinnerInterval();
    }
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  /**
   * Push a tool error event (tool failed with an error)
   */
  pushToolError(event: {
    toolCallId: string;
    toolName: string;
    error: { message: string };
    completedAt: number;
    durationMs: number;
  }): void {
    this.state = failToolCall(this.state, {
      toolCallId: event.toolCallId,
      error: event.error,
      completedAt: event.completedAt,
      durationMs: event.durationMs,
    });
    this.resetStreamTimeout();
    if (!hasInProgressToolBlocks(this.state)) {
      this.stopSpinnerInterval();
    }
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

  /**
   * Start the braille spinner interval for in-progress tool blocks
   * and the thinking indicator (waiting for first token).
   * Calls syncStateToUI every 80ms to animate spinner frames.
   */
  private startSpinnerInterval(): void {
    if (this.spinnerInterval !== null) return;
    this.spinnerInterval = setInterval(() => {
      if (hasInProgressToolBlocks(this.state) || this.state.streaming.waitingForFirstToken) {
        this.syncStateToUI();
      } else {
        this.stopSpinnerInterval();
      }
    }, 80);
  }

  /**
   * Stop the braille spinner interval.
   */
  private stopSpinnerInterval(): void {
    if (this.spinnerInterval !== null) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
  }

  /**
   * Start cursor blink interval. Toggles cursor visibility every 530ms.
   * Only updates the input renderable, not the full transcript.
   */
  private startCursorBlink(): void {
    if (this.cursorBlinkInterval !== null) return;
    this.cursorVisible = true;
    this.cursorBlinkInterval = setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
      this.syncInputToUI();
    }, 530);
  }

  /**
   * Stop cursor blink interval and reset cursor to visible.
   */
  private stopCursorBlink(): void {
    if (this.cursorBlinkInterval !== null) {
      clearInterval(this.cursorBlinkInterval);
      this.cursorBlinkInterval = null;
    }
    this.cursorVisible = true;
  }

  /**
   * Clear the stream timeout timer.
   */
  private clearStreamTimeout(): void {
    if (this.streamTimeoutTimer !== null) {
      clearTimeout(this.streamTimeoutTimer);
      this.streamTimeoutTimer = null;
    }
  }

  /**
   * Reset the stream timeout timer. Called when activity (tool call start/complete)
   * proves the stream is alive even though no text tokens have arrived yet.
   */
  private resetStreamTimeout(): void {
    if (!this.state.streaming.isStreaming) return;
    this.clearStreamTimeout();

    if (this.streamTimeoutMode === 'patient') {
      const intervalMs = this.patienceIntervalMs ?? FredTuiApp.DEFAULT_PATIENCE_INTERVAL_MS;
      this.streamTimeoutTimer = setTimeout(() => {
        if (this.state.streaming.waitingForFirstToken) {
          const message = this.resolvePatienceMessage();
          if (message) {
            this.setSystemNotice(message);
          }
          this.resetStreamTimeout(); // Re-arm for next tick
        }
      }, intervalMs);
    } else {
      // Default: fail after 30s
      this.streamTimeoutTimer = setTimeout(() => {
        if (this.state.streaming.waitingForFirstToken) {
          this.failAssistantStream(new Error('Response timed out — no tokens received within 30 seconds'));
        }
      }, FredTuiApp.STREAM_TIMEOUT_MS);
    }
  }

  /**
   * Resolve the next patience message from the configured source.
   */
  private resolvePatienceMessage(): string | null {
    const config = this.patienceMessage;
    if (config === undefined) return null;

    if (typeof config === 'string') {
      return config;
    }

    if (typeof config === 'function') {
      return config();
    }

    if (Array.isArray(config) && config.length > 0) {
      const message = config[this.patienceTickIndex % config.length];
      this.patienceTickIndex++;
      return message;
    }

    return null;
  }

  /**
   * Clear patience state between streaming turns.
   */
  private clearPatienceState(): void {
    this.patienceTickIndex = 0;
    if (this.state.systemNotice) {
      this.setSystemNotice(null);
    }
  }

  // no-ops — thinking animation is driven by syncStateToUI via spinner interval
  private showThinkingAnimation(): void { /* visibility set in syncStateToUI */ }
  private hideThinkingAnimation(): void { /* visibility set in syncStateToUI */ }
  private hideThinkingAnimationImmediate(): void { /* visibility set in syncStateToUI */ }

  /**
   * Reset cursor blink phase (show cursor immediately, restart timer).
   * Called on any key press to keep cursor visible while typing.
   */
  private resetCursorBlink(): void {
    this.cursorVisible = true;
    if (this.cursorBlinkInterval !== null) {
      clearInterval(this.cursorBlinkInterval);
      this.cursorBlinkInterval = setInterval(() => {
        this.cursorVisible = !this.cursorVisible;
        this.syncInputToUI();
      }, 530);
    }
  }

  /**
   * Sync only the input text renderable (lightweight, used by cursor blink).
   */
  private syncInputToUI(): void {
    if (!this.running) {
      return;
    }

    const theme = DEFAULT_TUI_THEME;
    const r = this.renderer;
    const focused = this.state.focusedPane === 'input';
    const inputData = renderInputContent(
      this.state,
      focused,
      this.inputPlaceholder,
      this.cursorVisible,
      this.getInputContentWidth(),
    );
    this.inputBar.remove('input-text');
    this.inputText.destroy();
    this.inputText = new TextRenderable(r, {
      id: 'input-text',
      content: inputData.lines.join('\n'),
      flexGrow: 1,
      fg: focused ? theme.fg.primary : theme.fg.dim,
    });
    this.inputText.selectable = false;
    this.inputBar.add(this.inputText);
  }

  private handleStreamingBatch(batch: StreamingBatch): void {
    const wasWaiting = this.state.streaming.waitingForFirstToken;
    this.state = appendAssistant(this.state, batch.text, batch.tokenCount);
    if (wasWaiting) {
      this.clearStreamTimeout();
      this.hideThinkingAnimation();
    }
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
    const inputText = this.state.input.text;
    if (!inputText.trim()) {
      // Clear empty input and return
      const { state: clearedState } = submitInput(this.state);
      this.state = clearedState;
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      return;
    }

    // Check if streaming is active
    if (this.state.streaming.isStreaming) {
      // Queue the submission - message will be shown dimmed via pending queue projection
      const { state: queuedState, entry } = queuePendingSubmission(this.state, inputText);
      this.state = queuedState;
      
      if (entry) {
        // Scroll to bottom so user can see their queued message
        this.transcriptContent.scrollTo(Infinity);
      }
      
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      return;
    }

    // Not streaming: submit immediately
    const { state: clearedState, submittedText } = submitInput(this.state);
    this.state = clearedState;
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();

    this.state = appendUserMessage(this.state, submittedText);

    // Reset OpenTUI scroll position to bottom on new message send.
    // This overrides _hasManualScroll so stickyScroll re-engages,
    // ensuring auto-scroll works even if user previously scrolled up.
    this.transcriptContent.scrollTo(Infinity);

    if (this.parseExitSlashCommand(submittedText)) {
      this.stop();
      return;
    }

    const sidebarInvocation = this.parseSidebarSlashCommand(submittedText);
    if (sidebarInvocation) {
      this.state = toggleSidebarVisibility(this.state);
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
      return;
    }

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

    this.state = startStreaming(this.state);
    this.streamingController.start();
    this.startSpinnerInterval();
    this.showThinkingAnimation();

    // Start stream timeout — auto-fail if no tokens arrive (or patience tick in patient mode)
    this.resetStreamTimeout();

    this.refreshSessionCost(true);
    this.events.onStateChange?.(this.state);
    this.events.onSubmit?.(submittedText, this.state.sessions.selectedId);
    this.syncStateToUI();

    if (this.state.sessions.selectedId === null) {
      void this.ensureSessionSelected();
    }
  }

  /**
   * Drain the pending submission queue after stream completion/error.
   * Dequeues the head entry and submits it, starting a new stream.
   */
  private drainPendingSubmissionQueue(): void {
    while (hasPendingSubmissions(this.state) && !this.state.streaming.isStreaming) {
      const { state: dequeuedState, entry } = dequeuePendingSubmission(this.state);
      this.state = dequeuedState;

      if (!entry) {
        return;
      }

      this.state = appendUserMessage(this.state, entry.text);
      this.transcriptContent.scrollTo(Infinity);

      // Handle slash commands in queued submissions.
      // These commands may not start a stream, so continue draining until
      // we either start streaming or run out of queued entries.
      if (this.parseExitSlashCommand(entry.text)) {
        this.stop();
        return;
      }

      const sidebarInvocation = this.parseSidebarSlashCommand(entry.text);
      if (sidebarInvocation) {
        this.state = toggleSidebarVisibility(this.state);
        this.events.onStateChange?.(this.state);
        this.syncStateToUI();
        continue;
      }

      const slashInvocation = this.parseSlashInvocation(entry.text);
      if (slashInvocation) {
        this.events.onStateChange?.(this.state);
        this.syncStateToUI();
        void this.executePluginSlashCommand(slashInvocation.canonicalName, slashInvocation.args);
        continue;
      }

      this.state = {
        ...this.state,
        telemetry: {
          ...this.state.telemetry,
          inputTokenCount: this.state.telemetry.inputTokenCount + this.estimateTokenCount(entry.text),
        },
      };

      this.state = startStreaming(this.state);
      this.streamingController.start();
      this.startSpinnerInterval();
      this.showThinkingAnimation();

      // Start stream timeout — auto-fail if no tokens arrive (or patience tick in patient mode)
      this.resetStreamTimeout();

      this.refreshSessionCost(true);
      this.events.onStateChange?.(this.state);
      this.events.onSubmit?.(entry.text, this.state.sessions.selectedId);
      this.syncStateToUI();

      if (this.state.sessions.selectedId === null) {
        void this.ensureSessionSelected();
      }

      // Stream started; completion/error hooks will trigger the next drain.
      return;
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
        this.state = setFocusedPane(
          this.state,
          nextFocusablePane(this.state.focusedPane, { includeSidebar: this.state.sidebar.isVisible }),
        );
        break;
      case 'focus-previous-pane':
        this.state = setFocusedPane(
          this.state,
          prevFocusablePane(this.state.focusedPane, { includeSidebar: this.state.sidebar.isVisible }),
        );
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
      case 'exit':
        this.events.onQuit?.();
        return;
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

  private parseSidebarSlashCommand(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) {
      return false;
    }

    return trimmed === '/sidebar' || trimmed === '/sb';
  }

  private parseExitSlashCommand(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    return trimmed === '/exit' || trimmed === '/quit';
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
      const sanitized = sanitizeErrorForCli(error);
      const userFacing = `[plugin:${command.pluginId}] ${canonicalName} failed: ${sanitized}`;
      this.state = appendAssistant(this.state, userFacing, 1);
      this.state = recordStreamingError(this.state, userFacing);
      // Full error details forwarded to onError for internal logging/debugging
      this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
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

  private async loadSelectedSessionTranscript(previousSelectedId: string | null): Promise<void> {
    if (!this.sessionService) {
      return;
    }

    const selectedId = this.state.sessions.selectedId;
    if (!selectedId || selectedId === previousSelectedId) {
      return;
    }

    const selectedItem = this.state.sessions.items.find((item) => item.id === selectedId);
    if (!selectedItem) {
      return;
    }

    const existingTranscript = this.state.sessions.transcripts[selectedId];
    const hasMessages = (existingTranscript?.messages.length ?? 0) > 0;
    if (hasMessages || selectedItem.messageCount === 0) {
      return;
    }

    try {
      const messages = await loadSessionTranscript(this.sessionService, selectedId);

      // Session may have changed while loading; ignore stale results
      if (this.state.sessions.selectedId !== selectedId) {
        return;
      }

      this.state = upsertSessionTranscript(this.state, selectedId, messages, { pinnedToBottom: true });
      this.events.onStateChange?.(this.state);
      this.syncStateToUI();
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
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

  /**
   * Calculate the available text width for the input composer area.
   * Accounts for sidebar, input bar padding (1 on each side = 2 total).
   */
  private getInputContentWidth(): number {
    const rendererWidth = this.getRendererWidth();
    const sidebarWidth = this.state.sidebar.isVisible ? DEFAULT_LAYOUT.sidebarWidth : 0;
    // inputBar has padding: 1 (all sides), so 1 left + 1 right = 2 horizontal padding
    const inputBarPadding = 2;
    return Math.max(10, rendererWidth - sidebarWidth - inputBarPadding);
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

  /**
   * Strip ANSI/OSC/control escape sequences from text before clipboard copy.
   * Prevents terminal escape injection via untrusted content.
   */
  private sanitizeForClipboard(text: string): string {
    // Strip ANSI/OSC/DCS control sequences first.
    // eslint-disable-next-line no-control-regex
    return text
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b[P^_][\s\S]*?\x1b\\/g, '')
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x9b[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b[@-_]/g, '')
      // Strip remaining C0/C1 control chars except newline, tab, carriage return
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
  }

  private copyTranscriptToClipboard(): void {
    const text = this.getTranscriptPlainText();
    if (!text) {
      return;
    }

    this.copyToClipboard(this.sanitizeForClipboard(text));
  }

  /**
   * Copy the last assistant message text to the system clipboard.
   * Triggered via Ctrl+Y keybinding.
   */
  private copyLastAssistantMessage(): void {
    const lastAssistantMsg = [...this.state.transcript.messages]
      .reverse()
      .find((m) => m.role === 'assistant');

    if (!lastAssistantMsg || !lastAssistantMsg.content) {
      return;
    }

    const contentParts = Array.isArray(lastAssistantMsg.content)
      ? (lastAssistantMsg.content as Array<{ type?: string; text?: string }>)
      : null;

    const content = typeof lastAssistantMsg.content === 'string'
      ? lastAssistantMsg.content
      : contentParts
        ? contentParts
            .filter((part) => part.type === 'text')
            .map((part) => part.text ?? '')
            .join('')
        : String(lastAssistantMsg.content);

    this.copyToClipboard(this.sanitizeForClipboard(content));

    // Brief "Copied!" feedback via status override
    this.showCopyFeedback();
  }

  /**
   * Copy text to clipboard. Tries system commands first (xclip, xsel, wl-copy,
   * pbcopy) for broad terminal compatibility, falls back to OSC 52.
   */
  private copyToClipboard(text: string): void {
    const cmds = [
      ['wl-copy'],
      ['xclip', '-selection', 'clipboard'],
      ['xsel', '--clipboard', '--input'],
      ['pbcopy'],
    ];

    for (const [cmd, ...args] of cmds) {
      try {
        const proc = Bun.spawnSync([cmd!, ...args], {
          stdin: new TextEncoder().encode(text),
          stdout: 'ignore',
          stderr: 'ignore',
        });
        if (proc.exitCode === 0) return;
      } catch {
        // Command not found, try next
      }
    }

    // Fallback: OSC 52 (terminal must support it)
    this.renderer.copyToClipboardOSC52(text);
  }

  /**
   * Temporarily show "Copied to clipboard" in the status bar.
   * Clears after 2 seconds by triggering a normal status re-render.
   */
  private copyFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private copyFeedbackActive = false;

  private showCopyFeedback(): void {
    this.copyFeedbackActive = true;
    this.syncStateToUI();

    if (this.copyFeedbackTimeout) {
      clearTimeout(this.copyFeedbackTimeout);
    }
    this.copyFeedbackTimeout = setTimeout(() => {
      this.copyFeedbackActive = false;
      this.copyFeedbackTimeout = null;
      this.syncStateToUI();
    }, 2000);
  }

  /**
   * Push current state to OpenTUI renderables
   */
  private syncStateToUI(forceTranscriptRefresh = false): void {
    const r = this.renderer;
    const theme = DEFAULT_TUI_THEME;

    this.sidebarBox.visible = this.state.sidebar.isVisible;

    // Input text (calculate first so transcript viewport can account for dynamic composer height)
    const inputData = renderInputContent(
      this.state,
      this.state.focusedPane === 'input',
      this.inputPlaceholder,
      this.cursorVisible,
      this.getInputContentWidth(),
    );
    this.inputBar.height = inputData.height;

    const rendererHeight = this.getRendererHeight();
    const transcriptVisibleLines = Math.max(
      3,
      rendererHeight - inputData.height - DEFAULT_LAYOUT.statusHeight
        - (DEFAULT_LAYOUT.outerPadding * 2) - (DEFAULT_LAYOUT.regionGap * 2),
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
    const sidebarHeader = sidebarContent.sessionsHeader || sidebarContent.lines[0] || '[Sessions]';

    const itemLines = sidebarContent.metadataHeader
      ? sidebarContent.sessionsLines
      : (sidebarContent.sessionsLines.length > 0
        ? sidebarContent.sessionsLines
        : sidebarContent.lines.slice(1));
    this.repopulateScrollBox(this.sidebarItems, itemLines, (line, i) => {
      const isSelected = line.startsWith('▸') || (this.state.commandPalette.isOpen && line.startsWith('>'));
      const isFocused = this.state.focusedPane === 'sidebar';
      let fg: string;
      if (isSelected) {
        fg = theme.accent.primary;
      } else if (isFocused) {
        fg = theme.fg.primary;
      } else {
        fg = theme.fg.dim;
      }
      const text = new TextRenderable(r, {
        id: `sidebar-item-${i}`,
        content: line,
        fg,
        attributes: isSelected ? TextAttributes.BOLD : 0,
      });
      text.selectable = false;
      return text;
    });

    // Sidebar title styling based on focus
    this.sidebarTitle = this.rebuildText(
      this.sidebarTitle,
      'sidebar-title',
      sidebarHeader,
      this.state.focusedPane === 'sidebar' ? theme.accent.primary : theme.fg.dim,
      TextAttributes.BOLD,
    );

    const footerContent = sidebarContent.metadataHeader
      ? [sidebarContent.metadataHeader, ...sidebarContent.metadataLines].filter(Boolean).join('\n')
      : '';
    this.sidebarFooter = this.rebuildText(
      this.sidebarFooter,
      'sidebar-footer',
      footerContent,
      this.state.focusedPane === 'sidebar' ? theme.fg.primary : theme.fg.dim,
      footerContent.length > 0 ? TextAttributes.BOLD : 0,
    );

    // Transcript content
    this.syncTranscriptToUI(r, theme, forceTranscriptRefresh);
    this.refreshDynamicTranscriptElements(theme);

    this.inputBar.remove('input-text');
    this.inputText.destroy();
    this.inputText = new TextRenderable(r, {
      id: 'input-text',
      content: inputData.lines.join('\n'),
      flexGrow: 1,
      fg: this.state.focusedPane === 'input' ? theme.fg.primary : theme.fg.dim,
    });
    this.inputText.selectable = false;
    this.inputBar.add(this.inputText);

    // Status bar — stateless badge rendering, no throttle needed
    const overlayActive = this.state.input.slashSearch.isActive || this.state.helpModal.isOpen;
    const statusData = renderStatusContent(this.state, {
      maxWidth: Math.max(40, this.getRendererWidth() - 4),
      dim: overlayActive,
    });

    const displayStatusLine = this.copyFeedbackActive
      ? 'Copied to clipboard'
      : statusData.lines[0] ?? '';

    this.statusBar.remove('status-text');
    this.statusText.destroy();
    this.statusText = new TextRenderable(r, {
      id: 'status-text',
      content: ` ${displayStatusLine} `,
      fg: this.copyFeedbackActive ? theme.status.success : (statusData.dim ? theme.fg.dim : theme.fg.secondary),
    });
    this.statusText.selectable = false;
    this.statusBar.add(this.statusText);

    // Slash autocomplete overlay
    const slashActive = this.state.input.slashSearch.isActive;
    this.slashOverlay.visible = slashActive;
    if (slashActive) {
      const { filteredActions, selectedIndex } = this.state.input.slashSearch;
      const lines = filteredActions.map((action, i) => {
        const marker = i === selectedIndex ? '▸ ' : '  ';
        return `${marker}/${action.label}`;
      });
      const content = lines.length > 0 ? lines.join('\n') : '  No matches';
      this.slashOverlay.remove('slash-overlay-text');
      this.slashOverlayText.destroy();
      this.slashOverlayText = new TextRenderable(r, {
        id: 'slash-overlay-text',
        content,
        fg: theme.fg.primary,
      });
      this.slashOverlayText.selectable = false;
      this.slashOverlay.add(this.slashOverlayText);
    }

    // Help modal overlay
    const helpOpen = this.state.helpModal.isOpen;
    this.helpOverlay.visible = helpOpen;
    if (helpOpen) {
      const helpContent = [
        '  Keyboard Shortcuts',
        '',
        '  Tab / Shift+Tab    Cycle focus',
        '  Ctrl+B             Toggle sidebar',
        '  Ctrl+K             Command palette',
        '  Ctrl+Y             Copy last message',
        '  Ctrl+Shift+C       Copy selection (terminal)',
        '  PgUp / PgDn        Scroll transcript',
        '  F1 / ?             Toggle this help',
        '  Esc                Close / Quit',
        '',
        '  Input',
        '  Enter              Send message',
        '  Shift+Enter        Insert newline',
        '  /                  Slash commands',
        '  Up / Down          History navigation',
        '',
        '  Press Esc to close',
      ].join('\n');
      this.helpOverlayText.destroy();
      this.helpOverlayText = new TextRenderable(r, {
        id: 'help-overlay-text',
        content: helpContent,
        fg: theme.fg.primary,
      });
      this.helpOverlayText.selectable = false;
      this.helpOverlay.add(this.helpOverlayText);
    }

    // Thinking spinner — update braille frame on the spinner TextRenderable
    if (this.thinkingSpinnerId && this.state.streaming.waitingForFirstToken) {
      const spinnerEl = this.transcriptContent.findDescendantById(this.thinkingSpinnerId);
      if (spinnerEl && spinnerEl instanceof TextRenderable) {
        spinnerEl.content = getSpinnerFrame(Date.now());
      }
    }

    // Border highlighting for focused pane
    this.updateBorderFocus();

    // Manage cursor blink based on focus
    if (this.state.focusedPane === 'input' && !this.state.commandPalette.isOpen) {
      this.startCursorBlink();
    } else {
      this.stopCursorBlink();
    }
  }

  private refreshDynamicTranscriptElements(theme: typeof DEFAULT_TUI_THEME): void {
    const messages = getTranscriptMessages(this.state);
    const lastMessage = messages[messages.length - 1];

    if (
      this.activeStreamingMdId
      && this.state.streaming.isStreaming
      && lastMessage?.role === 'assistant'
    ) {
      const existingMd = this.transcriptContent.findDescendantById(this.activeStreamingMdId);
      if (existingMd && existingMd instanceof CodeRenderable) {
        existingMd.content = sanitizeForTerminalDisplay(lastMessage.content) + buildStreamingCursorText();
      }
    }

    if (this.thinkingSpinnerId && this.state.streaming.waitingForFirstToken) {
      const spinnerEl = this.transcriptContent.findDescendantById(this.thinkingSpinnerId);
      if (spinnerEl && spinnerEl instanceof TextRenderable) {
        spinnerEl.content = getSpinnerFrame(Date.now());
      }
    }

    const nowMs = Date.now();
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
      if (messages[messageIndex]?.role !== 'user') {
        continue;
      }

      const toolBlocks = sortToolBlocksByParent(getToolBlocksForMessage(this.state, messageIndex));
      for (let blockIndex = 0; blockIndex < toolBlocks.length; blockIndex += 1) {
        const summaryId = `tool-summary-msg-${messageIndex}-${blockIndex}`;
        const summaryEl = this.transcriptContent.findDescendantById(summaryId);
        if (!(summaryEl instanceof TextRenderable)) {
          continue;
        }

        const presentation = getToolBlockSummaryPresentation(
          toolBlocks[blockIndex],
          blockIndex === toolBlocks.length - 1,
          nowMs,
          theme,
        );
        // Truncate with ellipsis when content overflows the clip box.
        // The clip box uses overflow:hidden for responsive clipping, but we
        // also want a visual `…` indicator at the truncation point.
        const clipId = `tool-summary-clip-msg-${messageIndex}-${blockIndex}`;
        const clipEl = this.transcriptContent.findDescendantById(clipId);
        const clipWidth = clipEl instanceof BoxRenderable ? clipEl.width : 0;
        if (clipWidth > 4 && presentation.content.length > clipWidth) {
          summaryEl.content = presentation.content.slice(0, clipWidth - 1) + '\u2026';
        } else {
          summaryEl.content = presentation.content;
        }
        summaryEl.fg = presentation.fg;
        summaryEl.attributes = presentation.attributes;
      }
    }
  }

  /**
   * Sync transcript pane to renderables.
   *
   * For startup chooser and empty state, uses the legacy string-line path.
   * For normal messages, builds per-message renderables with distinct styling.
   * During streaming, updates the active CodeRenderable content in place.
   */
  private syncTranscriptToUI(
    r: CliRenderer,
    theme: typeof DEFAULT_TUI_THEME,
    forceTranscriptRefresh = false,
  ): void {
    const messages = getTranscriptMessages(this.state);
    const isStartupChooser = this.state.startup.chooser.isOpen;
    const hasPending = this.state.input.pendingSubmissions.length > 0;
    const isEmpty = messages.length === 0 && !hasPending;

    // Compute a fingerprint of transcript-affecting state to skip redundant full rebuilds.
    // This avoids destroying and recreating all renderables on every key press.
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    const pendingCount = this.state.input.pendingSubmissions.length;
    const toolBlockCount = this.state.toolBlocks.groups.length;
    const lastToolStatus = toolBlockCount > 0
      ? this.state.toolBlocks.groups[toolBlockCount - 1].blocks.map(b => b.status).join(',')
      : '';
    const transcriptFingerprint = `${isStartupChooser}|${messages.length}|${lastMsg?.role ?? ''}|${this.state.streaming.isStreaming}|${this.state.streaming.waitingForFirstToken}|${this.state.streaming.lastError ?? ''}|${pendingCount}|${toolBlockCount}|${lastToolStatus}|${this.state.startup.chooser.selected}|${this.state.focusedPane}|${this.state.systemNotice ?? ''}`;

    // Startup chooser and empty state (no pending): use legacy string-line path
    if (isStartupChooser || isEmpty) {
      // Check fingerprint to avoid redundant rebuilds even for startup chooser
      if (!forceTranscriptRefresh && transcriptFingerprint === this.lastTranscriptFingerprint) {
        return;
      }
      this.lastTranscriptFingerprint = transcriptFingerprint;

      this.activeStreamingMdId = null;
      this.lastRenderedMessageCount = 0;

      const transcriptData = renderTranscriptContent(
        this.state,
        this.state.focusedPane === 'transcript',
      );

      this.repopulateScrollBox(this.transcriptContent, transcriptData.lines, (line, i) => {
        const isStartupHeader = isStartupChooser && i === 0;
        const isStartupWarning = isStartupChooser && line.startsWith('warning:');
        const isStartupSelectedOption = isStartupChooser && line.startsWith('>> ');
        const isStartupInstruction = isStartupChooser && line.startsWith('Use Up/Down');

        let fg = this.state.focusedPane === 'transcript' ? theme.fg.primary : theme.fg.secondary;
        let attributes = 0;

        if (isStartupHeader) {
          fg = theme.accent.primary;
          attributes = TextAttributes.BOLD;
        } else if (isStartupSelectedOption) {
          fg = theme.status.success;
          attributes = TextAttributes.BOLD;
        } else if (isStartupWarning) {
          fg = theme.status.warn;
        } else if (isStartupInstruction) {
          fg = theme.fg.secondary;
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

      // Still render pending submissions even in empty state
      if (hasPending) {
        this.renderPendingSubmissions(r, theme, 0);
      }
      return;
    }

    // Streaming incremental update: update existing CodeRenderable in place
    if (
      this.activeStreamingMdId
      && this.state.streaming.isStreaming
      && messages.length === this.lastRenderedMessageCount
      && messages.length > 0
      && messages[messages.length - 1].role === 'assistant'
    ) {
      const existingMd = this.transcriptContent.findDescendantById(this.activeStreamingMdId);
      if (existingMd && existingMd instanceof CodeRenderable) {
        const lastMsg = messages[messages.length - 1];
        existingMd.content = sanitizeForTerminalDisplay(lastMsg.content) + buildStreamingCursorText();
        this.lastTranscriptFingerprint = transcriptFingerprint;
        return;
      }

      // Renderable was lost (e.g., after rebuild); force a full rebuild
      this.activeStreamingMdId = null;
    }

    // Full rebuild: clear and rebuild all message renderables
    // Skip if transcript fingerprint hasn't changed (avoids flicker on unrelated state changes)
    if (!forceTranscriptRefresh && transcriptFingerprint === this.lastTranscriptFingerprint) {
      return;
    }
    this.lastTranscriptFingerprint = transcriptFingerprint;

    const children = this.transcriptContent.getChildren();
    for (const child of children) {
      this.transcriptContent.remove(child.id);
      child.destroy();
    }
    this.activeStreamingMdId = null;
    this.thinkingSpinnerId = null;

    const normalSyntaxStyle = this.syntaxStyle!;
    const streamingSyntaxStyle = this.streamingSyntaxStyle!;
    const nowMs = Date.now();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const msgId = String(i);
      const isLastMessage = i === messages.length - 1;
      const isStreamingThis = isLastMessage && this.state.streaming.isStreaming && msg.role === 'assistant';
      const hasAssistantText = msg.role === 'assistant' && msg.content.trim().length > 0;

      if (msg.role === 'user') {
        const showSpinner = isLastMessage && this.state.streaming.waitingForFirstToken;
        const userRenderable = buildUserMessageRenderable(
          r, theme, msg.content, msgId,
          showSpinner ? { spinner: true, nowMs } : undefined,
        );

        if (showSpinner) {
          this.thinkingSpinnerId = `${THINKING_SPINNER_ID_PREFIX}${msgId}`;
        }

        this.transcriptContent.add(userRenderable);

        const toolBlocks = getToolBlocksForMessage(this.state, i);
        if (toolBlocks.length > 0) {
          const toolGroup = buildToolGroupRenderable(
            r,
            theme,
            toolBlocks,
            `msg-${msgId}`,
            nowMs,
          );
          if (toolGroup) {
            this.transcriptContent.add(toolGroup);
          }
        }
      } else if (msg.role === 'assistant') {
        const isThinking = hasAssistantText && msg.content.startsWith('<thinking>');

        if (isThinking) {
          // Extract thinking content (strip tags)
          const thinkingContent = msg.content
            .replace(/^<thinking>\s*/, '')
            .replace(/\s*<\/thinking>\s*$/, '');
          this.transcriptContent.add(
            buildThinkingRenderable(r, theme, thinkingContent, msgId),
          );
        } else if (hasAssistantText) {
          const displayContent = isStreamingThis
            ? msg.content + buildStreamingCursorText()
            : msg.content;
          const renderable = buildAssistantMessageRenderable(
            r,
            theme,
            displayContent,
            msgId,
            { streaming: isStreamingThis, syntaxStyle: isStreamingThis ? streamingSyntaxStyle : normalSyntaxStyle },
          );
          this.transcriptContent.add(renderable);

          if (isStreamingThis) {
            this.activeStreamingMdId = `msg-assistant-md-${msgId}`;
          }
        }
        // NOTE: Manual expand/toggle for tool blocks could be added via keymap later
      } else {
        // System or other roles: render as plain text
        this.transcriptContent.add(
          buildUserMessageRenderable(r, theme, msg.content, msgId),
        );
      }
    }

    // Render pending submissions as dimmed user messages
    if (hasPending) {
      this.renderPendingSubmissions(r, theme, messages.length);
    }

    // Render transient system notice (e.g. hot reload warning)
    if (this.state.systemNotice) {
      this.transcriptContent.add(
        buildSystemNoticeRenderable(r, theme, this.state.systemNotice, 'system-notice'),
      );
    }

    this.lastRenderedMessageCount = messages.length;

    // Handle streaming-to-complete transition: swap SyntaxStyle to normal colors
    if (!this.state.streaming.isStreaming && this.activeStreamingMdId) {
      const md = this.transcriptContent.findDescendantById(this.activeStreamingMdId);
      if (md && md instanceof CodeRenderable) {
        md.streaming = false;
        md.syntaxStyle = this.syntaxStyle!;
        // Remove cursor character from content
        if (md.content.toString().endsWith(buildStreamingCursorText())) {
          md.content = md.content.toString().slice(0, -1);
        }
      }
      this.activeStreamingMdId = null;
    }

    // Handle streaming error: force full rebuild to apply normal styles
    if (this.state.streaming.lastError && this.activeStreamingMdId) {
      // Clear the active streaming id to trigger a full rebuild on next sync
      this.activeStreamingMdId = null;
    }
  }

  /**
   * Render pending submissions as dimmed user message placeholders.
   * These are projected after committed transcript messages and disappear
   * as each queued item is dispatched.
   */
  private renderPendingSubmissions(
    r: CliRenderer,
    theme: typeof DEFAULT_TUI_THEME,
    startIndex: number,
  ): void {
    const pending = this.state.input.pendingSubmissions;
    for (let i = 0; i < pending.length; i++) {
      const entry = pending[i];
      const msgId = `pending-${startIndex + i}`;

      // Build a dimmed user message container
      const container = new BoxRenderable(r, {
        id: `msg-pending-${msgId}`,
        flexDirection: 'column',
        backgroundColor: theme.message.userBg,
        border: ['left'],
        borderStyle: 'single',
        borderColor: theme.fg.dim, // Dim border instead of accent
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 0,
        paddingBottom: 0,
        marginBottom: 1,
      });

      const text = new TextRenderable(r, {
        id: `msg-pending-text-${msgId}`,
        content: entry.text,
        fg: theme.fg.dim, // Dim text
        attributes: TextAttributes.DIM,
      });
      text.selectable = false;

      container.add(text);
      this.transcriptContent.add(container);
    }
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
    const sidebarTitle = this.sidebarBox.getRenderable('sidebar-title');
    const sidebarItems = this.sidebarBox.getRenderable('sidebar-items');
    const sidebarFooter = this.sidebarBox.getRenderable('sidebar-footer');

    if (sidebarTitle) {
      this.sidebarBox.remove('sidebar-title');
    }
    if (sidebarItems) {
      this.sidebarBox.remove('sidebar-items');
    }
    if (sidebarFooter) {
      this.sidebarBox.remove('sidebar-footer');
    }

    existing.destroy();

    const newText = new TextRenderable(this.renderer, {
      id,
      content,
      fg,
      attributes,
    });
    newText.selectable = false;

    const nextTitle = id === 'sidebar-title' ? newText : sidebarTitle;
    const nextFooter = id === 'sidebar-footer' ? newText : sidebarFooter;

    if (nextTitle) {
      this.sidebarBox.add(nextTitle);
    }
    if (sidebarItems) {
      this.sidebarBox.add(sidebarItems);
    }
    if (nextFooter) {
      this.sidebarBox.add(nextFooter);
    }

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
    if (!direction) return;

    const delta = event.scroll?.delta ?? 1;
    const scrollAmount = direction === 'up' ? -delta : delta;

    // Update TUI state as the single source of truth for transcript scrolling.
    const lines = Math.max(1, Math.round(Math.abs(scrollAmount)));
    if (direction === 'up') {
      this.state = scrollTranscript(this.state, -lines);
    } else {
      this.state = scrollTranscript(this.state, lines);
    }
    this.events.onStateChange?.(this.state);
    this.syncStateToUI();
  }

  /**
   * Update visual focus indication
   *
   * With borderless layout, focus is conveyed through content text color
   * changes (accent for focused, dim for unfocused) applied in syncStateToUI.
   */
  private updateBorderFocus(): void {
    // Focus indication handled by content styling in syncStateToUI.
    // Sidebar title: accent.primary (focused) vs fg.dim (unfocused)
    // Sidebar items: fg.primary (focused) vs fg.dim (unfocused)
    // Transcript text: fg.primary (focused) vs fg.secondary (unfocused)
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
    this.stopSpinnerInterval();
    this.stopCursorBlink();
    this.clearStreamTimeout();
    if (this.copyFeedbackTimeout) {
      clearTimeout(this.copyFeedbackTimeout);
      this.copyFeedbackTimeout = null;
    }
    this.streamingController.stop();
    this.hideThinkingAnimationImmediate();
    this.syntaxStyle?.destroy();
    this.syntaxStyle = null;
    this.streamingSyntaxStyle?.destroy();
    this.streamingSyntaxStyle = null;
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
