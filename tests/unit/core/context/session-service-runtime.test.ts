/**
 * Phase 62 / STEP-62-02: SessionService wired into the scoped runtime.
 *
 * Verifies the ambient session service is part of the createFred runtime:
 * `sessions.open` works from the Promise client, and the same SessionService
 * is reachable through the Effect-native client boundary.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { Effect, Option } from 'effect';
import { createFred, type FredClient } from '../../../../packages/core/src/client';
import { SessionService } from '../../../../packages/core/src/services';

const clients: FredClient[] = [];
const track = (c: FredClient): FredClient => (clients.push(c), c);

afterEach(async () => {
  while (clients.length > 0) await clients.pop()!.shutdown();
});

describe('SessionService in the createFred runtime', () => {
  it('sessions.open resumes a given id and mints a fresh one otherwise', async () => {
    const client = track(await createFred());

    const resumed = await client.sessions.open('conv_fixed');
    expect(resumed.id).toBe('conv_fixed' as typeof resumed.id);

    const fresh = await client.sessions.open();
    expect(typeof fresh.id).toBe('string');
    expect((fresh.id as string).length).toBeGreaterThan(0);
    expect(fresh.id).not.toBe(resumed.id);
  });

  it('SessionService resolves and propagates ambient session via effects.run', async () => {
    const client = track(await createFred());

    const seen = await client.effects.run(
      Effect.flatMap(SessionService, (svc) =>
        svc.withSession(
          'conv_ambient',
          Effect.map(svc.current, Option.map((h) => h.id as string)),
        ),
      ),
    );
    expect(seen).toEqual(Option.some('conv_ambient'));
  });

  it('has no ambient session outside withSession on the shared runtime', async () => {
    const client = track(await createFred());
    const current = await client.effects.run(
      Effect.flatMap(SessionService, (svc) => svc.current),
    );
    expect(Option.isNone(current)).toBe(true);
  });
});
