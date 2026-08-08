import { describe, expect, test, afterEach } from 'bun:test';
import type { KeyEvent } from '@opentui/core';
import { createTestRenderer } from '@opentui/core/testing';
import { createFred } from '@fancyrobot/fred';
import { buildBuiltinSlashCommands } from '../../../packages/cli/src/commands/chat.js';
import {
  createInitialTuiStateWithPlugins,
  openCommandPalette,
  updateCommandPaletteQuery,
  updateInputText,
} from '../../../packages/cli/src/tui/state.js';
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

describe('TUI plugin slash commands', () => {
  const pluginSlashCommands = [
    {
      pluginId: 'alpha',
      commandId: 'deploy',
      summary: 'Deploy preview',
      usage: '/alpha:deploy [target]',
      available: true,
    },
    {
      pluginId: 'beta',
      commandId: 'deploy',
      summary: 'Deploy stable',
      usage: '/beta:deploy [target]',
      available: true,
    },
    {
      pluginId: 'hidden',
      commandId: 'secret',
      summary: 'Hidden command',
      available: false,
    },
  ] as const;

  test('palette ordering keeps built-ins before plugin slash commands', () => {
    let state = createInitialTuiStateWithPlugins(pluginSlashCommands);
    state = openCommandPalette(state);

    const firstPluginIndex = state.commandPalette.filteredActions.findIndex((action) => action.kind === 'plugin-slash');
    const lastBuiltinIndex = state.commandPalette.filteredActions
      .map((action, index) => ({ action, index }))
      .filter((entry) => entry.action.kind !== 'plugin-slash')
      .map((entry) => entry.index)
      .pop();

    expect(firstPluginIndex).toBeGreaterThanOrEqual(0);
    expect(lastBuiltinIndex).toBeDefined();
    expect(firstPluginIndex).toBeGreaterThan(lastBuiltinIndex ?? -1);
  });

  test('typed slash query uses same plugin ordering as palette query', () => {
    let state = createInitialTuiStateWithPlugins(pluginSlashCommands);
    state = openCommandPalette(state);
    state = updateCommandPaletteQuery(state, 'deploy');

    const paletteSlash = state.commandPalette.filteredActions
      .filter((action) => action.kind === 'plugin-slash')
      .map((action) => action.plugin?.canonicalName);

    state = updateInputText(state, '/deploy');
    const typedSlash = state.input.slashSearch.filteredActions
      .filter((action) => action.kind === 'plugin-slash')
      .map((action) => action.plugin?.canonicalName);

    expect(typedSlash).toEqual(paletteSlash);
  });

  test('plugin slash names are namespaced and unavailable commands are hidden', () => {
    const state = createInitialTuiStateWithPlugins(pluginSlashCommands);

    const canonicalNames = state.commandPalette.actions
      .filter((action) => action.kind === 'plugin-slash')
      .map((action) => action.plugin?.canonicalName);

    expect(canonicalNames).toContain('/alpha:deploy');
    expect(canonicalNames).toContain('/beta:deploy');
    expect(canonicalNames).not.toContain('/hidden:secret');
  });

  test('collision metadata is visible for duplicate command ids', () => {
    const state = createInitialTuiStateWithPlugins(pluginSlashCommands);

    const alphaDeploy = state.commandPalette.actions.find(
      (action) => action.kind === 'plugin-slash' && action.plugin?.canonicalName === '/alpha:deploy',
    );
    expect(alphaDeploy?.plugin?.hasCollision).toBe(true);
    expect(alphaDeploy?.label).toContain('collision');
  });

  describe('execution path', () => {
    let testSetup: Awaited<ReturnType<typeof createTestRenderer>>;
    let app: FredTuiApp;

    afterEach(() => {
      if (app && app.isRunning()) {
        app.stop();
      }
      if (testSetup) {
        try {
          testSetup.renderer.destroy();
        } catch {
          // already destroyed
        }
      }
    });

    test('typed slash success and failure render into transcript with plugin identity', async () => {
      testSetup = await createTestRenderer({ width: 120, height: 40 });
      app = FredTuiApp.createWithRenderer(testSetup.renderer, {}, {
        pluginSlashCommands: [
          {
            pluginId: 'alpha',
            commandId: 'echo',
            summary: 'Echo text',
            usage: '/alpha:echo <text>',
            available: true,
            execute: async (args) => `alpha:${args}`,
          },
          {
            pluginId: 'beta',
            commandId: 'explode',
            summary: 'Throw error',
            available: true,
            execute: async () => {
              throw new Error('boom');
            },
          },
        ],
      });

      for (const key of '/alpha:echo hello') {
        app.processKey(makeKey({ name: key === ' ' ? 'space' : key }));
      }
      app.processKey(makeKey({ name: 'enter' }));
      await Bun.sleep(10);

      let state = app.getState();
      const successMessage = state.transcript.messages[state.transcript.messages.length - 1];
      expect(successMessage?.content).toContain('alpha:hello');

      for (const key of '/beta:explode') {
        app.processKey(makeKey({ name: key === ' ' ? 'space' : key }));
      }
      app.processKey(makeKey({ name: 'enter' }));
      await Bun.sleep(10);

      state = app.getState();
      const errorMessage = state.transcript.messages[state.transcript.messages.length - 1];
      expect(errorMessage?.content).toContain('[plugin:beta]');
      expect(errorMessage?.content).toContain('failed');
      expect(state.streaming.lastError).toContain('[plugin:beta]');
    });

    test('/login is an alias for the shared Fred provider-login command', async () => {
      const fred = await createFred();
      try {
        testSetup = await createTestRenderer({ width: 120, height: 40 });
        app = FredTuiApp.createWithRenderer(testSetup.renderer, {}, {
          pluginSlashCommands: buildBuiltinSlashCommands(fred, {
            providerLogin: async (args) => `provider-login:${args}`,
          }),
        });

        for (const key of '/login openrouter team') {
          app.processKey(makeKey({ name: key === ' ' ? 'space' : key }));
        }
        app.processKey(makeKey({ name: 'enter' }));
        await Bun.sleep(10);

        expect(app.getState().transcript.messages.some(
          (message) => message.content.includes('provider-login:openrouter team'),
        )).toBe(true);
        expect(app.getState().focusedPane).toBe('input');
      } finally {
        await fred.shutdown();
      }
    });
  });
});
