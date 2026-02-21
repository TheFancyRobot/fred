# Phase 40: Input & Status Bar Polish - Context

**Gathered:** 2026-02-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Redesign the Fred TUI appearance by polishing the input area and status bar. Minimize input chrome to create a clean, modern aesthetic and implement compact keyboard shortcut badges in the status bar.
</domain>

<decisions>
## Implementation Decisions

### Input Area
- **Multiline Behavior:** Expands upward to a maximum of 5 lines (compact), then scrolls.
- **Background:** Uses an elevated background shade (e.g., `surface` token) compared to the base terminal.
- **Padding:** 2 characters of padding on the left and right edges inside the input area.
- **Enter Key Behavior:** Pressing `Enter` sends the message.
- **Placeholder Text:** Context-sensitive placeholder based on the current mode (e.g., Chat vs Slash Command).
- **Gap Spacing:** 0 lines (touching) between the bottom of the transcript and the top of the input area.

### State & Queueing
- **Message Queueing:** After submitting, the input field should clear immediately and be ready to accept a new input. If a new input is submitted before receiving a response for the previous input, the submission will be added to a queue and processed as soon as the previous response is received.
- **Visualizing Queue:** Queued messages should be shown dimmed in the transcript immediately before they are processed.

### Status Bar Content
- **Core Shortcuts:** `Help`, `Quit`, and `Sidebar` toggle should always be visible.
- **Context-Sensitive Shortcuts:** Include `Copy` (badge only, e.g., `Ctrl+Y Copy`) when hovering over a message. Show focus-specific shortcuts (like `j`/`k` for the sidebar) only when that specific pane is focused.
- **Non-Shortcut Info:** The status bar should display shortcuts only (no model names or token metrics).
- **Shortcut Format:** Use standard modifier format (e.g., `Ctrl+C`).
- **Overflow Handling:** If there are too many shortcuts to fit horizontally, truncate the least important ones.
- **Inactive Shortcuts:** Hide them entirely rather than dimming them.

### Interactions & Modals
- **Slash Commands:** When typing `/`, a list should appear (like a typical select box in a browser) listing all commands that start with the entered characters, updating every time a new key is pressed.
- **Help Action:** Pressing the Help shortcut opens a floating modal over the transcript.
- **Modal State:** When a floating modal is open, the main status bar shortcuts should be dimmed.
- **Mode Indicators:** Rely on cursor style only to indicate mode (no explicit `NORMAL`/`INSERT` badges).
- **Background Tasks:** Visual indications for background tasks (like agent pipelines) should remain in the transcript only, not in the status bar.

### Claude's Discretion
User explicitly requested the use of available UI/UX and frontend design skills to determine the best solution for the following:
- The left border accent style in the input area.
- Keyboard shortcut badge styling (solid block, outline, colored text).
- How the 'Key' and 'Action' parts are visually separated within a badge.
- Spacing between each shortcut badge.
- The overall alignment of content in the status bar (left, right, centered, split).
- The exact color/shade of the overall status bar background (User noted it should be lighter than the base background, but exact styling is up to design discretion).
- Whether to include small icons or symbols next to the action text in the badges.
- Where the status bar should be positioned (e.g., bottom of window vs attached to input).
</decisions>

<specifics>
## Specific Ideas

- The slash command autocomplete should feel responsive and familiar, like a browser's select box dropdown, updating instantly on every keypress.
- Queued user inputs appear in the transcript instantly but dimmed until the prior AI response finishes.
</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.
</deferred>

---

*Phase: 40-input-and-status-bar-polish*
*Context gathered: 2026-02-21*
