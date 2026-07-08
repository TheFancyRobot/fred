# @fancyrobot/fred-http

## 1.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`42a5d01`](https://github.com/TheFancyRobot/fred/commit/42a5d0160f57fdd2d1a7761e489331f5f9587217)]:
  - @fancyrobot/fred@2.0.0-alpha.0

## Unreleased

### Minor Changes

- Extract Fred's reusable Bun HTTP server into a dedicated `@fancyrobot/fred-http` package.
- Add `createFredHttpApp` for composable consumer-defined routes alongside Fred routes.
- Share one security-first pipeline across built-in and custom handlers, including CORS preflight, rate limiting, auth enforcement, and sanitized error responses.
- Add sibling `file:` dependency smoke coverage to validate package-name consumption from external Bun projects.
