# @fancyrobot/fred-http

## 1.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`42a5d01`](https://github.com/TheFancyRobot/fred/commit/42a5d0160f57fdd2d1a7761e489331f5f9587217)]:
  - @fancyrobot/fred@2.0.0-alpha.0

## Unreleased

### Minor Changes

- Rebuild the built-in server on Effect Platform `HttpApi` and Bun server Layers.
- Add the opt-in, non-mutating `withHttp(await createFred())` client enhancement.
- Add OpenAPI/Swagger, live status, ambient session headers, and OpenAI-compatible SSE.
- Remove the duplicate legacy router/handler implementation and dev-server source tree.
- Remove the deprecated standalone server and fetch adapters; `withHttp()` and Effect server Layers are the supported entrypoints.
- Extract Fred's reusable Bun HTTP server into a dedicated `@fancyrobot/fred-http` package.
- Add `withHttp({ routes })` for consumer-defined routes alongside Fred routes.
- Share one security-first pipeline across built-in and custom handlers, including CORS preflight, rate limiting, auth enforcement, and sanitized error responses.
- Add sibling `file:` dependency smoke coverage to validate package-name consumption from external Bun projects.
