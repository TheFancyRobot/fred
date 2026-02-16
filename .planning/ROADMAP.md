# Roadmap: Fred

## Overview

Roadmap is milestone-scoped; shipped milestones are archived under `.planning/milestones/`.

**Current Milestone:** v0.2.2 TUI Visual Polish
**Last Shipped:** v0.2.1 CLI/TUI Developer Experience (2026-02-16)

---

## Milestones

- ✅ **v0.2.0 Effect Migration + Monorepo** — Phases 1-21.1 (shipped 2026-02-01, archive: `.planning/milestones/v0.2.0-ROADMAP.md`)
- ✅ **v0.2.0 Observability & Safety** — Phases 22-26 (shipped 2026-02-07, archive: `.planning/milestones/v0.2.0-ROADMAP.md`)
- ✅ **v0.2.1 CLI/TUI Developer Experience** — Phases 27-36 (shipped 2026-02-16, archive: `.planning/milestones/v0.2.1-ROADMAP.md`)
- 🔄 **v0.2.2 TUI Visual Polish** — Phases 37-40 (in progress)

---

## Phases

### 🔄 v0.2.2 TUI Visual Polish (In Progress)

**Milestone Goal:** Redesign the Fred TUI appearance to use contrast-based region separation, muted color palette, information-dense sidebar, and minimal chrome — inspired by modern terminal UIs like OpenCode.

- [ ] **Phase 37: Theme System & Contrast Layout** - Centralized theme/palette system and borderless contrast-based region separation (pending)
- [ ] **Phase 38: Sidebar Redesign & Toggle** - Information-dense collapsible sidebar with hotkey and slash command toggle (pending)
- [ ] **Phase 39: Transcript & Message Rendering** - Muted assistant styling, inline tool/task blocks with tree connectors, streaming accent (pending)
- [ ] **Phase 40: Input & Status Bar Polish** - Minimal input chrome, compact status bar badges, final visual cohesion pass (pending)

## Phase Details

### Phase 37: Theme System & Contrast Layout
**Goal**: Replace all inline hex colors with a centralized theme/palette system and remove box-drawing border characters in favor of contrast-based region separation
**Depends on**: Nothing (first phase of v0.2.2)
**Requirements**: VISUAL-01, VISUAL-02, VISUAL-03, VISUAL-04, VISUAL-05, VISUAL-06
**Success Criteria** (what must be TRUE):
  1. A centralized theme module exists that defines all semantic color tokens (fg, bg, accent, status)
  2. All TUI components in `app.ts` and `layout.ts` consume colors from the theme system — zero inline hex strings remain
  3. Sidebar, transcript, and input regions are separated by background shade contrast, not box-drawing characters
  4. The borderless aesthetic uses padding-based spacing; no `╭╮╰╯│─┌┐└┘` characters appear in the layout
**Plans**: TBD (research required)

### Phase 38: Sidebar Redesign & Toggle
**Goal**: Redesign sidebar to be information-dense with collapsible sections, and add hotkey + slash command to toggle sidebar visibility
**Depends on**: Phase 37
**Requirements**: VISUAL-07, VISUAL-08, VISUAL-09, VISUAL-10, VISUAL-11
**Success Criteria** (what must be TRUE):
  1. Sidebar sections (sessions, metadata) are collapsible with `▼`/`▶` indicators
  2. Sidebar shows compact metadata: session count, active model, token stats
  3. A keyboard hotkey toggles sidebar visibility (show/hide)
  4. A `/sidebar` slash command toggles sidebar visibility
  5. Sidebar visibility state persists within the session (not reset on re-render)
**Plans**: TBD (research required)

### Phase 39: Transcript & Message Rendering
**Goal**: Polish transcript rendering with distinct user/assistant styling, inline expandable tool blocks, and streaming accent color
**Depends on**: Phase 37
**Requirements**: VISUAL-12, VISUAL-13, VISUAL-14
**Success Criteria** (what must be TRUE):
  1. Assistant messages render with muted/dimmer styling visually distinct from user messages
  2. Tool calls and task results render as inline expandable blocks with `└` tree connectors
  3. Active streaming content uses a distinct accent color (orange/amber) that changes to normal on completion
**Plans**: TBD (research required)

### Phase 40: Input & Status Bar Polish
**Goal**: Minimize input chrome and polish status bar with compact keyboard shortcut badges
**Depends on**: Phase 37
**Requirements**: VISUAL-15, VISUAL-16, VISUAL-17
**Success Criteria** (what must be TRUE):
  1. Input area uses minimal chrome — just a cursor with subtle left border accent, no decorative box borders
  2. Status bar shows keyboard shortcuts as compact `key: action` badge labels
  3. Status bar background contrasts distinctly with both transcript and input regions
**Plans**: TBD (research required)

## Progress

**Execution Order:**
Phases 37 first (foundation), then 38/39/40 can proceed (38/39 depend only on 37, 40 depends on 37).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 37. Theme System & Contrast Layout | 0/? | Pending | - |
| 38. Sidebar Redesign & Toggle | 0/? | Pending | - |
| 39. Transcript & Message Rendering | 0/? | Pending | - |
| 40. Input & Status Bar Polish | 0/? | Pending | - |

---

## Previous Milestones

<details>
<summary>v0.2.1 CLI/TUI Developer Experience (Phases 27-36) - SHIPPED 2026-02-16</summary>

See `.planning/milestones/v0.2.1-ROADMAP.md` for complete details.

</details>

<details>
<summary>v0.2.0 Observability & Safety (Phases 22-26) - SHIPPED 2026-02-07</summary>

See `.planning/milestones/v0.2.0-ROADMAP.md` for complete details.

</details>

<details>
<summary>v0.2.0 Effect Migration + Monorepo (Phases 1-21.1) - SHIPPED 2026-02-01</summary>

See `.planning/milestones/v0.2.0-ROADMAP.md` for complete details.

</details>

---

*Last updated: 2026-02-16 - v0.2.2 TUI Visual Polish milestone created with 4 phases (37-40)*
