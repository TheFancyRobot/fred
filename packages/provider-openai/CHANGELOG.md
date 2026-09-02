# @fred/provider-openai

## 4.2.0

### Minor Changes

- [#104](https://github.com/TheFancyRobot/fred/pull/104) [`7254c3f`](https://github.com/TheFancyRobot/fred/commit/7254c3f547bcb7737f45dd5bd78c556a6a952c94) Thanks [@sincspecv](https://github.com/sincspecv)! - Add createOpenAiCompatibleProviderFactory, loadOpenAiCompatibleRuntime, and InvalidOpenAiCompatibleProviderConfigError for generic OpenAI Chat Completions providers. Saved local-compatible connections now share this runtime.

## 4.1.1

### Patch Changes

- [#97](https://github.com/TheFancyRobot/fred/pull/97) [`cd0a378`](https://github.com/TheFancyRobot/fred/commit/cd0a378cfb6e2ee7894e4558769400a8590ab6d4) Thanks [@sincspecv](https://github.com/sincspecv)! - Use Chat Completions for saved local OpenAI-compatible connections while preserving the Responses transport for hosted OpenAI. JSON-schema structured output and streaming remain supported for local connections.

## 4.1.0

### Minor Changes

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`4e77d1b`](https://github.com/TheFancyRobot/fred/commit/4e77d1b41b730cadb5e8f6c0a3f6077c23f7ba01) Thanks [@sincspecv](https://github.com/sincspecv)! - Bind provider clients to explicit connections at invocation time, with redacted credential inputs and provider capability manifests.

### Patch Changes

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`784cc24`](https://github.com/TheFancyRobot/fred/commit/784cc24848cfdd617075ecb93935c32103878e74) Thanks [@sincspecv](https://github.com/sincspecv)! - Test provider-connection drafts and saved IDs with provider-owned authenticated,
  bounded probes that reject unsuccessful HTTP status without exposing secrets.

## 4.0.0

### Patch Changes

- [#80](https://github.com/TheFancyRobot/fred/pull/80) [`852ed41`](https://github.com/TheFancyRobot/fred/commit/852ed4171ff6298b0a880062949beab63e5ef675) Thanks [@sincspecv](https://github.com/sincspecv)! - Ship the Phase 68 independent-version migration matrix, supported API recipes,
  security rotation guidance, package README links, and release/rollback runbook.

## 4.0.0-alpha.1

### Patch Changes

- [#80](https://github.com/TheFancyRobot/fred/pull/80) [`852ed41`](https://github.com/TheFancyRobot/fred/commit/852ed4171ff6298b0a880062949beab63e5ef675) Thanks [@sincspecv](https://github.com/sincspecv)! - Ship the Phase 68 independent-version migration matrix, supported API recipes,
  security rotation guidance, package README links, and release/rollback runbook.

## 4.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`42a5d01`](https://github.com/TheFancyRobot/fred/commit/42a5d0160f57fdd2d1a7761e489331f5f9587217)]:
  - @fancyrobot/fred@2.0.0-alpha.0

## 3.0.0

### Patch Changes

- Updated dependencies [[`61f61fd`](https://github.com/TheFancyRobot/fred/commit/61f61fdc4b5f365a2f03d078a8521d192905b103), [`61f61fd`](https://github.com/TheFancyRobot/fred/commit/61f61fdc4b5f365a2f03d078a8521d192905b103)]:
  - @fancyrobot/fred@1.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [[`4b72cf1`](https://github.com/TheFancyRobot/fred/commit/4b72cf1793f3bbadc6356888abdcdf7011ba1d2b)]:
  - @fancyrobot/fred@0.2.0

## 1.0.0

### Minor Changes

- [`e7f17bb`](https://github.com/TheFancyRobot/fred/commit/e7f17bbcb4c7d408a4df9817565c5837576bb978) Thanks [@sincspecv](https://github.com/sincspecv)! - Release v0.2.5 - Monorepo conversion complete with Effect-based services, built-in calculator tool, streaming support, and automatic package publishing

### Patch Changes

- Updated dependencies [[`e7f17bb`](https://github.com/TheFancyRobot/fred/commit/e7f17bbcb4c7d408a4df9817565c5837576bb978)]:
  - @fred/core@0.2.0
