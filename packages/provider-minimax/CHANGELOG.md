# @fancyrobot/fred-minimax

## 2.1.0

### Minor Changes

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`4e77d1b`](https://github.com/TheFancyRobot/fred/commit/4e77d1b41b730cadb5e8f6c0a3f6077c23f7ba01) Thanks [@sincspecv](https://github.com/sincspecv)! - Bind provider clients to explicit connections at invocation time, with redacted credential inputs and provider capability manifests.

### Patch Changes

- [#94](https://github.com/TheFancyRobot/fred/pull/94) [`784cc24`](https://github.com/TheFancyRobot/fred/commit/784cc24848cfdd617075ecb93935c32103878e74) Thanks [@sincspecv](https://github.com/sincspecv)! - Test provider-connection drafts and saved IDs with provider-owned authenticated,
  bounded probes that reject unsuccessful HTTP status without exposing secrets.

## 2.0.0

### Patch Changes

- [#88](https://github.com/TheFancyRobot/fred/pull/88) [`d66c541`](https://github.com/TheFancyRobot/fred/commit/d66c541f3e7d235f7c305679d4cc84a070317ab6) Thanks [@sincspecv](https://github.com/sincspecv)! - Require `effect@^3.21.5` in packages that directly peer on the
  `@effect/platform` 0.96 line. The reviewed workspace lock resolves
  `@effect/platform@0.96.3`, whose Effect peer range starts at 3.21.5. This is a
  compatibility boundary; no upstream vulnerability is being claimed for Effect
  3.21.0 through 3.21.4.

- [#89](https://github.com/TheFancyRobot/fred/pull/89) [`77a1ef6`](https://github.com/TheFancyRobot/fred/commit/77a1ef6cfb2a5adf7f1c6dc3470cb32fe2946b77) Thanks [@sincspecv](https://github.com/sincspecv)! - Expose a focused browser-safe lyrics entrypoint without provider auto-registration or server-only core imports.

- [#54](https://github.com/TheFancyRobot/fred/pull/54) [`241a241`](https://github.com/TheFancyRobot/fred/commit/241a2416316739dc51c4d351c6313255478e188e) Thanks [@sincspecv](https://github.com/sincspecv)! - Remove the workspace-only Fred dev dependency from the MiniMax provider manifest so the package can be consumed as a local `file:` dependency outside the Fred monorepo.

- [#80](https://github.com/TheFancyRobot/fred/pull/80) [`852ed41`](https://github.com/TheFancyRobot/fred/commit/852ed4171ff6298b0a880062949beab63e5ef675) Thanks [@sincspecv](https://github.com/sincspecv)! - Ship the Phase 68 independent-version migration matrix, supported API recipes,
  security rotation guidance, package README links, and release/rollback runbook.

## 2.0.0-alpha.3

### Patch Changes

- [#89](https://github.com/TheFancyRobot/fred/pull/89) [`77a1ef6`](https://github.com/TheFancyRobot/fred/commit/77a1ef6cfb2a5adf7f1c6dc3470cb32fe2946b77) Thanks [@sincspecv](https://github.com/sincspecv)! - Expose a focused browser-safe lyrics entrypoint without provider auto-registration or server-only core imports.

## 2.0.0-alpha.2

### Patch Changes

- [#88](https://github.com/TheFancyRobot/fred/pull/88) [`d66c541`](https://github.com/TheFancyRobot/fred/commit/d66c541f3e7d235f7c305679d4cc84a070317ab6) Thanks [@sincspecv](https://github.com/sincspecv)! - Require `effect@^3.21.5` in packages that directly peer on the
  `@effect/platform` 0.96 line. The reviewed workspace lock resolves
  `@effect/platform@0.96.3`, whose Effect peer range starts at 3.21.5. This is a
  compatibility boundary; no upstream vulnerability is being claimed for Effect
  3.21.0 through 3.21.4.

## 2.0.0-alpha.1

### Patch Changes

- [#80](https://github.com/TheFancyRobot/fred/pull/80) [`852ed41`](https://github.com/TheFancyRobot/fred/commit/852ed4171ff6298b0a880062949beab63e5ef675) Thanks [@sincspecv](https://github.com/sincspecv)! - Ship the Phase 68 independent-version migration matrix, supported API recipes,
  security rotation guidance, package README links, and release/rollback runbook.

## 2.0.0-alpha.0

### Patch Changes

- [#54](https://github.com/TheFancyRobot/fred/pull/54) [`241a241`](https://github.com/TheFancyRobot/fred/commit/241a2416316739dc51c4d351c6313255478e188e) Thanks [@sincspecv](https://github.com/sincspecv)! - Remove the workspace-only Fred dev dependency from the MiniMax provider manifest so the package can be consumed as a local `file:` dependency outside the Fred monorepo.

- Updated dependencies [[`42a5d01`](https://github.com/TheFancyRobot/fred/commit/42a5d0160f57fdd2d1a7761e489331f5f9587217)]:
  - @fancyrobot/fred@2.0.0-alpha.0

## 1.0.0

### Minor Changes

- Scaffold built-in MiniMax multi-modality provider package with auto-registration under provider ID `minimax`.

### Patch Changes

- Updated dependencies []:
  - @fancyrobot/fred@1.0.0
