/**
 * TUI state model for pane focus and navigation
 *
 * Framework-agnostic state representation that can be tested independently
 * of rendering implementation.
 */

/**
 * Tool block status tracking for inline tool call rendering
 */
export type ToolBlockStatus = 'in-progress' | 'completed' | 'errored';

/**
 * Kind of tool block: regular tool or task/subagent
 */
export type ToolBlockKind = 'tool' | 'task';

/**
 * State for a single tool call block in the transcript
 */
export interface ToolBlockState {
  toolCallId: string;
  toolName: string;
  kind: ToolBlockKind;
  status: ToolBlockStatus;
  input: Record<string, unknown>;
  output?: unknown;
  error?: { message: string };
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  expanded: boolean;
}

/**
 * Group of tool blocks belonging to the same assistant message turn
 */
export interface ToolBlockGroup {
  messageId: string;
  step: number;
  blocks: ToolBlockState[];
}

/**
 * Pane identifiers for the TUI layout
 */
export type PaneId = 'sidebar' | 'transcript' | 'input' | 'status';

/**
 * Focusable panes (status is display-only)
 */
export type FocusablePaneId = Exclude<PaneId, 'status'>;

/**
 * Transcript viewport state for scrolling
 */
export interface TranscriptViewport {
  scrollOffset: number;
  totalLines: number;
  visibleLines: number;
  pinnedToBottom: boolean;
}

export interface SessionListItem {
  id: string;
  title: string | null;
  updatedAt: Date;
  agent?: {
    id?: string;
    name?: string;
  };
  messageCount: number;
  preview: string | null;
  unread: boolean;
}

export interface SessionTranscript {
  viewport: TranscriptViewport;
  messages: Array<{ role: string; content: string }>;
}

export interface StreamingState {
  isStreaming: boolean;
  waitingForFirstToken: boolean;
  streamStartMs: number | null;
  firstTokenLatencyMs: number | null;
  outputTokenCount: number;
  tokensPerSecond: number;
  lastError: string | null;
  sessionId: string | null;
}

export interface SessionTelemetry {
  model: string;
  provider: string;
  sessionCostUsd: number;
  inputTokenCount: number;
  outputTokenCount: number;
}

export type CommandPaletteScope = FocusablePaneId;

export interface PluginSlashCommandState {
  pluginId: string;
  commandId: string;
  canonicalName: string;
  usageHint: string;
  available: boolean;
  hasCollision: boolean;
  collisionWith: ReadonlyArray<string>;
}

export interface PluginSlashCommandRegistration {
  pluginId: string;
  commandId: string;
  summary: string;
  usage?: string;
  available?: boolean;
}

export interface CommandPaletteAction {
  id: string;
  label: string;
  group: 'global' | FocusablePaneId;
  scopes: ReadonlyArray<CommandPaletteScope>;
  keywords?: ReadonlyArray<string>;
  kind?: 'builtin' | 'plugin-slash';
  plugin?: PluginSlashCommandState;
}

export interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  scope: CommandPaletteScope;
  actions: ReadonlyArray<CommandPaletteAction>;
  filteredActions: ReadonlyArray<CommandPaletteAction>;
}

export interface DeleteConfirmState {
  isOpen: boolean;
  sessionId: string | null;
  title: string | null;
}

export type StartupChooserOption = 'resume-last-session' | 'start-new-session';

export interface StartupState {
  chooser: {
    isOpen: boolean;
    selected: StartupChooserOption;
  };
  warning: string | null;
}

/**
 * Input history state for Up/Down navigation
 */
export interface InputHistory {
  entries: string[];
  currentIndex: number;
}

/**
 * Pending submission entry in the queue
 */
export interface PendingSubmission {
  id: string;
  text: string;
  createdAt: number;
}

/**
 * Complete TUI application state
 */
export interface TuiState {
  focusedPane: FocusablePaneId;
  transcript: SessionTranscript;
  streaming: StreamingState;
  telemetry: SessionTelemetry;
  commandPalette: CommandPaletteState;
  input: {
    text: string;
    cursorPosition: number;
    history: InputHistory;
    slashSearch: {
      isActive: boolean;
      query: string;
      selectedIndex: number;
      filteredActions: ReadonlyArray<CommandPaletteAction>;
    };
    pendingSubmissions: PendingSubmission[];
  };
  sessions: {
    items: SessionListItem[];
    selectedId: string | null;
    drafts: Record<string, string>;
    transcripts: Record<string, SessionTranscript>;
  };
  sidebar: {
    selectedIndex: number;
    hasNewSessionAction: boolean;
    isVisible: boolean;
    sections: {
      sessionsCollapsed: boolean;
      metadataCollapsed: boolean;
    };
  };
  deleteConfirm: DeleteConfirmState;
  startup: StartupState;
  toolBlocks: {
    groups: ToolBlockGroup[];
    /** Map of toolCallId -> user-toggled expand override */
    expandOverrides: Record<string, boolean>;
  };
  helpModal: {
    isOpen: boolean;
  };
  /** Transient system notice (e.g. hot reload error). Cleared on resolution. */
  systemNotice: string | null;
}

/**
 * Create initial TUI state with input pane focused
 */
export function createInitialTuiState(): TuiState {
  return createInitialTuiStateWithPlugins([]);
}

export function createInitialTuiStateWithPlugins(
  pluginSlashCommands: ReadonlyArray<PluginSlashCommandRegistration>,
): TuiState {
  const commandPaletteActions = createCommandPaletteActions(pluginSlashCommands);
  const transcript = createTranscriptState([], 20, true);

  return {
    focusedPane: 'input',
    transcript,
    streaming: {
      isStreaming: false,
      waitingForFirstToken: false,
      streamStartMs: null,
      firstTokenLatencyMs: null,
      outputTokenCount: 0,
      tokensPerSecond: 0,
      lastError: null,
      sessionId: null,
    },
    telemetry: {
      model: '--',
      provider: '--',
      sessionCostUsd: 0,
      inputTokenCount: 0,
      outputTokenCount: 0,
    },
    commandPalette: {
      isOpen: false,
      query: '',
      selectedIndex: 0,
      scope: 'input',
      actions: commandPaletteActions,
      filteredActions: getFilteredPaletteActions(commandPaletteActions, '', 'input'),
    },
    input: {
      text: '',
      cursorPosition: 0,
      history: {
        entries: [],
        currentIndex: -1,
      },
      slashSearch: {
        isActive: false,
        query: '',
        selectedIndex: 0,
        filteredActions: [],
      },
      pendingSubmissions: [],
    },
    sessions: {
      items: [],
      selectedId: null,
      drafts: {},
      transcripts: {},
    },
    sidebar: {
      selectedIndex: 0,
      hasNewSessionAction: true,
      isVisible: true,
      sections: {
        sessionsCollapsed: false,
        metadataCollapsed: false,
      },
    },
    deleteConfirm: {
      isOpen: false,
      sessionId: null,
      title: null,
    },
    startup: {
      chooser: {
        isOpen: false,
        selected: 'start-new-session',
      },
      warning: null,
    },
    toolBlocks: {
      groups: [],
      expandOverrides: {},
    },
    helpModal: {
      isOpen: false,
    },
    systemNotice: null,
  };
}

const STARTUP_CHOOSER_OPTIONS: ReadonlyArray<StartupChooserOption> = [
  'resume-last-session',
  'start-new-session',
];

