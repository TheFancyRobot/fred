# @fancyrobot/fred-http

## Unreleased

### Minor Changes

- Extract Fred's reusable Bun HTTP server into a dedicated `@fancyrobot/fred-http` package.
- Add `createFredHttpApp` for composable consumer-defined routes alongside Fred routes.
- Share one security-first pipeline across built-in and custom handlers, including CORS preflight, rate limiting, auth enforcement, and sanitized error responses.
- Add sibling `file:` dependency smoke coverage to validate package-name consumption from external Bun projects.
