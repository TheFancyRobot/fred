# Requirements: Fred TUI Visual Polish

**Defined:** 2026-02-16
**Core Value:** Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.

## v0.2.2 Requirements

Requirements for TUI visual polish milestone. Redesign the Fred TUI appearance to use contrast-based region separation, muted color palette, information-dense sidebar, and minimal chrome — inspired by modern terminal UIs like OpenCode.

### Theme & Palette System

- [x] **VISUAL-01**: TUI uses a centralized theme/palette system instead of inline hex color strings
- [x] **VISUAL-02**: Theme defines named semantic colors (e.g. `fg.primary`, `fg.muted`, `bg.base`, `bg.surface`, `bg.elevated`, `accent.active`, `accent.success`, `accent.error`)
- [x] **VISUAL-03**: All TUI components consume colors from the theme system, not hardcoded values

### Layout & Contrast Separation

- [x] **VISUAL-04**: Region separation uses background shade contrast instead of box-drawing border characters (no `╭╮╰╯│─┌┐└┘`)
- [x] **VISUAL-05**: Sidebar, transcript, and input areas are visually distinct through background color differences
- [x] **VISUAL-06**: Layout supports a borderless aesthetic with padding-based spacing between regions

### Sidebar Redesign

- [x] **VISUAL-07**: Sidebar displays collapsible sections with `▼`/`▶` markers for session list and metadata
- [x] **VISUAL-08**: Sidebar shows compact, information-dense metadata (session count, model, token stats)
- [x] **VISUAL-09**: User can toggle sidebar visibility with a keyboard hotkey
- [x] **VISUAL-10**: User can toggle sidebar visibility with a `/sidebar` slash command
- [x] **VISUAL-11**: Sidebar toggle state persists within the session

### Transcript & Message Rendering

- [x] **VISUAL-12**: Assistant messages render with muted styling distinct from user messages
- [x] **VISUAL-13**: Tool calls and task results render as inline expandable blocks with `└` tree connectors
- [x] **VISUAL-14**: Active/streaming content uses a distinct accent color (e.g. orange/amber) to indicate liveness

### Input & Status Bar

- [x] **VISUAL-15**: Input area uses minimal chrome — cursor with subtle left border accent, no decorative box
- [x] **VISUAL-16**: Bottom status bar displays keyboard shortcut labels as compact badges
- [x] **VISUAL-17**: Status bar uses muted background that contrasts with transcript and input areas

## Future Requirements

Deferred beyond v0.2.2. Tracked but not in current roadmap.

### TUI Visual Advanced

- **VISUAL-18**: User can switch between light and dark themes
- **VISUAL-19**: User can define custom theme via config file
- **VISUAL-20**: Theme supports 256-color and truecolor terminal detection with graceful fallback
- **VISUAL-21**: Animated transitions between sidebar show/hide states
- **VISUAL-22**: Syntax-highlighted code blocks in transcript messages

## Out of Scope

Explicitly excluded for this milestone. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Light theme | Dark-first; light theme deferred to VISUAL-18 |
| Custom user themes via config | Deferred to VISUAL-19; hardcoded palette first |
| Mouse interaction | Separate concern; tracked as TUI-18 in v0.2.1 future reqs |
| Markdown rendering improvements | Separate concern; focus is on layout/color/chrome |
| New functional TUI features | This milestone is purely visual; no new capabilities beyond sidebar toggle |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| VISUAL-01 | Phase 37 | Done |
| VISUAL-02 | Phase 37 | Done |
| VISUAL-03 | Phase 37 | Done |
| VISUAL-04 | Phase 37 | Done |
| VISUAL-05 | Phase 37 | Done |
| VISUAL-06 | Phase 37 | Done |
| VISUAL-07 | Phase 38 | Complete |
| VISUAL-08 | Phase 38 | Complete |
| VISUAL-09 | Phase 38 | Complete |
| VISUAL-10 | Phase 38 | Complete |
| VISUAL-11 | Phase 38 | Complete |
| VISUAL-12 | Phase 39 | Complete |
| VISUAL-13 | Phase 39 | Complete |
| VISUAL-14 | Phase 39 | Complete |
| VISUAL-15 | Phase 40 | Complete |
| VISUAL-16 | Phase 40 | Complete |
| VISUAL-17 | Phase 40 | Complete |

**Coverage:**
- v0.2.2 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-02-16*
*Last updated: 2026-02-22 — All VISUAL-01 through VISUAL-17 completed (v0.2.2 shipped)*