export function shouldOpenStartupChooser(
  items: ReadonlyArray<SessionListItem>,
  initialSessionId: string | null | undefined,
): boolean {
  if (initialSessionId) return false;
  return items.length > 0;
}

export function openStartupChooser(state: TuiState): TuiState {
  return {
    ...state,
    startup: {
      ...state.startup,
      chooser: {
        isOpen: true,
        selected: 'start-new-session',
      },
    },
  };
}

export function closeStartupChooser(state: TuiState): TuiState {
  if (!state.startup.chooser.isOpen) {
    return state;
  }

  return {
    ...state,
    startup: {
      ...state.startup,
      chooser: {
        ...state.startup.chooser,
        isOpen: false,
      },
    },
  };
}

export function moveStartupChooserSelection(state: TuiState, delta: number): TuiState {
  if (!state.startup.chooser.isOpen) {
    return state;
  }

  const currentIndex = STARTUP_CHOOSER_OPTIONS.indexOf(state.startup.chooser.selected);
  const normalizedCurrent = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = ((normalizedCurrent + delta) % STARTUP_CHOOSER_OPTIONS.length + STARTUP_CHOOSER_OPTIONS.length)
    % STARTUP_CHOOSER_OPTIONS.length;

  return {
    ...state,
    startup: {
      ...state.startup,
      chooser: {
        ...state.startup.chooser,
        selected: STARTUP_CHOOSER_OPTIONS[nextIndex],
      },
    },
  };
}

export function setStartupWarning(state: TuiState, warning: string | null): TuiState {
  if (state.startup.warning === warning) {
    return state;
  }

  return {
    ...state,
    startup: {
      ...state.startup,
      warning,
    },
  };
}

const DEFAULT_COMMAND_PALETTE_ACTIONS: ReadonlyArray<CommandPaletteAction> = [
  {
    id: 'focus-next-pane',
    label: 'focus next pane',
    group: 'global',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['tab', 'focus', 'pane', 'next'],
    kind: 'builtin',
  },
  {
    id: 'focus-previous-pane',
    label: 'focus previous pane',
    group: 'global',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['shift', 'tab', 'focus', 'pane', 'prev'],
    kind: 'builtin',
  },
  {
    id: 'jump-input-pane',
    label: 'jump to input pane',
    group: 'global',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['input', 'composer', 'focus'],
    kind: 'builtin',
  },
  {
    id: 'jump-sidebar-pane',
    label: 'jump to sidebar pane',
    group: 'global',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['sidebar', 'sessions', 'focus'],
    kind: 'builtin',
  },
  {
    id: 'jump-transcript-pane',
    label: 'jump to transcript pane',
    group: 'global',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['transcript', 'chat', 'focus'],
    kind: 'builtin',
  },
  {
    id: 'clear-input',
    label: 'clear input',
    group: 'input',
    scopes: ['input'],
    keywords: ['clear', 'reset', 'composer'],
    kind: 'builtin',
  },
  {
    id: 'scroll-transcript-down',
    label: 'scroll transcript down',
    group: 'transcript',
    scopes: ['transcript'],
    keywords: ['scroll', 'down', 'transcript'],
    kind: 'builtin',
  },
  {
    id: 'scroll-transcript-up',
    label: 'scroll transcript up',
    group: 'transcript',
    scopes: ['transcript'],
    keywords: ['scroll', 'up', 'transcript'],
    kind: 'builtin',
  },
  {
    id: 'select-next-session',
    label: 'select next session',
    group: 'sidebar',
    scopes: ['sidebar'],
    keywords: ['session', 'next', 'sidebar'],
    kind: 'builtin',
  },
  {
    id: 'select-previous-session',
    label: 'select previous session',
    group: 'sidebar',
    scopes: ['sidebar'],
    keywords: ['session', 'previous', 'sidebar'],
    kind: 'builtin',
  },
  {
    id: 'create-session',
    label: 'new session',
    group: 'sidebar',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['session', 'new', 'create'],
    kind: 'builtin',
  },
  {
    id: 'delete-session',
    label: 'delete session',
    group: 'sidebar',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['session', 'delete', 'remove'],
    kind: 'builtin',
  },
  {
    id: 'submit-input',
    label: 'submit input',
    group: 'input',
    scopes: ['input'],
    keywords: ['submit', 'send', 'input'],
    kind: 'builtin',
  },
  {
    id: 'exit',
    label: 'exit',
    group: 'global',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['exit', 'quit', 'close', 'bye'],
    kind: 'builtin',
  },
];

function createCommandPaletteActions(
  pluginSlashCommands: ReadonlyArray<PluginSlashCommandRegistration>,
): ReadonlyArray<CommandPaletteAction> {
  const pluginActions = createPluginSlashPaletteActions(pluginSlashCommands);
  return [...DEFAULT_COMMAND_PALETTE_ACTIONS, ...pluginActions];
}

