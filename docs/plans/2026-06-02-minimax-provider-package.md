# MiniMax Provider Package Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Add a first-party `@fancyrobot/fred-minimax` package with built-in `minimax` registration and extend Fred core provider contracts so MiniMax language, image, video, speech, voice, and music capabilities are first-class.

**Architecture:** Expand the current language-only provider contract in `packages/core/src/platform/` into a backward-compatible optional capability model, then implement a new `packages/provider-minimax` package that follows the existing built-in pack pattern. Use MiniMax compatibility APIs for language only when that cleanly fits existing Effect AI model integration; use native MiniMax APIs for all other modalities.

**Tech Stack:** TypeScript, Bun workspaces, Effect, `@effect/ai`, native fetch/Web APIs, Bun test

---

### Task 1: Lock down the current provider contract with failing tests

**Files:**
- Modify: `tests/unit/core/platform/packs/index.test.ts`
- Create: `tests/unit/core/platform/provider-capabilities.test.ts`
- Reference: `packages/core/src/platform/base.ts`, `packages/core/src/platform/provider.ts`

**Step 1: Write the failing core capability tests**

Add tests that describe the target behavior:
- language-only provider packs still validate and register unchanged
- provider definitions can expose optional typed capability surfaces
- unsupported capability access fails explicitly
- built-in pack registry includes `minimax` once imported

Include test cases for capability keys:
- `language`
- `image`
- `video`
- `speech`
- `voice`
- `music`

**Step 2: Run the focused tests to verify they fail**

Run: `bun test tests/unit/core/platform/provider-capabilities.test.ts tests/unit/core/platform/packs/index.test.ts`
Expected: FAIL because capability contracts and MiniMax registration do not exist yet.

**Step 3: Commit the red tests**

```bash
git add tests/unit/core/platform/provider-capabilities.test.ts tests/unit/core/platform/packs/index.test.ts
git commit -m "test(core): define provider capability contract expectations"
```

### Task 2: Add backward-compatible core provider capability types

**Files:**
- Modify: `packages/core/src/platform/provider.ts`
- Modify: `packages/core/src/platform/base.ts`
- Modify: `packages/core/src/exports.ts`
- Possibly modify: `packages/core/src/index.ts`
- Test: `tests/unit/core/platform/provider-capabilities.test.ts`

**Step 1: Add typed capability interfaces in `provider.ts`**

Define request/response shapes and optional capability interfaces for:
- language
- image
- video
- speech
- voice
- music

Keep them additive and optional so existing providers remain valid.

**Step 2: Extend `ProviderDefinition` and `EffectProviderFactory`**

Implement a backward-compatible shape such as:
- keep existing `getModel(...)`
- add optional `capabilities` or typed optional top-level methods
- add a helper to normalize unsupported-capability failures

**Step 3: Export the new capability types publicly**

Wire the new types through `packages/core/src/exports.ts` and any necessary public entrypoints.

**Step 4: Run focused tests**

Run: `bun test tests/unit/core/platform/provider-capabilities.test.ts`
Expected: PASS for type/runtime contract behavior.

**Step 5: Commit**

```bash
git add packages/core/src/platform/provider.ts packages/core/src/platform/base.ts packages/core/src/exports.ts packages/core/src/index.ts tests/unit/core/platform/provider-capabilities.test.ts
git commit -m "feat(core): add provider capability contracts"
```

### Task 3: Prove existing providers still work unchanged

**Files:**
- Modify: `tests/unit/core/platform/packs/index.test.ts`
- Reference: `packages/provider-openai/src/index.ts`, `packages/provider-anthropic/src/index.ts`, `packages/provider-google/src/index.ts`, `packages/provider-groq/src/index.ts`, `packages/provider-openrouter/src/index.ts`

**Step 1: Add regression coverage for legacy providers**

Ensure tests verify current providers remain language-only but valid under the new contract.

**Step 2: Run the provider-pack regression tests**

Run: `bun test tests/unit/core/platform/packs/index.test.ts`
Expected: PASS.

**Step 3: Commit**

```bash
git add tests/unit/core/platform/packs/index.test.ts
git commit -m "test(core): keep existing providers compatible with capability contracts"
```

### Task 4: Scaffold `packages/provider-minimax`

**Files:**
- Create: `packages/provider-minimax/package.json`
- Create: `packages/provider-minimax/src/index.ts`
- Create: `packages/provider-minimax/README.md`
- Create: `packages/provider-minimax/CHANGELOG.md`
- Modify: `package.json`
- Test: `tests/unit/core/platform/packs/index.test.ts`

**Step 1: Write the failing registration test**

Extend the pack registry test to import `../../../../../packages/provider-minimax/src/index` and expect `minimax` in built-ins.

**Step 2: Create the minimal package scaffold**

Match first-party provider package conventions:
- package name `@fancyrobot/fred-minimax`
- workspace dependency wiring
- default env var `MINIMAX_API_KEY`
- built-in auto-registration on import

**Step 3: Run the pack registry test**

Run: `bun test tests/unit/core/platform/packs/index.test.ts`
Expected: PASS with `minimax` discoverable.

**Step 4: Commit**

```bash
git add packages/provider-minimax package.json tests/unit/core/platform/packs/index.test.ts
git commit -m "feat(minimax): scaffold built-in provider package"
```

### Task 5: Implement the MiniMax language capability

**Files:**
- Create: `packages/provider-minimax/src/language.ts`
- Modify: `packages/provider-minimax/src/index.ts`
- Create: `tests/unit/provider-minimax/language.test.ts`
- Reference: `packages/provider-openai/src/index.ts`

