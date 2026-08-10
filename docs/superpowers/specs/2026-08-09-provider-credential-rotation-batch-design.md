# Provider Credential Rotation Batch Design

## Goal

Make one unusable historic credential envelope unable to block rotation of other rows, and make the batch result state whether stale-key rows actually remain after all attempts.

## API

`rotateCredentials()` returns `{ rotated, skipped, remaining }`. Each skipped entry contains the connection ID, stored key ID, and the existing sanitized typed metadata-decode, key, encryption, or optimistic-version error. Query and transaction failures still fail the Effect.

## Flow

Process the selected rows independently. Collect row-local typed decode and rotation failures and continue, then query PostgreSQL for any namespace row whose key differs from the current key. This final query, rather than the selected row count, determines `remaining`.

## Verification

Deterministic unit coverage proves a missing historic key does not pin a later row and a CAS loser still produces `remaining: true` when its stale row remains. Live PostgreSQL coverage proves a skipped row is reported, a sibling row rotates, and restoring the missing key completes rotation.