function createPluginSlashPaletteActions(
  pluginSlashCommands: ReadonlyArray<PluginSlashCommandRegistration>,
): ReadonlyArray<CommandPaletteAction> {
  if (pluginSlashCommands.length === 0) {
    return [];
  }

  const byCommandId = new Map<string, string[]>();
  for (const command of pluginSlashCommands) {
    const peers = byCommandId.get(command.commandId) ?? [];
    peers.push(command.pluginId);
    byCommandId.set(command.commandId, peers);
  }

  return pluginSlashCommands
    .map((command) => {
      const canonicalName = `/${command.pluginId}:${command.commandId}`;
      const collidingPlugins = (byCommandId.get(command.commandId) ?? [])
        .filter((pluginId) => pluginId !== command.pluginId)
        .sort((left, right) => left.localeCompare(right));
      const hasCollision = collidingPlugins.length > 0;
      const usageHint = command.usage && command.usage.trim().length > 0
        ? command.usage.trim()
        : canonicalName;

      const collisionLabel = hasCollision
        ? ` [collision: ${[command.pluginId, ...collidingPlugins].join(', ')}]`
        : '';

      return {
        id: `plugin-slash:${command.pluginId}:${command.commandId}`,
        label: `${canonicalName} - ${command.summary}${collisionLabel}`,
        group: 'input' as const,
        scopes: ['sidebar', 'transcript', 'input'] as const,
        keywords: [canonicalName, command.commandId, command.pluginId],
        kind: 'plugin-slash' as const,
        plugin: {
          pluginId: command.pluginId,
          commandId: command.commandId,
          canonicalName,
          usageHint,
          available: command.available ?? true,
          hasCollision,
          collisionWith: collidingPlugins,
        },
      } satisfies CommandPaletteAction;
    })
    .filter((action) => action.plugin?.available === true)
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function getFilteredPaletteActions(
  actions: ReadonlyArray<CommandPaletteAction>,
  query: string,
  scope: CommandPaletteScope,
): ReadonlyArray<CommandPaletteAction> {
  const normalizedQuery = query.trim().toLowerCase();

  const scoped = actions.filter((action) => action.scopes.includes(scope));
  const ranked = scoped.map((action, index) => {
    const searchTarget = action.kind === 'plugin-slash'
      ? action.plugin?.canonicalName ?? action.label
      : action.label;
    const haystack = [searchTarget, action.id, ...(action.keywords ?? [])].join(' ').toLowerCase();
    const startsWithScore = normalizedQuery.length > 0 && searchTarget.toLowerCase().startsWith(normalizedQuery) ? 2 : 0;
    const containsScore = normalizedQuery.length > 0 && haystack.includes(normalizedQuery) ? 1 : 0;
    const score = normalizedQuery.length === 0 ? 0 : startsWithScore + containsScore;
    return { action, index, score, matches: normalizedQuery.length === 0 || containsScore > 0 || startsWithScore > 0 };
  });

  return ranked
    .filter((entry) => entry.matches)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      const leftRank = left.action.kind === 'plugin-slash' ? 1 : 0;
      const rightRank = right.action.kind === 'plugin-slash' ? 1 : 0;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      const nameOrder = left.action.label.localeCompare(right.action.label);
      if (nameOrder !== 0) {
        return nameOrder;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.action);
}

function getSlashSearchState(state: TuiState, text: string): TuiState['input']['slashSearch'] {
  const trimmedStart = text.trimStart();
  if (!trimmedStart.startsWith('/')) {
    return {
      isActive: false,
      query: '',
      selectedIndex: 0,
      filteredActions: [],
    };
  }

  const normalizedQuery = trimmedStart.slice(1);
  const filteredActions = getFilteredPaletteActions(state.commandPalette.actions, normalizedQuery, 'input');
  return {
    isActive: true,
    query: normalizedQuery,
    selectedIndex: 0,
    filteredActions,
  };
}

export function getSelectedSlashSearchAction(state: TuiState): CommandPaletteAction | null {
  if (!state.input.slashSearch.isActive) {
    return null;
  }
  return state.input.slashSearch.filteredActions[state.input.slashSearch.selectedIndex] ?? null;
}

export function moveSlashSearchSelection(state: TuiState, delta: number): TuiState {
  if (!state.input.slashSearch.isActive) {
    return state;
  }

  const count = state.input.slashSearch.filteredActions.length;
  if (count === 0) {
    return {
      ...state,
      input: {
        ...state.input,
        slashSearch: {
          ...state.input.slashSearch,
          selectedIndex: 0,
        },
      },
    };
  }

  const normalized = ((state.input.slashSearch.selectedIndex + delta) % count + count) % count;
  return {
    ...state,
    input: {
      ...state.input,
      slashSearch: {
        ...state.input.slashSearch,
        selectedIndex: normalized,
      },
    },
  };
}

function withCommandPaletteState(
  state: TuiState,
  updates: Partial<CommandPaletteState>,
): CommandPaletteState {
  return {
    ...state.commandPalette,
    ...updates,
  };
}

export function openCommandPalette(state: TuiState): TuiState {
  const scope = state.focusedPane;
  const filteredActions = getFilteredPaletteActions(state.commandPalette.actions, '', scope);

  return {
    ...state,
    commandPalette: withCommandPaletteState(state, {
      isOpen: true,
      query: '',
      selectedIndex: 0,
      scope,
      filteredActions,
    }),
  };
}

export function closeCommandPalette(state: TuiState): TuiState {
  const scope = state.focusedPane;

  return {
    ...state,
    commandPalette: withCommandPaletteState(state, {
      isOpen: false,
      query: '',
      selectedIndex: 0,
      scope,
      filteredActions: getFilteredPaletteActions(state.commandPalette.actions, '', scope),
    }),
  };
}

export function toggleCommandPalette(state: TuiState): TuiState {
  return state.commandPalette.isOpen ? closeCommandPalette(state) : openCommandPalette(state);
}

export function toggleHelpModal(state: TuiState): TuiState {
  return {
    ...state,
    helpModal: {
      isOpen: !state.helpModal.isOpen,
    },
  };
}

export function updateCommandPaletteQuery(state: TuiState, query: string): TuiState {
  const filteredActions = getFilteredPaletteActions(
    state.commandPalette.actions,
    query,
    state.commandPalette.scope,
  );

  return {
    ...state,
    commandPalette: withCommandPaletteState(state, {
      query,
      selectedIndex: Math.max(0, Math.min(state.commandPalette.selectedIndex, Math.max(0, filteredActions.length - 1))),
      filteredActions,
    }),
  };
}

export function moveCommandPaletteSelection(state: TuiState, delta: number): TuiState {
  const count = state.commandPalette.filteredActions.length;
  if (count === 0) {
    return {
      ...state,
      commandPalette: withCommandPaletteState(state, { selectedIndex: 0 }),
    };
  }

  const normalized = ((state.commandPalette.selectedIndex + delta) % count + count) % count;
  return {
    ...state,
    commandPalette: withCommandPaletteState(state, { selectedIndex: normalized }),
  };
}

export function getSelectedCommandPaletteAction(state: TuiState): CommandPaletteAction | null {
  const selected = state.commandPalette.filteredActions[state.commandPalette.selectedIndex];
  return selected ?? null;
}

/**
 * Focus navigation helpers
 */
const FOCUSABLE_PANES: FocusablePaneId[] = ['sidebar', 'transcript', 'input'];

export type FocusCycleOptions = {
  includeSidebar?: boolean;
};

function getFocusablePanes(options?: FocusCycleOptions): FocusablePaneId[] {
  if (options?.includeSidebar === false) {
    return ['transcript', 'input'];
  }
  return FOCUSABLE_PANES;
}

/**
 * Get next focusable pane with wraparound
 */
export function nextFocusablePane(current: FocusablePaneId, options?: FocusCycleOptions): FocusablePaneId {
  const focusablePanes = getFocusablePanes(options);
  const currentIndex = focusablePanes.indexOf(current);
  if (currentIndex < 0) {
    return focusablePanes[0] ?? 'input';
  }
  const nextIndex = (currentIndex + 1) % focusablePanes.length;
  return focusablePanes[nextIndex] ?? 'input';
}

/**
 * Get previous focusable pane with wraparound
 */
export function prevFocusablePane(current: FocusablePaneId, options?: FocusCycleOptions): FocusablePaneId {
  const focusablePanes = getFocusablePanes(options);
  const currentIndex = focusablePanes.indexOf(current);
  if (currentIndex < 0) {
    return focusablePanes[focusablePanes.length - 1] ?? 'input';
  }
  const prevIndex = currentIndex === 0 ? focusablePanes.length - 1 : currentIndex - 1;
  return focusablePanes[prevIndex] ?? 'input';
}

/**
 * Apply focus change to state
 */
export function setFocusedPane(state: TuiState, pane: FocusablePaneId): TuiState {
  const resolvedPane = pane === 'sidebar' && !state.sidebar.isVisible
    ? (state.transcript ? 'transcript' : 'input')
    : pane;
  const nextScope = state.commandPalette.isOpen ? resolvedPane : state.commandPalette.scope;
  const filteredActions = state.commandPalette.isOpen
    ? getFilteredPaletteActions(state.commandPalette.actions, state.commandPalette.query, resolvedPane)
    : state.commandPalette.filteredActions;

  return {
    ...state,
    focusedPane: resolvedPane,
    commandPalette: withCommandPaletteState(state, {
      scope: nextScope,
      filteredActions,
      selectedIndex: 0,
    }),
  };
}

export type SidebarSectionKey = 'sessions' | 'metadata';

export function toggleSidebarVisibility(state: TuiState): TuiState {
  const nextVisible = !state.sidebar.isVisible;
  const nextState: TuiState = {
    ...state,
    sidebar: {
      ...state.sidebar,
      isVisible: nextVisible,
    },
  };

  if (!nextVisible && state.focusedPane === 'sidebar') {
    return setFocusedPane(nextState, 'transcript');
  }

  return nextState;
}

export function toggleSidebarSection(state: TuiState, section: SidebarSectionKey): TuiState {
  if (section === 'sessions') {
    return {
      ...state,
      sidebar: {
        ...state.sidebar,
        sections: {
          ...state.sidebar.sections,
          sessionsCollapsed: !state.sidebar.sections.sessionsCollapsed,
        },
      },
    };
  }

  return {
    ...state,
    sidebar: {
      ...state.sidebar,
      sections: {
        ...state.sidebar.sections,
        metadataCollapsed: !state.sidebar.sections.metadataCollapsed,
      },
    },
  };
}

/**
 * Scroll transcript viewport
 */
export function scrollTranscript(state: TuiState, delta: number): TuiState {
  const { scrollOffset, totalLines, visibleLines } = state.transcript.viewport;
  const maxOffset = Math.max(0, totalLines - visibleLines);

  const newOffset = Math.max(0, Math.min(maxOffset, scrollOffset + delta));
  const pinnedToBottom = newOffset >= maxOffset;

  const nextState: TuiState = {
    ...state,
    transcript: {
      ...state.transcript,
      viewport: {
        ...state.transcript.viewport,
        scrollOffset: newOffset,
        pinnedToBottom,
      },
    },
  };

  if (pinnedToBottom && state.sessions.selectedId) {
    return updateSessionUnread(nextState, state.sessions.selectedId, false);
  }

  return nextState;
}

function countMessageLines(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, message) => {
    const roleLines = 1;
    const contentLines = Math.max(1, message.content.split('\n').length);
    const spacerLines = 1;
    return total + roleLines + contentLines + spacerLines;
  }, 0);
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const deriveSessionTitleFromMessages = (
  messages: Array<{ role: string; content: string }>
): string | null => {
  const firstUser = messages.find((message) => message.role === 'user');
  if (!firstUser) return null;
  const normalized = normalizeWhitespace(firstUser.content);
  if (!normalized) return null;
  return truncateText(normalized, 60);
};

