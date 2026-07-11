# HTTP Layer Example Design

## Summary

Add `examples/14-http-layer` as a progressive, standalone example of Fred's optional HTTP package. The example will be useful in two modes:

- a credential-free infrastructure smoke run that starts a real server and exercises HTTP concerns deterministically;
- an opt-in model-backed client run that demonstrates chat, session continuation, streaming, and OpenAI SDK compatibility when `OPENROUTER_API_KEY` is configured.

The example must keep the HTTP layer outside `createFred()`. It will first create the core Fred instance, then explicitly enhance it with `withHttp()` from `@fancyrobot/fred-http`.

## Goals

- Provide a runnable project rather than documentation-only snippets.
- Demonstrate the optional `withHttp()` composition boundary clearly.
- Cover as much of the public HTTP surface as is practical without making the learning path confusing.
- Keep a useful path runnable without an AI provider key or network access.
- Demonstrate optional bearer-token authentication with executable behavior and explanatory comments.
- Add automated guard coverage so the example cannot silently drift from the public APIs.

## Non-Goals

- Do not add HTTP methods directly to the object returned by core `createFred()`.
- Do not use deprecated compatibility adapters.
- Do not expose internal or test-only HTTP APIs to make the example deterministic.
- Do not hard-code credentials or recommend committing them.
- Do not turn the example into a production deployment template for a particular hosting provider.

## Chosen Structure

Use one example project with separate entrypoints instead of two duplicated examples or one oversized script:

- `src/server.ts` constructs Fred, applies `withHttp()`, configures the server, and owns shutdown.
- `src/smoke.ts` starts the server in-process and checks infrastructure routes and security without a provider key.
- `src/client.ts` connects to a separately running server for model-backed chat demonstrations.
- `src/agents/http-assistant.md` and the example configuration define the real agent used by the model-backed path.
- `README.md` presents the credential-free path first, followed by provider-backed usage.

This layout keeps each command readable while sharing the same public server construction.

## Server Design

The server will:

1. Create the core Fred instance using `createFred()` from `@fancyrobot/fred`.
2. Enhance that instance with `withHttp()` from `@fancyrobot/fred-http`.
3. Configure hostname, port, CORS, rate limiting, body limits, and request timeouts through public options.
4. Enable bearer-token authentication only when the documented environment variable is present.
5. Start through `fred.server.listen(...)` and stop through the returned server handle or coordinated Fred shutdown.
6. Register signal handling for the standalone server command.

Authentication comments will explain:

- how to supply a token through the environment;
- how to enable or disable auth intentionally;
- how to send `Authorization: Bearer <token>` from `fetch`;
- how to pass the same token to the OpenAI SDK client;
- why secrets must not be committed or embedded in source.

The comments will accompany working conditional auth code, so readers can both understand and execute the pattern.

## Credential-Free Smoke Design

The smoke command will start a real local HTTP server with deterministic configuration and exercise public endpoints that do not require model inference. It will verify representative behavior for:

- health and status;
- agent, intent, and tool discovery where available without inference;
- generated OpenAPI JSON and interactive docs;
- CORS preflight and response headers;
- bearer auth rejection without a token and success with the configured token;
- clean server shutdown.

The smoke command will fail with a non-zero exit status and a clear message if any expectation is violated. It will not call external model APIs.

## Provider-Backed Client Design

When `OPENROUTER_API_KEY` is configured, the client will demonstrate:

- the Fred-native message/chat endpoint;
- capturing and reusing `X-Session-Id` for conversation continuation;
- an OpenAI-compatible non-streaming chat completion;
- an OpenAI-compatible SSE streaming completion;
- use of the official OpenAI npm client against Fred's local base URL;
- authenticated requests when the optional HTTP token is enabled.

The client will print a helpful configuration message rather than producing an opaque failure when the provider key is missing.

## Documentation and Guard Integration

- Add the example to `tests/unit/examples/examples-guard.test.ts` so structure, package imports, and typechecking remain enforced.
- Ensure all example source imports packages by published package name.
- Link the runnable project from the existing server-mode documentation.
- Keep the package README focused on the package API and use the example README for the end-to-end tutorial.

## Error Handling and Effect Boundaries

The example is an application boundary. It may convert public Effect programs to promises only where the existing application-entrypoint pattern requires it. Domain and service logic will not be added to the example, and no new internal Effect runtime boundaries will be introduced.

Expected startup, request, and cleanup failures will be surfaced with contextual messages. Cleanup will run even when a smoke assertion fails.

## Validation

Validation will include:

- the credential-free smoke command;
- standalone typechecking for example 14;
- the examples guard test;
- targeted HTTP tests;
- repository typecheck and build;
- documentation build;
- full test suite.

## Success Criteria

The work is complete when a new user can:

1. run the smoke command without an AI key and observe validated HTTP/security behavior;
2. add an OpenRouter key, start the server, and run real chat and streaming clients;
3. understand from working code that HTTP is an optional enhancement around core Fred;
4. copy the documented bearer-token pattern without hard-coding a secret;
5. rely on repository tests to detect future example drift.
