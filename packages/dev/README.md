# @fancyrobot/fred-dev

> Deprecated compatibility shim. Install `@fancyrobot/fred-cli` and use `fred chat`.

See the [Phase 68 migration matrix](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md) for the exact compatible
CLI version and the removal timeline.

This final compatibility release contains no development-chat implementation. It
forwards the former root and `./chat-defaults` exports to
`@fancyrobot/fred-cli` and will be removed in the next major release.

Those forwarded exports first publish on the CLI 0.6 line because they carry a
minor Changeset. The stable release pins CLI `0.6.0`; an earlier published CLI
0.5.1 artifact is not a valid shim peer.

## Migration

```bash
bun remove @fancyrobot/fred-dev
# Confirm this exact version in the published migration matrix.
bun add -d --exact @fancyrobot/fred-cli@0.6.0
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

- [@fancyrobot/fred-cli](https://github.com/TheFancyRobot/fred/blob/main/packages/cli/README.md)
- [@fancyrobot/fred core package](https://github.com/TheFancyRobot/fred/blob/main/packages/core/README.md)
- [Repository README hub](https://github.com/TheFancyRobot/fred#packages)

## License

MIT
