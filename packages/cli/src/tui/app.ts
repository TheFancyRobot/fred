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
} from '@opentui/core';
import type { TuiState, FocusablePaneId } from './state.js';
import {
  createInitialTuiState,
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

/**
 * TUI app configuration
 */
export interface TuiAppConfig {
  showStartupHint?: boolean;
  streamingFrameMs?: number;
  maxRenderQueue?: number;
}

/**
 * TUI app lifecycle events
 */
export interface TuiAppEvents {
  onStateChange?: (state: TuiState) => void;
  onSubmit?: (text: string) => void;
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

  private static readonly INPUT_TOKEN_COST_USD = 0.0000015;
  private static readonly OUTPUT_TOKEN_COST_USD = 0.000002;

  private constructor(renderer: CliRenderer, events: TuiAppEvents = {}, config: TuiAppConfig = {}) {
    this.state = createInitialTuiState();
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
  }

  /**
   * Create app with CLI renderer (production)
   */
  static async create(events: TuiAppEvents = {}, config: TuiAppConfig = {}): Promise<FredTuiApp> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
    });
    const app = new FredTuiApp(renderer, events, config);
    app.buildComponentTree();
    app.registerKeyboardHandler();
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
    app.syncStateToUI();
    app.running = true;
    return app;
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
    });

    this.sidebarBox.add(this.sidebarTitle);
    this.sidebarBox.add(this.sidebarItems);

    // Transcript
    this.transcriptBox = new BoxRenderable(r, {
      id: 'transcript',
      flexGrow: 1,
      border: true,
      borderStyle: 'rounded',
      flexDirection: 'column',
    });

    this.transcriptContent = new ScrollBoxRenderable(r, {
      id: 'transcript-content',
      flexGrow: 1,
    });

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
    const { state: newState, submittedText } = submitInput(this.state);
    if (!submittedText.trim()) {
      return;
    }

    this.state = appendUserMessage(newState, submittedText);
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
    this.events.onSubmit?.(submittedText);
    this.syncStateToUI();
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
        this.state = {
          ...this.state,
          sidebar: {
            ...this.state.sidebar,
            selectedIndex: Math.min(
              this.state.sidebar.items.length - 1,
              this.state.sidebar.selectedIndex + 1,
            ),
          },
        };
        break;
      case 'select-previous-session':
        this.state = {
          ...this.state,
          sidebar: {
            ...this.state.sidebar,
            selectedIndex: Math.max(0, this.state.sidebar.selectedIndex - 1),
          },
        };
        break;
      default:
        break;
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
   * Push current state to OpenTUI renderables
   */
  private syncStateToUI(): void {
    const r = this.renderer;

    // Sidebar content
    const sidebarContent = renderSidebarContent(
      this.state,
      this.state.focusedPane === 'sidebar'
    );
    const sidebarHeader = sidebarContent.lines[0] ?? '[Sessions]';

    // Clear and re-populate sidebar items
    // Remove existing children first
    const existingSidebarChildren: TextRenderable[] = [];
    // We track items by rebuilding each sync
    this.sidebarItems.destroy();
    this.sidebarItems = new ScrollBoxRenderable(r, {
      id: 'sidebar-items',
      flexGrow: 1,
    });
    const itemLines = sidebarContent.lines.slice(1);
    for (let i = 0; i < itemLines.length; i++) {
      const text = new TextRenderable(r, {
        id: `sidebar-item-${i}`,
        content: itemLines[i],
        fg: this.state.focusedPane === 'sidebar' ? '#FFFFFF' : '#888888',
      });
      this.sidebarItems.add(text);
    }
    this.sidebarBox.add(this.sidebarItems);

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
      this.state.focusedPane === 'transcript'
    );

    this.transcriptContent.destroy();
    this.transcriptContent = new ScrollBoxRenderable(r, {
      id: 'transcript-content',
      flexGrow: 1,
    });
    for (let i = 0; i < transcriptData.lines.length; i++) {
      const line = transcriptData.lines[i];
      const isRoleLabel = line.endsWith(':') && (line === 'user:' || line === 'assistant:');
      const text = new TextRenderable(r, {
        id: `transcript-line-${i}`,
        content: line,
        fg: isRoleLabel ? '#00FFFF' : (this.state.focusedPane === 'transcript' ? '#FFFFFF' : '#CCCCCC'),
        attributes: isRoleLabel ? TextAttributes.BOLD : 0,
      });
      this.transcriptContent.add(text);
    }
    this.transcriptBox.add(this.transcriptContent);

    // Input text
    const inputData = renderInputContent(
      this.state,
      this.state.focusedPane === 'input',
      this.inputPlaceholder,
    );
    this.inputBar.height = inputData.height;

    this.inputText.destroy();
    this.inputText = new TextRenderable(r, {
      id: 'input-text',
      content: inputData.lines.join('\n'),
      flexGrow: 1,
      fg: this.state.input.text ? '#FFFFFF' : '#666666',
    });
    this.inputBar.add(this.inputText);

    // Status bar
    const nowMs = Date.now();
    const shouldThrottleStatus = this.state.streaming.isStreaming;
    const shouldRenderFreshStatus = !shouldThrottleStatus
      || this.lastStatusLine.length === 0
      || (nowMs - this.lastStatusRenderMs) >= this.statusThrottleMs;

    if (shouldRenderFreshStatus) {
      const statusData = renderStatusContent(this.state, {
        maxWidth: Math.max(40, this.getRendererWidth() - 4),
        nowMs,
      });
      this.lastStatusLine = statusData.lines[0] ?? '';
      this.lastStatusRenderMs = nowMs;
    }

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
    this.sidebarBox.add(newText);
    return newText;
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