**Step 1: Write the failing language tests**

Cover:
- `MINIMAX_API_KEY` loading
- provider config override for base URL
- compatibility endpoint selection for language/chat
- `getModel(...)` remains functional for MiniMax language models

**Step 2: Implement the minimal language adapter**

Start from the OpenAI provider pack pattern where appropriate, but keep MiniMax naming/config explicit.

**Step 3: Run the focused test**

Run: `bun test tests/unit/provider-minimax/language.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/provider-minimax/src/index.ts packages/provider-minimax/src/language.ts tests/unit/provider-minimax/language.test.ts
git commit -m "feat(minimax): add language capability"
```

### Task 6: Implement image, video, and music capabilities

**Files:**
- Create: `packages/provider-minimax/src/image.ts`
- Create: `packages/provider-minimax/src/video.ts`
- Create: `packages/provider-minimax/src/music.ts`
- Create: `tests/unit/provider-minimax/image.test.ts`
- Create: `tests/unit/provider-minimax/video.test.ts`
- Create: `tests/unit/provider-minimax/music.test.ts`
- Modify: `packages/provider-minimax/src/index.ts`

**Step 1: Write the failing tests per modality**

Each test should verify:
- capability advertised on the provider definition
- request shaping to MiniMax native API format
- normalized response shape
- upstream error normalization

**Step 2: Implement the three adapters**

Keep each modality in its own file. Do not merge them into a monolithic client module.

**Step 3: Run the focused tests**

Run: `bun test tests/unit/provider-minimax/image.test.ts tests/unit/provider-minimax/video.test.ts tests/unit/provider-minimax/music.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/provider-minimax/src/image.ts packages/provider-minimax/src/video.ts packages/provider-minimax/src/music.ts packages/provider-minimax/src/index.ts tests/unit/provider-minimax/image.test.ts tests/unit/provider-minimax/video.test.ts tests/unit/provider-minimax/music.test.ts
git commit -m "feat(minimax): add image video and music capabilities"
```

### Task 7: Implement speech and voice capabilities

**Files:**
- Create: `packages/provider-minimax/src/speech.ts`
- Create: `packages/provider-minimax/src/voice.ts`
- Create: `tests/unit/provider-minimax/speech.test.ts`
- Create: `tests/unit/provider-minimax/voice.test.ts`
- Modify: `packages/provider-minimax/src/index.ts`

**Step 1: Write the failing tests**

Cover:
- speech/TTS capability presence
- request shaping for sync/async TTS entrypoints
- voice clone/design/list/delete flows
- upstream error normalization

**Step 2: Implement the minimal adapters**

Separate speech from voice lifecycle logic even if both hit audio-related APIs.

**Step 3: Run the focused tests**

Run: `bun test tests/unit/provider-minimax/speech.test.ts tests/unit/provider-minimax/voice.test.ts`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/provider-minimax/src/speech.ts packages/provider-minimax/src/voice.ts packages/provider-minimax/src/index.ts tests/unit/provider-minimax/speech.test.ts tests/unit/provider-minimax/voice.test.ts
git commit -m "feat(minimax): add speech and voice capabilities"
```

### Task 8: Add shared config, errors, and public API polish

**Files:**
- Create: `packages/provider-minimax/src/config.ts`
- Create: `packages/provider-minimax/src/errors.ts`
- Modify: `packages/provider-minimax/src/index.ts`
- Modify: `tests/unit/provider-minimax/*.test.ts`

**Step 1: Add shared typed config helpers**

Centralize:
- `MINIMAX_API_KEY`
- base URL handling
- shared headers
- common request helpers

**Step 2: Add shared typed error mapping**

Normalize MiniMax upstream failures into consistent Fred-facing errors.

**Step 3: Re-run all MiniMax unit tests**

Run: `bun test tests/unit/provider-minimax`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/provider-minimax/src/config.ts packages/provider-minimax/src/errors.ts packages/provider-minimax/src/index.ts tests/unit/provider-minimax
git commit -m "refactor(minimax): centralize config and error handling"
```

### Task 9: Update docs and examples

**Files:**
- Modify: `README.md`
- Modify: `packages/core/README.md`
- Create: `packages/provider-minimax/README.md` (expand scaffolded version)
- Modify: `docs/guides/` files that describe providers, if present
- Modify: examples only if public provider setup flows need demonstration

**Step 1: Write the doc updates**

Document:
- package name
- built-in registration
- supported MiniMax capabilities
- `MINIMAX_API_KEY`
- modality-specific constraints
- language compatibility endpoint behavior vs native APIs

**Step 2: Run doc-sensitive verification if examples change**

Run: `bun test tests/unit/examples/examples-guard.test.ts`
Expected: PASS if examples were touched.

**Step 3: Commit**

```bash
git add README.md packages/core/README.md packages/provider-minimax/README.md docs examples
git commit -m "docs(minimax): document provider capabilities and setup"
```

### Task 10: Final verification

**Files:**
- Verify all changed files from prior tasks

**Step 1: Run focused test suites**

Run: `bun test tests/unit/core/platform/provider-capabilities.test.ts tests/unit/core/platform/packs/index.test.ts tests/unit/provider-minimax`
Expected: PASS.

**Step 2: Run broader repo checks**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run build`
Expected: PASS.

**Step 3: If examples changed, run the example guard**

Run: `bun test tests/unit/examples/examples-guard.test.ts`
Expected: PASS.

**Step 4: Commit any final verification-related fixes**

```bash
git add -A
git commit -m "test(minimax): finish verification and cleanup"
```
