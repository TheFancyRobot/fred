# Phase 47: Update Package READMEs - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract package-specific documentation from the root README and move it into dedicated README files at the root of each package (core, provider-openai, provider-anthropic, provider-google, provider-groq, provider-openrouter). CLI and dev already have READMEs. The root README becomes a slim hub linking to packages. No implementation changes -- documentation only.

</domain>

<decisions>
## Implementation Decisions

### Root README slimming
- Hub-style: ~80-100 lines with brief intro paragraph, feature bullets, package table with links, short code snippet
- High-level feature overview stays in root (what Fred does), packages go deep (how to use it)
- Quickstart shows .md agent file approach as primary, with a pointer to core README for programmatic API
- CLI section replaced with brief mention of CLI/TUI existence + link to CLI README
- Server mode section moves to dev package README
- Provider overview table moves to core README; root just lists package names with links
- Standard badges: npm version (core package), CI status, license
- Contributing/development section: Claude's discretion

### Core package README
- Getting-started tutorial style (walk developer through first use)
- .md agent files shown as primary agent definition approach
- Main tutorial uses Fred public API; separate "Advanced: Effect Services" section covers Layer composition, service tags, custom wiring
- Provider overview table (all 5 providers with packages, env vars) lives here
- Examples section at the end linking to examples README (no inline cross-references in feature sections)
- Covers: agents (.md files + programmatic), tools, pipelines, hooks, routing, config, context/persistence

### Provider READMEs
- Moderate detail: ~60-80 lines each
- Same template across all 5 providers for consistency
- Self-contained: each mentions auto-registration on import
- Shows both programmatic usage and config-file (YAML) usage
- npm version badge on each provider README
- No specific model lists -- link to provider's official docs for supported models
- No backend implementation details (don't mention OpenRouter uses @effect/ai-openai, don't mention Groq uses generic Chat Completions)

### Existing READMEs
- CLI README (packages/cli/README.md) -- already comprehensive, no changes needed
- Dev README (packages/dev/README.md) -- already comprehensive, may need server mode section added from root

### Claude's Discretion
- Contributing/development section placement and detail in root README
- Exact ordering of core README tutorial sections
- Provider README template structure details (heading order, example complexity)
- Whether dev README needs server mode content extracted from root

</decisions>

<specifics>
## Specific Ideas

- Root README should have a high-level overview of all features, individual package READMEs go in-depth
- .md agent file format (Phase 45.1) is the recommended/"primary" way to define agents across all READMEs
- Each provider README should be self-contained enough that someone installing just that provider package has everything they need

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/cli/README.md`: 286-line comprehensive CLI README -- can be used as reference for quality/depth target
- `packages/dev/README.md`: 56-line focused dev README -- already well-scoped
- Root `README.md`: 221 lines -- source content to redistribute across packages
- `examples/README.md`: Learning-path index linking to 12 progressive examples

### Established Patterns
- CLI README uses tables for flags/options, code blocks for commands, clear section headers
- Dev README is minimal and scope-focused ("not intended as production runtime dependency")
- Both existing READMEs have MIT license footer

### Integration Points
- Root README links to docs site (sincspecv.github.io/fred), CONTRIBUTING.md
- Package READMEs should link back to root and to each other where relevant
- Examples README provides the learning-path cross-reference

</code_context>

<deferred>
## Deferred Ideas

- Groq provider migration to @effect/ai (dedicated Groq SDK) -- future milestone

</deferred>

---

*Phase: 47-update-package-readmes*
*Context gathered: 2026-03-04*
