# MiniMax First-Party Multi-Modality Provider Design

## Summary

Add a first-party built-in MiniMax provider package to the Fred monorepo as `packages/provider-minimax`, published as `@fancyrobot/fred-minimax`, and registered under provider ID `minimax`.

This phase must support every MiniMax capability confirmed in the official MiniMax docs reviewed on 2026-06-02:
- language/chat
- image generation
- video generation
- speech / text-to-speech
- voice cloning / voice design / voice management
- music generation

The implementation must also extend Fred core provider abstractions so these capabilities are first-class provider features rather than ad-hoc helper exports.

## Research findings

### Existing Fred provider pattern
Fred currently has first-party provider packs under `packages/provider-*` with a common pattern:
- package owns a provider factory implementing `EffectProviderFactory`
- factory auto-registers via `registerBuiltinPack(...)`
- core provider abstractions currently center on `getModel(...)` for language-model usage

Relevant files:
- `packages/core/src/platform/base.ts`
- `packages/core/src/platform/packs/index.ts`
- `packages/provider-openai/src/index.ts`

### MiniMax documentation findings
Official MiniMax docs reviewed show support for:
- language/chat via OpenAI-compatible and Anthropic-compatible endpoints
- image generation
- video generation
- speech/TTS (HTTP, WebSocket, async long-form)
- voice cloning
- voice design
- voice management
- music generation

The official docs reviewed did **not** show first-party support for:
- embeddings
- speech-to-text / transcription

So “all supported capabilities” for this phase means all officially documented capabilities above, not undocumented ones.

### Effect package availability
A check for `@effect/ai-minimax` on npm returned 404. Current design therefore assumes there is no published official Effect MiniMax package and starts from Fred’s existing provider-pack patterns, especially `provider-openai`, while using native MiniMax APIs where needed.

## Goals

1. Add `@fancyrobot/fred-minimax` as a first-party built-in provider pack.
2. Register one provider ID, `minimax`, for all supported MiniMax capabilities.
3. Extend Fred core provider abstractions so non-language capabilities are first-class.
4. Preserve backward compatibility for existing language-only providers.
5. Use MiniMax native APIs for non-language modalities.
6. Use `MINIMAX_API_KEY` by default.

## Non-goals

- Shipping a chat-only MiniMax provider.
- Hiding non-language capability access behind one-off untyped helpers.
- Requiring live MiniMax API calls in CI.
- Adding undocumented MiniMax capabilities.

## Options considered

### Option A — Native multi-modality provider + core capability expansion
Add a new provider package and expand Fred core provider contracts to represent typed optional capabilities beyond language.

**Pros**
- Matches user requirement exactly.
- Gives Fred a durable path for future multi-modality providers.
- Keeps MiniMax support first-class instead of special-cased.

**Cons**
- Requires core changes in addition to package work.
- Larger test/doc surface.

**Decision**: chosen.

### Option B — Chat provider plus helper exports for everything else
Use current language-centric provider abstraction and ship image/video/speech/etc. as package helpers.

**Rejected because** it fails the requirement that all supported capabilities be first-class and fully supported.

### Option C — Split MiniMax into multiple modality-specific packages
Create several first-party packages.

**Rejected because** it worsens DX and conflicts with the desired single-provider experience.

## Architecture

### 1. Core provider capability expansion
Extend the provider contract in `packages/core/src/platform/` so a provider definition can expose typed optional capability adapters rather than only `getModel(...)`.

Proposed shape direction:
- keep existing language-model path intact for current providers
- add discoverable optional capability surfaces for:
  - language
  - image
  - video
  - speech
  - voice
  - music
- surface explicit “capability unsupported” failures instead of forcing callers to probe arbitrarily

This should be done in a way that:
- existing providers remain valid with language-only implementations
- MiniMax can implement the full capability set under one provider ID
- future providers can progressively add non-language support

