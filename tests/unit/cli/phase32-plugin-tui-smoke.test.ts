import { describe, expect, test, afterEach } from 'bun:test';
import type { KeyEvent } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { FredTuiApp } from '../../../packages/cli/src/tui/app.js';

function makeKey(overrides: Partial<KeyEvent> & { name: string }): KeyEvent {
  return {
    name: overrides.name,
    sequence: overrides.sequence ?? '',
    ctrl: overrides.ctrl ?? false,
    shift: overrides.shift ?? false,
    meta: overrides.meta ?? false,
    option: overrides.option ?? false,
    eventType: overrides.eventType ?? 'press',
    repeated: overrides.repeated ?? false,
  } as KeyEvent;
}

function typeText(app: FredTuiApp, text: string): void {
  for (const char of text) {
    app.processKey(makeKey({ name: char === ' ' ? 'space' : char }));
  }
}

describe('phase 32 plugin TUI smoke', () => {
  let testSetup: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
  let app: FredTuiApp | undefined;

  afterEach(() => {
    if (app && app.isRunning()) {
      app.stop();
    }
    if (testSetup) {
      try {
        testSetup.renderer.destroy();
      } catch {
        // renderer already destroyed
      }
    }
    app = undefined;
    testSetup = undefined;
  });

  test('keeps palette/typed slash parity, hides unavailable commands, and renders slash result/error messages', async () => {
    testSetup = await createTestRenderer({ width: 120, height: 40 });
    app = FredTuiApp.createWithRenderer(testSetup.renderer, {}, {
      pluginSlashCommands: [
        {
          pluginId: 'alpha',
          commandId: 'deploy',
          summary: 'Deploy preview',
          usage: '/alpha:deploy [target]',
          available: true,
          execute: async (args) => `alpha:${args}`,
        },
        {
          pluginId: 'beta',
          commandId: 'deploy',
          summary: 'Deploy stable',
          usage: '/beta:deploy [target]',
          available: true,
          execute: async (args) => `beta:${args}`,
        },
        {
          pluginId: 'gamma',
          commandId: 'explode',
          summary: 'Throw error',
          usage: '/gamma:explode',
          available: true,
          execute: async () => {
            throw new Error('boom');
          },
        },
        {
          pluginId: 'hidden',
          commandId: 'secret',
          summary: 'Hidden command',
          usage: '/hidden:secret',
          available: false,
          execute: async () => 'hidden',
        },
      ],
    });

    const slashActions = app.getState().commandPalette.actions.filter((action) => action.kind === 'plugin-slash');
    const slashNames = slashActions.map((action) => action.plugin?.canonicalName);
    expect(slashNames).toContain('/alpha:deploy');
    expect(slashNames).toContain('/beta:deploy');
    expect(slashNames).not.toContain('/hidden:secret');

    const alphaDeploy = slashActions.find((action) => action.plugin?.canonicalName === '/alpha:deploy');
    expect(alphaDeploy?.plugin?.hasCollision).toBe(true);

    app.processKey(makeKey({ name: 'k', ctrl: true }));
    typeText(app, 'deploy');
    app.processKey(makeKey({ name: 'enter' }));
    await Bun.sleep(10);

    let state = app.getState();
    const paletteResult = state.transcript.messages[state.transcript.messages.length - 1];
    expect(paletteResult?.content).toContain('alpha:');

    typeText(app, '/alpha:deploy preview');
    app.processKey(makeKey({ name: 'enter' }));
    await Bun.sleep(10);

    state = app.getState();
    const typedResult = state.transcript.messages[state.transcript.messages.length - 1];
    expect(typedResult?.content).toContain('alpha:preview');

    typeText(app, '/gamma:explode');
    app.processKey(makeKey({ name: 'enter' }));
    await Bun.sleep(10);

    state = app.getState();
    const slashError = state.transcript.messages[state.transcript.messages.length - 1];
    expect(slashError?.content).toContain('[plugin:gamma]');
    expect(slashError?.content).toContain('failed');
    expect(state.streaming.lastError).toContain('[plugin:gamma]');
  });
});
