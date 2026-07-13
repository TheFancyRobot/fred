# @fancyrobot/fred-dev

> Deprecated compatibility shim. Install `@fancyrobot/fred-cli` and use `fred chat`.

See the [Phase 68 migration matrix](../../MIGRATION.md) for the exact compatible
CLI version and the removal timeline.

This final compatibility release contains no development-chat implementation. It
forwards the former root and `./chat-defaults` exports to
`@fancyrobot/fred-cli` and will be removed in the next major release.

Those forwarded exports first ship on the CLI 0.6 line. The checked-in CLI
version remains `0.5.1-alpha.0` until release versioning, but that version is
not a valid shim peer. During candidate validation, use the exact published
CLI 0.6 prerelease recorded in the migration matrix; do not substitute CLI
0.5.1.

## Migration

```bash
bun remove @fancyrobot/fred-dev
# Replace this range with the exact published 0.6 candidate during RC validation.
bun add -d @fancyrobot/fred-cli@^0.6.0-alpha.0
```

Replace programmatic imports:

```ts
// Before
import { startDevChat } from '@fancyrobot/fred-dev';
import { detectAvailableProvider } from '@fancyrobot/fred-dev/chat-defaults';

// Compatibility API, now owned by the CLI
import { startDevChat } from '@fancyrobot/fred-cli';
import { detectAvailableProvider } from '@fancyrobot/fred-cli/chat-defaults';

await startDevChat(setup);
```

The compatibility function returns `Promise<void>`; await it to preserve the
chat lifecycle and observe startup failures.

For normal use, prefer the command:

```bash
fred chat
```

The deprecated `fred dev` alias remains available for this compatibility
window and prints migration guidance. HTTP server APIs live in
`@fancyrobot/fred-http`; this shim does not export them.

## Related

- [@fancyrobot/fred-cli](../cli/README.md)
- [@fancyrobot/fred core package](../core/README.md)
- [Repository README hub](../../README.md)

## License

MIT