### 2. `packages/provider-minimax/`
Create a new first-party package that follows the existing provider-pack pattern:
- `package.json`
- `src/index.ts`
- modality-specific adapter modules
- README / changelog

Responsibilities:
- register built-in pack under `minimax`
- load config from `MINIMAX_API_KEY` by default
- support provider config overrides for base URL and modality-specific options where needed
- expose typed capability implementations aligned with core contracts

### 3. MiniMax API strategy
Use the best integration path per modality:
- **language/chat**: use MiniMax’s compatibility endpoints where they fit Fred’s current model integration best
- **image**: use native MiniMax image endpoints
- **video**: use native MiniMax video endpoints
- **speech**: use native MiniMax TTS APIs
- **voice**: use native MiniMax voice cloning/design/management APIs
- **music**: use native MiniMax music APIs

This avoids trying to force all capabilities through a compatibility layer that only cleanly models text.

## Components

### Core
- `packages/core/src/platform/base.ts`
- additional provider/capability types under `packages/core/src/platform/`
- any public export updates needed so app code can consume the new capability abstractions

### Provider package
- `packages/provider-minimax/package.json`
- `packages/provider-minimax/src/index.ts`
- modality modules, likely split by concern:
  - language
  - image
  - video
  - speech
  - voice
  - music
  - errors/config helpers

### Tests
- core capability contract tests
- built-in pack registry tests
- provider-minimax unit tests per modality
- backward compatibility tests for existing providers

### Docs
- package README
- core/provider docs where provider capabilities are described
- example usage if public API expands materially

## Data flow

1. App selects provider `minimax`.
2. Fred loads the built-in MiniMax provider pack.
3. Core resolves the requested capability.
4. If supported, the provider returns the matching typed capability adapter.
5. Adapter maps Fred request shape to MiniMax API request shape.
6. Adapter normalizes MiniMax response into Fred response types.
7. If capability is unsupported by another provider, core returns a typed unsupported-capability error.

## Error handling

Add or reuse typed errors for:
- missing API key
- provider load/config failure
- unsupported capability
- invalid upstream response
- upstream request failure

Rules:
- normalize MiniMax modality-specific errors into Fred-facing typed errors
- preserve current Effect runtime boundary rules
- do not add `Effect.runPromise` inside core business logic

## Testing strategy

Use deterministic tests only.

Required coverage:
- provider registration/discovery under built-ins
- env/config loading for `MINIMAX_API_KEY`
- capability presence and absence behavior
- request-shape tests for every supported modality
- failure normalization tests for every supported modality
- regression tests proving existing providers still work without non-language implementations

No live MiniMax API calls in CI.

## Rollout sequencing

1. Define and implement core capability contracts.
2. Add backward-compatibility coverage for current providers.
3. Scaffold `packages/provider-minimax`.
4. Implement language capability.
5. Implement image capability.
6. Implement video capability.
7. Implement speech capability.
8. Implement voice capability.
9. Implement music capability.
10. Update docs/examples/changelog.
11. Run focused validation.

## Risks

1. **Core abstraction sprawl**
   - Mitigation: use optional typed capability surfaces instead of one massive catch-all interface.

2. **Mismatch between MiniMax modalities and Fred abstractions**
   - Mitigation: model capabilities separately so each modality can stay honest to upstream semantics.

3. **Backward compatibility breakage for existing providers**
   - Mitigation: keep language-only providers valid and covered by tests.

4. **Overpromising unsupported modalities**
   - Mitigation: scope only to modalities verified in official MiniMax docs reviewed during design.

## Acceptance criteria

- `@fancyrobot/fred-minimax` exists as a first-party built-in provider pack.
- Provider ID `minimax` is registered and discoverable.
- Fred core can represent typed optional provider capabilities for language, image, video, speech, voice, and music.
- MiniMax implements all verified official capabilities in scope.
- Existing providers remain compatible.
- Docs and tests ship in the same phase.