const deriveSessionPreviewFromMessages = (
  messages: Array<{ role: string; content: string }>
): string | null => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const normalized = normalizeWhitespace(message.content);
    if (!normalized) continue;
    return truncateText(normalized, 120);
  }
  return null;
};

export function createTranscriptState(
  messages: Array<{ role: string; content: string }>,
  visibleLines: number,
  pinnedToBottom = true
): SessionTranscript {
  const totalLines = countMessageLines(messages);
  const clampedVisible = Math.max(1, visibleLines);
  const maxOffset = Math.max(0, totalLines - clampedVisible);
  const scrollOffset = pinnedToBottom ? maxOffset : 0;

  return {
    messages,
    viewport: {
      scrollOffset,
      totalLines,
      visibleLines: clampedVisible,
      pinnedToBottom,
    },
  };
}

function updateTranscriptViewport(
  transcript: SessionTranscript,
  options: { pinnedToBottom?: boolean } = {}
): SessionTranscript {
  const totalLines = countMessageLines(transcript.messages);
  const visibleLines = Math.max(1, transcript.viewport.visibleLines);
  const maxOffset = Math.max(0, totalLines - visibleLines);
  const pinnedToBottom = options.pinnedToBottom ?? transcript.viewport.pinnedToBottom;
  const scrollOffset = pinnedToBottom
    ? maxOffset
    : Math.max(0, Math.min(transcript.viewport.scrollOffset, maxOffset));

  return {
    ...transcript,
    viewport: {
      ...transcript.viewport,
      totalLines,
      scrollOffset,
      pinnedToBottom,
    },
  };
}

function sortSessions(items: SessionListItem[]): SessionListItem[] {
  const getUpdatedAtMs = (item: SessionListItem): number => {
    const updatedAt = item.updatedAt;
    if (updatedAt instanceof Date) {
      const value = updatedAt.getTime();
      return Number.isFinite(value) ? value : 0;
    }

    const parsed = new Date(updatedAt as unknown as string | number | Date).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };

  return [...items].sort((left, right) => getUpdatedAtMs(right) - getUpdatedAtMs(left));
}

function getSelectedSessionIndex(items: SessionListItem[], selectedId: string | null): number {
  if (!selectedId) return 0;
  const index = items.findIndex((item) => item.id === selectedId);
  return index >= 0 ? index : 0;
}

function getSidebarSelectedIndex(
  items: SessionListItem[],
  selectedId: string | null,
  hasNewSessionAction: boolean,
): number {
  if (hasNewSessionAction) {
    if (!selectedId) return 0;
    const index = items.findIndex((item) => item.id === selectedId);
    return index >= 0 ? index + 1 : 0;
  }
  return getSelectedSessionIndex(items, selectedId);
}

function setSidebarSelectedIndex(state: TuiState, index: number): TuiState {
  const maxIndex = state.sidebar.hasNewSessionAction
    ? state.sessions.items.length
    : Math.max(0, state.sessions.items.length - 1);
  const clamped = Math.max(0, Math.min(index, maxIndex));

  if (clamped === state.sidebar.selectedIndex) {
    return state;
  }

  return {
    ...state,
    sidebar: {
      ...state.sidebar,
      selectedIndex: clamped,
    },
  };
}

function updateSessionItem(
  state: TuiState,
  sessionId: string,
  updater: (item: SessionListItem) => SessionListItem
): TuiState {
  const items = state.sessions.items;
  const index = items.findIndex((item) => item.id === sessionId);
  if (index < 0) return state;

  const updated = updater(items[index]);
  const nextItems = sortSessions([
    ...items.filter((item) => item.id !== sessionId),
    updated,
  ]);
  const selectedIndex = getSidebarSelectedIndex(
    nextItems,
    state.sessions.selectedId,
    state.sidebar.hasNewSessionAction,
  );

  return {
    ...state,
    sessions: {
      ...state.sessions,
      items: nextItems,
    },
    sidebar: {
      ...state.sidebar,
      selectedIndex,
    },
  };
}

function updateSessionUnread(state: TuiState, sessionId: string, unread: boolean): TuiState {
  return updateSessionItem(state, sessionId, (item) => ({
    ...item,
    unread,
  }));
}

function updateSessionFromTranscript(
  state: TuiState,
  sessionId: string,
  transcript: SessionTranscript,
  nowMs: number,
  unread: boolean
): TuiState {
  return updateSessionItem(state, sessionId, (item) => {
    const derivedTitle = item.title ?? deriveSessionTitleFromMessages(transcript.messages);
    return {
      ...item,
      title: derivedTitle ?? item.title,
      updatedAt: new Date(nowMs),
      messageCount: transcript.messages.length,
      preview: deriveSessionPreviewFromMessages(transcript.messages) ?? item.preview,
      unread,
    };
  });
}

function getStreamRate(streamStartMs: number | null, outputTokenCount: number, nowMs: number): number {
  if (streamStartMs === null || outputTokenCount <= 0) {
    return 0;
  }

  const elapsedMs = Math.max(1, nowMs - streamStartMs);
  return (outputTokenCount * 1000) / elapsedMs;
}

export function startStreaming(state: TuiState, nowMs = Date.now()): TuiState {
  const sessionId = state.sessions.selectedId;
  return {
    ...state,
    streaming: {
      isStreaming: true,
      waitingForFirstToken: true,
      streamStartMs: nowMs,
      firstTokenLatencyMs: null,
      outputTokenCount: 0,
      tokensPerSecond: 0,
      lastError: null,
      sessionId,
    },
  };
}

