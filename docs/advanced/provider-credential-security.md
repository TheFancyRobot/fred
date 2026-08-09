# Provider Credential Security

Fred persists connection metadata separately from credential envelopes.
Credentials are write-only at ordinary list/status boundaries and encrypted
with AES-256-GCM using a fresh nonce and namespace-and-connection-bound authenticated data.
The database stores a key identifier, never key material.

## Key management

- Supply a 32-byte key from a secret manager or KMS; configure a stable key ID.
- Keep old and new key IDs in the key ring during rotation.
- Rotate in bounded batches and retry optimistic-version conflicts.
- Treat credential backups, database dumps, and logs as sensitive even though
  credentials are encrypted or redacted.
- Do not put `FRED_PROVIDER_CREDENTIAL_KEY`, provider API keys, OAuth tokens,
  or plaintext fixtures in configuration, snapshots, traces, or examples.

Fred's typed storage errors name the failing operation or connection, not the
plaintext credential, ciphertext, remote OAuth response, or encryption key.
CLI JSON output is metadata-only. Application code should preserve that error
mapping rather than rendering foreign provider errors directly.

## Incident response

1. Disable or remove the affected connection and stop new invocations.
2. Revoke the credential at the provider. `fred provider logout` attempts
   Google revocation; use the OpenRouter or API-key provider console for keys.
3. Issue a replacement credential, use `fred provider add --test`, then save
   it and switch affected agents to the new explicit `connectionId` and
   `connectionNamespace`.
4. Rotate the envelope key ring when key material may be exposed.
5. Review sanitized logs, traces, generated artifacts, and backups; restore
   only from a verified backup when database integrity is in doubt.

An interrupted save or rotation is safe to retry. A missing historic key is
not safe to ignore: restore that key before attempting to read or rotate the
affected envelopes.
