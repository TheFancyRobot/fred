/**
 * Centralized TUI theme system
 *
 * Defines semantic color tokens for the TUI. All color values in app.ts
 * reference these tokens — no inline hex strings in rendering code.
 *
 * Palette: muted cool tones with subtle contrast steps between regions.
 * Transcript (surface) is slightly darker than sidebar/input (elevated).
 */

/**
 * Semantic color token groups for the TUI
 */
export interface TuiTheme {
  /** Foreground (text) colors */
  fg: {
    /** Primary text — high contrast, readable body text */
    primary: string;
    /** Secondary text — slightly dimmed, metadata and labels */
    secondary: string;
    /** Dim text — low contrast, placeholders and disabled items */
    dim: string;
  };
  /** Background colors for region separation via contrast */
  bg: {
    /** Base — outermost container / terminal background */
    base: string;
    /** Surface — transcript pane (slightly darker than elevated) */
    surface: string;
    /** Elevated — sidebar and input pane (lighter than surface) */
    elevated: string;
    /** Status — status bar background */
    status: string;
  };
  /** Accent colors for interactive and highlighted elements */
  accent: {
    /** Primary accent — focused titles, role labels, interactive highlights */
    primary: string;
    /** Focus accent — focus ring / border color (unused with borderless, kept for future) */
    focus: string;
    /** Streaming accent — streaming indicator */
    streaming: string;
  };
  /** Status indicator colors */
  status: {
    /** Success — ready state, positive confirmations */
    success: string;
    /** Info — streaming state, informational */
    info: string;
    /** Warn — warnings, caution states */
    warn: string;
    /** Error — error messages, failure states */
    error: string;
  };
  /** Message-specific semantic tokens for transcript rendering */
  message: {
    /** User message left border color */
    userBorder: string;
    /** User message background (alias for bg.base) */
    userBg: string;
    /** Assistant message background (alias for bg.surface) */
    assistantBg: string;
    /** Code block background (one step above surface) */
    codeBg: string;
    /** Thinking block text (heavily dimmed) */
    thinkingFg: string;
    /** Streaming accent foreground (warm amber) */
    streamingFg: string;
    /** Tool block tree connector color (gray) */
    toolConnector: string;
    /** Task/subagent block accent (blue) */
    taskAccent: string;
    /** Failed tool/task accent (red) */
    errorAccent: string;
  };
}

/**
 * Default TUI theme — muted cool palette
 *
 * Contrast steps:
 * - bg.base (#121417) → bg.surface (#181c21) → bg.elevated (#1f252b)
 * - Each step is 1-2 shades apart for subtle but perceptible separation
 */
export const DEFAULT_TUI_THEME: TuiTheme = {
  fg: {
    primary: '#e6e7ea',
    secondary: '#c2c6cc',
    dim: '#8b9199',
  },
  bg: {
    base: '#121417',
    surface: '#181c21',
    elevated: '#1f252b',
    status: '#20252b',
  },
  accent: {
    primary: '#5ec2c7',
    focus: '#7fb4ca',
    streaming: '#d4a259',
  },
  status: {
    success: '#7bc99a',
    info: '#6fa6d9',
    warn: '#d6b26c',
    error: '#d97b7b',
  },
  message: {
    userBorder: '#5ec2c7',
    userBg: '#121417',
    assistantBg: '#181c21',
    codeBg: '#1f252b',
    thinkingFg: '#5a5f66',
    streamingFg: '#d4a259',
    toolConnector: '#8b9199',
    taskAccent: '#6fa6d9',
    errorAccent: '#d97b7b',
  },
};