export function appendAssistant(
  state: TuiState,
  tokenText: string,
  tokenCount = 1,
  nowMs = Date.now(),
): TuiState {
  if (!tokenText) {
    return state;
  }

  const sessionId = state.streaming.sessionId ?? state.sessions.selectedId;
  if (!sessionId) {
    const messages = [...state.transcript.messages];
    const lastMessage = messages[messages.length - 1];

    if (lastMessage?.role === 'assistant') {
      messages[messages.length - 1] = {
        ...lastMessage,
        content: lastMessage.content + tokenText,
      };
    } else {
      messages.push({ role: 'assistant', content: tokenText });
    }

    const transcript = updateTranscriptViewport({
      ...state.transcript,
      messages,
    });

    return {
      ...state,
      transcript,
      streaming: state.streaming.isStreaming
        ? {
            ...state.streaming,
            waitingForFirstToken: false,
            firstTokenLatencyMs: state.streaming.firstTokenLatencyMs ?? (
              state.streaming.streamStartMs !== null
                ? Math.max(0, nowMs - state.streaming.streamStartMs)
                : null
            ),
            outputTokenCount: state.streaming.outputTokenCount + Math.max(0, tokenCount),
            tokensPerSecond: getStreamRate(state.streaming.streamStartMs, state.streaming.outputTokenCount + Math.max(0, tokenCount), nowMs),
          }
        : state.streaming,
    };
  }

  const currentTranscript = state.sessions.transcripts[sessionId]
    ?? createTranscriptState([], state.transcript.viewport.visibleLines, true);
  const messages = [...currentTranscript.messages];
  const lastMessage = messages[messages.length - 1];

  if (lastMessage?.role === 'assistant') {
    messages[messages.length - 1] = {
      ...lastMessage,
      content: lastMessage.content + tokenText,
    };
  } else {
    messages.push({ role: 'assistant', content: tokenText });
  }

  const nextTranscript = updateTranscriptViewport({
    ...currentTranscript,
    messages,
  });

  const updatedTranscripts = {
    ...state.sessions.transcripts,
    [sessionId]: nextTranscript,
  };

  const transcript = sessionId === state.sessions.selectedId
    ? nextTranscript
    : state.transcript;

  const nextOutputTokenCount = state.streaming.isStreaming
    ? state.streaming.outputTokenCount + Math.max(0, tokenCount)
    : state.streaming.outputTokenCount;
  const firstTokenLatencyMs = state.streaming.isStreaming
    ? (state.streaming.firstTokenLatencyMs ?? (
        state.streaming.streamStartMs !== null
          ? Math.max(0, nowMs - state.streaming.streamStartMs)
          : null
      ))
    : state.streaming.firstTokenLatencyMs;

  const unread = sessionId !== state.sessions.selectedId || !nextTranscript.viewport.pinnedToBottom;
  const nextState = updateSessionFromTranscript(
    {
      ...state,
      transcript,
      sessions: {
        ...state.sessions,
        transcripts: updatedTranscripts,
      },
      streaming: state.streaming.isStreaming
        ? {
            ...state.streaming,
            isStreaming: true,
            waitingForFirstToken: false,
            firstTokenLatencyMs,
            outputTokenCount: nextOutputTokenCount,
            tokensPerSecond: getStreamRate(state.streaming.streamStartMs, nextOutputTokenCount, nowMs),
            sessionId,
          }
        : {
            ...state.streaming,
            sessionId,
          },
    },
    sessionId,
    nextTranscript,
    nowMs,
    unread,
  );

  if (sessionId === nextState.sessions.selectedId && nextTranscript.viewport.pinnedToBottom) {
    return updateSessionUnread(nextState, sessionId, false);
  }

  return nextState;
}

export function finishStreaming(state: TuiState, nowMs = Date.now()): TuiState {
  return {
    ...state,
    streaming: {
      ...state.streaming,
      isStreaming: false,
      waitingForFirstToken: false,
      tokensPerSecond: getStreamRate(state.streaming.streamStartMs, state.streaming.outputTokenCount, nowMs),
      sessionId: state.streaming.sessionId,
    },
  };
}

export function recordStreamingError(state: TuiState, error: string, nowMs = Date.now()): TuiState {
  return {
    ...state,
    streaming: {
      ...state.streaming,
      isStreaming: false,
      waitingForFirstToken: false,
      lastError: error,
      tokensPerSecond: getStreamRate(state.streaming.streamStartMs, state.streaming.outputTokenCount, nowMs),
      sessionId: state.streaming.sessionId,
    },
  };
}

export function setSystemNotice(state: TuiState, notice: string | null): TuiState {
  return { ...state, systemNotice: notice?.trim() || null };
}

export function appendUserMessage(state: TuiState, content: string, nowMs = Date.now()): TuiState {
  if (!content.trim()) {
    return state;
  }

  const sessionId = state.sessions.selectedId;
  if (!sessionId) {
    const nextTranscript = updateTranscriptViewport({
      ...state.transcript,
      messages: [...state.transcript.messages, { role: 'user', content }],
    }, { pinnedToBottom: true });
    return {
      ...state,
      transcript: nextTranscript,
    };
  }

  const currentTranscript = state.sessions.transcripts[sessionId]
    ?? createTranscriptState([], state.transcript.viewport.visibleLines, true);
  const nextTranscript = updateTranscriptViewport({
    ...currentTranscript,
    messages: [...currentTranscript.messages, { role: 'user', content }],
  }, { pinnedToBottom: true });

  const updatedTranscripts = {
    ...state.sessions.transcripts,
    [sessionId]: nextTranscript,
  };

  const nextState = updateSessionFromTranscript(
    {
      ...state,
      transcript: nextTranscript,
      sessions: {
        ...state.sessions,
        transcripts: updatedTranscripts,
      },
    },
    sessionId,
    nextTranscript,
    nowMs,
    false,
  );

  return updateSessionUnread(nextState, sessionId, false);
}

/**
 * Update input text and cursor position
 */
export function updateInputText(state: TuiState, text: string, cursorPosition?: number): TuiState {
  const slashSearch = getSlashSearchState(state, text);

  if (state.sessions.selectedId) {
    return {
      ...state,
      input: {
        ...state.input,
        text,
        cursorPosition: cursorPosition ?? text.length,
        slashSearch,
      },
      sessions: {
        ...state.sessions,
        drafts: {
          ...state.sessions.drafts,
          [state.sessions.selectedId]: text,
        },
      },
    };
  }

  return {
    ...state,
    input: {
      ...state.input,
      text,
      cursorPosition: cursorPosition ?? text.length,
      slashSearch,
    },
  };
}

/**
 * Navigate input history (Up/Down when input is empty or already navigating history)
 */
export function navigateInputHistory(state: TuiState, direction: 'up' | 'down'): TuiState {
  const { history, text } = state.input;

  if (history.entries.length === 0) {
    return state;
  }

  // Allow history navigation if:
  // 1. Input is empty, OR
  // 2. We're already navigating history (currentIndex !== -1)
  const isNavigatingHistory = history.currentIndex !== -1;
  const textIsEmpty = text.length === 0;

  if (!isNavigatingHistory && !textIsEmpty) {
    return state;
  }

  let newIndex: number;
  if (direction === 'up') {
    // Go back in history (older)
    newIndex = history.currentIndex === -1
      ? history.entries.length - 1
      : Math.max(0, history.currentIndex - 1);
  } else {
    // Go forward in history (newer)
    if (history.currentIndex === -1) {
      return state;
    }
    newIndex = history.currentIndex + 1;
    if (newIndex >= history.entries.length) {
      // Return to empty input
      return {
        ...state,
        input: {
          ...state.input,
          text: '',
          cursorPosition: 0,
          slashSearch: getSlashSearchState(state, ''),
          history: {
            ...history,
            currentIndex: -1,
          },
        },
      };
    }
  }

  const historyText = history.entries[newIndex];
  return {
    ...state,
    input: {
      ...state.input,
      text: historyText,
      cursorPosition: historyText.length,
      slashSearch: getSlashSearchState(state, historyText),
      history: {
        ...history,
        currentIndex: newIndex,
      },
    },
  };
}

/**
 * Submit the current input: clears input, resets cursor, adds to history
 * Returns both the new state and the submitted text
 */
export function submitInput(state: TuiState): { state: TuiState; submittedText: string } {
  const text = state.input.text;
  if (!text.trim()) {
    return { state, submittedText: '' };
  }

  const newState: TuiState = {
    ...state,
    input: {
      ...state.input,
      text: '',
      cursorPosition: 0,
      slashSearch: getSlashSearchState(state, ''),
      history: {
        entries: [...state.input.history.entries, text],
        currentIndex: -1,
      },
    },
    sessions: state.sessions.selectedId
      ? {
          ...state.sessions,
          drafts: {
            ...state.sessions.drafts,
            [state.sessions.selectedId]: '',
          },
        }
      : state.sessions,
  };
  return { state: newState, submittedText: text };
}

/**
 * Generate a unique ID for pending submissions
 */
function generatePendingSubmissionId(): string {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Queue a pending submission when streaming is active.
 * Clears input immediately and returns the queued entry.
 */
export function queuePendingSubmission(
  state: TuiState,
  text: string,
  nowMs = Date.now(),
): { state: TuiState; entry: PendingSubmission | null } {
  if (!text.trim()) {
    return { state, entry: null };
  }

  const entry: PendingSubmission = {
    id: generatePendingSubmissionId(),
    text,
    createdAt: nowMs,
  };

  const newState: TuiState = {
    ...state,
    input: {
      ...state.input,
      text: '',
      cursorPosition: 0,
      slashSearch: getSlashSearchState(state, ''),
      history: {
        entries: [...state.input.history.entries, text],
        currentIndex: -1,
      },
      pendingSubmissions: [...state.input.pendingSubmissions, entry],
    },
    sessions: state.sessions.selectedId
      ? {
          ...state.sessions,
          drafts: {
            ...state.sessions.drafts,
            [state.sessions.selectedId]: '',
          },
        }
      : state.sessions,
  };

  return { state: newState, entry };
}

/**
 * Dequeue the head pending submission (FIFO).
 * Returns the new state and the dequeued entry (or null if empty).
 */
export function dequeuePendingSubmission(state: TuiState): {
  state: TuiState;
  entry: PendingSubmission | null;
} {
  const pending = state.input.pendingSubmissions;
  if (pending.length === 0) {
    return { state, entry: null };
  }

  const [head, ...rest] = pending;
  return {
    state: {
      ...state,
      input: {
        ...state.input,
        pendingSubmissions: rest,
      },
    },
    entry: head,
  };
}

/**
 * Check if there are any pending submissions in the queue.
 */
export function hasPendingSubmissions(state: TuiState): boolean {
  return state.input.pendingSubmissions.length > 0;
}

/**
 * Get the head pending submission without removing it.
 */
export function getHeadPendingSubmission(state: TuiState): PendingSubmission | null {
  return state.input.pendingSubmissions[0] ?? null;
}

/**
 * Remove character before cursor (backspace behavior)
 */
export function backspaceAtCursor(state: TuiState): TuiState {
  const { text, cursorPosition } = state.input;
  if (cursorPosition === 0) {
    return state;
  }
  const newText = text.slice(0, cursorPosition - 1) + text.slice(cursorPosition);
  return updateInputText(state, newText, cursorPosition - 1);
}

/**
 * Remove character at cursor position (delete key behavior)
 */
export function deleteAtCursor(state: TuiState): TuiState {
  const { text, cursorPosition } = state.input;
  if (cursorPosition >= text.length) {
    return state;
  }
  const newText = text.slice(0, cursorPosition) + text.slice(cursorPosition + 1);
  return updateInputText(state, newText, cursorPosition);
}

/**
 * Add entry to input history
 */
export function addToInputHistory(state: TuiState, entry: string): TuiState {
  if (!entry.trim()) {
    return state;
  }

  return {
    ...state,
    input: {
      ...state.input,
      history: {
        entries: [...state.input.history.entries, entry],
        currentIndex: -1,
      },
    },
  };
}

export function applySessionList(
  state: TuiState,
  items: SessionListItem[],
  selectedId?: string | null
): TuiState {
  const sorted = sortSessions(items);
  const resolvedSelected = selectedId ?? state.sessions.selectedId ?? sorted[0]?.id ?? null;
  const selectedIndex = getSidebarSelectedIndex(sorted, resolvedSelected, state.sidebar.hasNewSessionAction);

  const nextTranscripts = { ...state.sessions.transcripts };
  for (const item of sorted) {
    if (!nextTranscripts[item.id]) {
      nextTranscripts[item.id] = createTranscriptState([], state.transcript.viewport.visibleLines, true);
    }
  }

  const transcript = resolvedSelected && nextTranscripts[resolvedSelected]
    ? nextTranscripts[resolvedSelected]
    : state.transcript;

  const nextDrafts = resolvedSelected && state.sessions.selectedId && state.sessions.selectedId !== resolvedSelected
    ? {
        ...state.sessions.drafts,
        [state.sessions.selectedId]: state.input.text,
      }
    : state.sessions.drafts;
  const nextInputText = resolvedSelected
    ? (nextDrafts[resolvedSelected] ?? '')
    : (state.sessions.selectedId ? state.sessions.drafts[state.sessions.selectedId] ?? '' : state.input.text);
  const nextCursor = nextInputText.length;

  return {
    ...state,
    transcript,
    input: {
      ...state.input,
      text: nextInputText,
      cursorPosition: nextCursor,
      slashSearch: getSlashSearchState(state, nextInputText),
      history: {
        ...state.input.history,
        currentIndex: -1,
      },
    },
    sessions: {
      ...state.sessions,
      items: sorted,
      selectedId: resolvedSelected,
      drafts: nextDrafts,
      transcripts: nextTranscripts,
    },
    sidebar: {
      ...state.sidebar,
      selectedIndex,
    },
  };
}

export function openDeleteConfirm(state: TuiState, sessionId: string | null): TuiState {
  if (!sessionId) {
    return state;
  }

  const session = state.sessions.items.find((item) => item.id === sessionId);
  if (!session) {
    return state;
  }

  return {
    ...state,
    deleteConfirm: {
      isOpen: true,
      sessionId,
      title: session.title ?? null,
    },
  };
}

export function closeDeleteConfirm(state: TuiState): TuiState {
  if (!state.deleteConfirm.isOpen) {
    return state;
  }

  return {
    ...state,
    deleteConfirm: {
      isOpen: false,
      sessionId: null,
      title: null,
    },
  };
}

export function applySessionDeletion(
  state: TuiState,
  items: SessionListItem[],
  options: { selectedId: string | null }
): TuiState {
  const sorted = sortSessions(items);
  const remainingIds = new Set(sorted.map((item) => item.id));
  const resolvedSelected = options.selectedId && remainingIds.has(options.selectedId)
    ? options.selectedId
    : sorted[0]?.id ?? null;

  const nextDrafts: Record<string, string> = {};
  for (const [id, draft] of Object.entries(state.sessions.drafts)) {
    if (remainingIds.has(id)) {
      nextDrafts[id] = draft;
    }
  }

  const nextTranscripts: Record<string, SessionTranscript> = {};
  for (const item of sorted) {
    nextTranscripts[item.id] = state.sessions.transcripts[item.id]
      ?? createTranscriptState([], state.transcript.viewport.visibleLines, true);
  }

  let transcript = state.transcript;
  if (resolvedSelected) {
    const selectedTranscript = nextTranscripts[resolvedSelected]
      ?? createTranscriptState([], state.transcript.viewport.visibleLines, true);
    transcript = updateTranscriptViewport(selectedTranscript, { pinnedToBottom: true });
    nextTranscripts[resolvedSelected] = transcript;
  } else {
    transcript = createTranscriptState([], state.transcript.viewport.visibleLines, true);
  }

  const inputText = resolvedSelected ? (nextDrafts[resolvedSelected] ?? '') : '';
  const cursorPosition = inputText.length;
  const normalizedItems = sorted.map((item) => (
    item.id === resolvedSelected ? { ...item, unread: false } : item
  ));

  return {
    ...state,
    transcript,
    input: {
      ...state.input,
      text: inputText,
      cursorPosition,
      slashSearch: getSlashSearchState(state, inputText),
      history: {
        ...state.input.history,
        currentIndex: -1,
      },
    },
    sessions: {
      ...state.sessions,
      items: normalizedItems,
      selectedId: resolvedSelected,
      drafts: nextDrafts,
      transcripts: nextTranscripts,
    },
    sidebar: {
      ...state.sidebar,
      selectedIndex: getSidebarSelectedIndex(normalizedItems, resolvedSelected, state.sidebar.hasNewSessionAction),
    },
  };
}

export function addSession(state: TuiState, item: SessionListItem, options: { select?: boolean } = {}): TuiState {
  const nextItems = sortSessions([
    ...state.sessions.items.filter((existing) => existing.id !== item.id),
    item,
  ]);
  const shouldSelect = options.select ?? true;
  const nextSelected = shouldSelect ? item.id : state.sessions.selectedId;
  const selectedIndex = getSidebarSelectedIndex(nextItems, nextSelected, state.sidebar.hasNewSessionAction);

  const nextTranscripts = state.sessions.transcripts[item.id]
    ? state.sessions.transcripts
    : {
        ...state.sessions.transcripts,
        [item.id]: createTranscriptState([], state.transcript.viewport.visibleLines, true),
      };

  const transcript = nextSelected && nextTranscripts[nextSelected]
    ? nextTranscripts[nextSelected]
    : state.transcript;

  const nextDrafts = shouldSelect && state.sessions.selectedId
    ? {
        ...state.sessions.drafts,
        [state.sessions.selectedId]: state.input.text,
      }
    : state.sessions.drafts;
  const nextInputText = shouldSelect ? (nextDrafts[nextSelected ?? ''] ?? '') : state.input.text;
  const nextCursor = shouldSelect ? nextInputText.length : state.input.cursorPosition;

  return {
    ...state,
    transcript,
    input: {
      ...state.input,
      text: nextInputText,
      cursorPosition: nextCursor,
      slashSearch: getSlashSearchState(state, nextInputText),
      history: shouldSelect
        ? {
            ...state.input.history,
            currentIndex: -1,
          }
        : state.input.history,
    },
    sessions: {
      ...state.sessions,
      items: nextItems,
      selectedId: nextSelected,
      drafts: nextDrafts,
      transcripts: nextTranscripts,
    },
    sidebar: {
      ...state.sidebar,
      selectedIndex,
    },
  };
}

export function selectNextSession(state: TuiState): TuiState {
  if (state.sessions.items.length === 0) return state;
  const maxIndex = state.sessions.items.length - 1;
  if (state.sidebar.hasNewSessionAction) {
    if (state.sidebar.selectedIndex === 0) {
      const nextId = state.sessions.items[0]?.id ?? null;
      if (!nextId || nextId === state.sessions.selectedId) {
        return setSidebarSelectedIndex(state, 1);
      }
      return switchSession(state, nextId);
    }
    const baseIndex = Math.min(maxIndex + 1, state.sidebar.selectedIndex + 1);
    const nextIndex = baseIndex - 1;
    const nextId = state.sessions.items[nextIndex]?.id ?? null;
    return switchSession(state, nextId);
  }
  const nextIndex = Math.min(maxIndex, state.sidebar.selectedIndex + 1);
  const nextId = state.sessions.items[nextIndex]?.id ?? null;
  return switchSession(state, nextId);
}

export function selectPreviousSession(state: TuiState): TuiState {
  if (state.sessions.items.length === 0) return state;
  if (state.sidebar.hasNewSessionAction) {
    if (state.sidebar.selectedIndex === 1) {
      return setSidebarSelectedIndex(state, 0);
    }
    if (state.sidebar.selectedIndex === 0) {
      return state;
    }
    const baseIndex = Math.max(0, state.sidebar.selectedIndex - 1);
    const nextIndex = baseIndex - 1;
    const nextId = state.sessions.items[nextIndex]?.id ?? null;
    return switchSession(state, nextId);
  }
  const nextIndex = Math.max(0, state.sidebar.selectedIndex - 1);
  const nextId = state.sessions.items[nextIndex]?.id ?? null;
  return switchSession(state, nextId);
}

export function selectSidebarSelection(state: TuiState): TuiState {
  const items = state.sessions.items;
  if (items.length === 0) return state;
  if (state.sidebar.hasNewSessionAction && state.sidebar.selectedIndex === 0) {
    return state;
  }

  const index = state.sidebar.hasNewSessionAction
    ? Math.max(0, state.sidebar.selectedIndex - 1)
    : state.sidebar.selectedIndex;
  const nextId = items[index]?.id ?? null;
  return switchSession(state, nextId);
}

export function isNewSessionActionSelected(state: TuiState): boolean {
  return state.sidebar.hasNewSessionAction && state.sidebar.selectedIndex === 0;
}

export function switchSession(state: TuiState, sessionId: string | null): TuiState {
  if (!sessionId || sessionId === state.sessions.selectedId) {
    return state;
  }

  const nextDrafts = {
    ...state.sessions.drafts,
    ...(state.sessions.selectedId ? { [state.sessions.selectedId]: state.input.text } : {}),
  };

  const nextTranscript = state.sessions.transcripts[sessionId]
    ?? createTranscriptState([], state.transcript.viewport.visibleLines, true);
  const normalizedTranscript = updateTranscriptViewport(nextTranscript, { pinnedToBottom: true });

  const nextState: TuiState = {
    ...state,
    transcript: normalizedTranscript,
    sessions: {
      ...state.sessions,
      selectedId: sessionId,
      drafts: nextDrafts,
      transcripts: {
        ...state.sessions.transcripts,
        [sessionId]: normalizedTranscript,
      },
    },
    input: {
      ...state.input,
      text: nextDrafts[sessionId] ?? '',
      cursorPosition: (nextDrafts[sessionId] ?? '').length,
      slashSearch: getSlashSearchState(state, nextDrafts[sessionId] ?? ''),
      history: {
        ...state.input.history,
        currentIndex: -1,
      },
    },
    sidebar: {
      ...state.sidebar,
      selectedIndex: getSidebarSelectedIndex(state.sessions.items, sessionId, state.sidebar.hasNewSessionAction),
    },
  };

  return updateSessionUnread(nextState, sessionId, false);
}

export function markSessionReadIfPinned(state: TuiState): TuiState {
  const sessionId = state.sessions.selectedId;
  if (!sessionId) return state;
  if (!state.transcript.viewport.pinnedToBottom) return state;
  return updateSessionUnread(state, sessionId, false);
}

export function upsertSessionTranscript(
  state: TuiState,
  sessionId: string,
  messages: Array<{ role: string; content: string }>,
  options: { pinnedToBottom?: boolean } = {}
): TuiState {
  const existing = state.sessions.transcripts[sessionId]
    ?? createTranscriptState([], state.transcript.viewport.visibleLines, true);
  const nextTranscript = updateTranscriptViewport({
    ...existing,
    messages,
  }, { pinnedToBottom: options.pinnedToBottom });

  const nextTranscripts = {
    ...state.sessions.transcripts,
    [sessionId]: nextTranscript,
  };

  const nextState: TuiState = {
    ...state,
    transcript: sessionId === state.sessions.selectedId ? nextTranscript : state.transcript,
    sessions: {
      ...state.sessions,
      transcripts: nextTranscripts,
    },
  };

  return updateSessionFromTranscript(
    nextState,
    sessionId,
    nextTranscript,
    Date.now(),
    sessionId !== state.sessions.selectedId,
  );
}

export function setSessionDraft(state: TuiState, sessionId: string, draft: string): TuiState {
  return {
    ...state,
    sessions: {
      ...state.sessions,
      drafts: {
        ...state.sessions.drafts,
        [sessionId]: draft,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tool block state management
// ---------------------------------------------------------------------------

/**
 * Determine tool vs task kind from tool name.
 * Tools prefixed with task_, subagent_, or handoff_ are classified as tasks.
 */
function inferToolBlockKind(toolName: string): ToolBlockKind {
  if (
    toolName.startsWith('task_')
    || toolName.startsWith('subagent_')
    || toolName.startsWith('handoff_')
  ) {
    return 'task';
  }
  return 'tool';
}

/**
 * Add a new tool call to the appropriate group (creating the group if needed).
 * New blocks start as in-progress and expanded.
 */
export function addToolCall(
  state: TuiState,
  event: {
    messageId: string;
    step: number;
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    startedAt: number;
    kind?: ToolBlockKind;
  },
): TuiState {
  const kind = event.kind ?? inferToolBlockKind(event.toolName);
  const block: ToolBlockState = {
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    kind,
    status: 'in-progress',
    input: event.input,
    startedAt: event.startedAt,
    expanded: true,
  };

  const groups = [...state.toolBlocks.groups];
  const existingGroupIndex = groups.findIndex(
    (g) => g.messageId === event.messageId && g.step === event.step,
  );

  if (existingGroupIndex >= 0) {
    const existing = groups[existingGroupIndex];
    const existingBlockIndex = existing.blocks.findIndex((entry) => entry.toolCallId === event.toolCallId);

    if (existingBlockIndex >= 0) {
      const nextBlocks = [...existing.blocks];
      nextBlocks[existingBlockIndex] = {
        ...nextBlocks[existingBlockIndex],
        ...block,
      };
      groups[existingGroupIndex] = {
        ...existing,
        blocks: nextBlocks,
      };
    } else {
      groups[existingGroupIndex] = {
        ...existing,
        blocks: [...existing.blocks, block],
      };
    }
  } else {
    groups.push({
      messageId: event.messageId,
      step: event.step,
      blocks: [block],
    });
  }

  return {
    ...state,
    toolBlocks: {
      ...state.toolBlocks,
      groups,
    },
  };
}

/**
 * Complete a tool call. Smart collapse: completed without error -> collapsed,
 * errored -> expanded.
 */
export function completeToolCall(
  state: TuiState,
  event: {
    toolCallId: string;
    output: unknown;
    completedAt: number;
    durationMs: number;
    error?: { message: string };
  },
): TuiState {
  const hasError = !!event.error;
  const status: ToolBlockStatus = hasError ? 'errored' : 'completed';
  const expandOverride = state.toolBlocks.expandOverrides[event.toolCallId];

  return updateToolBlock(state, event.toolCallId, (block) => ({
    ...block,
    status,
    output: event.output,
    error: event.error,
    completedAt: event.completedAt,
    durationMs: event.durationMs,
    expanded: expandOverride ?? hasError,
  }));
}

/**
 * Fail a tool call with an error. Errored blocks stay expanded.
 */
export function failToolCall(
  state: TuiState,
  event: {
    toolCallId: string;
    error: { message: string };
    completedAt: number;
    durationMs: number;
  },
): TuiState {
  const expandOverride = state.toolBlocks.expandOverrides[event.toolCallId];

  return updateToolBlock(state, event.toolCallId, (block) => ({
    ...block,
    status: 'errored',
    error: event.error,
    completedAt: event.completedAt,
    durationMs: event.durationMs,
    expanded: expandOverride ?? true,
  }));
}

/**
 * Toggle the expanded state of a specific tool block.
 */
export function toggleToolBlockExpand(state: TuiState, toolCallId: string): TuiState {
  let nextExpanded: boolean | null = null;
  for (const group of state.toolBlocks.groups) {
    const block = group.blocks.find((entry) => entry.toolCallId === toolCallId);
    if (block) {
      nextExpanded = !block.expanded;
      break;
    }
  }

  if (nextExpanded === null) {
    return state;
  }

  const withOverride = {
    ...state,
    toolBlocks: {
      ...state.toolBlocks,
      expandOverrides: {
        ...state.toolBlocks.expandOverrides,
        [toolCallId]: nextExpanded,
      },
    },
  };

  return updateToolBlock(withOverride, toolCallId, (block) => ({
    ...block,
    expanded: nextExpanded,
  }));
}

/**
 * Get tool blocks for a given message step/group index.
 * The Nth group corresponds to tool blocks from the Nth tool-calling step.
 */
export function getToolBlocksForMessage(state: TuiState, groupIndex: number): ToolBlockState[] {
  const group = state.toolBlocks.groups[groupIndex];
  return group?.blocks ?? [];
}

/**
 * Check if any tool blocks are currently in-progress.
 */
export function hasInProgressToolBlocks(state: TuiState): boolean {
  return state.toolBlocks.groups.some((group) =>
    group.blocks.some((block) => block.status === 'in-progress'),
  );
}

/**
 * Clear all tool block state (called on new message turn start).
 */
export function clearToolBlocks(state: TuiState): TuiState {
  if (state.toolBlocks.groups.length === 0) {
    return state;
  }

  return {
    ...state,
    toolBlocks: {
      groups: [],
      expandOverrides: {},
    },
  };
}

/**
 * Internal helper: update a specific tool block by toolCallId across all groups.
 */
function updateToolBlock(
  state: TuiState,
  toolCallId: string,
  updater: (block: ToolBlockState) => ToolBlockState,
): TuiState {
  let found = false;
  const groups = state.toolBlocks.groups.map((group) => {
    const blockIndex = group.blocks.findIndex((b) => b.toolCallId === toolCallId);
    if (blockIndex < 0) return group;

    found = true;
    const blocks = [...group.blocks];
    blocks[blockIndex] = updater(blocks[blockIndex]);
    return { ...group, blocks };
  });

  if (!found) return state;

  return {
    ...state,
    toolBlocks: {
      ...state.toolBlocks,
      groups,
    },
  };
}
