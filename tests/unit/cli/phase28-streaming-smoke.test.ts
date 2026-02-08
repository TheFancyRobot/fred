/**
 * Phase 28 smoke tests
 *
 * End-to-end CLI/TUI checks for streaming chat flow, command palette,
 * multiline input, smart-scroll behavior, and status telemetry updates.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import { FredTuiApp } from '../../../packages/cli/src/tui/app';

const mockApp = {
  stop: mock(() => {}),
  isRunning: () => true,
  getState: () => ({}),
};

const mockCreateFredTuiApp = mock(async () => mockApp);

mock.module('../../../packages/cli/src/tui/app', () => ({
  createFredTuiApp: mockCreateFredTuiApp,
  FredTuiApp,
}));

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

describe('Phase 28 streaming smoke', () => {
  let originalStdin: typeof process.stdin;
  let originalStdout: typeof process.stdout;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
    originalExit = process.exit;
    mockCreateFredTuiApp.mockClear();
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    });
    Object.defineProperty(process, 'stdout', {
      value: originalStdout,
      configurable: true,
    });
    (process as any).exit = originalExit;
  });

  test('launches interactive TTY mode via handleChatCommand', async () => {
    const mockStdin = {
      isTTY: true,
      isRaw: false,
      setRawMode: mock(() => {}),
    } as any;
    const mockStdout = {
      isTTY: true,
      columns: 120,
      rows: 40,
    } as any;

    Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true });
    (process as any).exit = mock(() => {});

    const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');
    await handleChatCommand();

    expect(mockCreateFredTuiApp).toHaveBeenCalledTimes(1);
  });

  test('streams assistant output, opens palette, and preserves smart-scroll under load', async () => {
    const setup = await createTestRenderer({ width: 120, height: 40 });
    const submissions: string[] = [];
    const app = FredTuiApp.createWithRenderer(setup.renderer, {
      onSubmit: (text) => submissions.push(text),
    });

    try {
      app.processKey(makeKey({ name: 'h' }));
      app.processKey(makeKey({ name: 'i' }));
      app.processKey(makeKey({ name: 'enter', shift: true }));
      app.processKey(makeKey({ name: 't' }));
      app.processKey(makeKey({ name: 'h' }));
      app.processKey(makeKey({ name: 'e' }));
      app.processKey(makeKey({ name: 'r' }));
      app.processKey(makeKey({ name: 'e' }));
      app.processKey(makeKey({ name: 'enter' }));

      expect(submissions).toEqual(['hi\nthere']);
      const afterSubmit = app.getState();
      expect(afterSubmit.transcript.messages[afterSubmit.transcript.messages.length - 1]).toEqual({
        role: 'user',
        content: 'hi\nthere',
      });
      expect(afterSubmit.streaming.isStreaming).toBe(true);

      for (let i = 0; i < 48; i += 1) {
        app.pushAssistantToken(`token-${i}\n`);
      }

      await Bun.sleep(120);

      const streamingStatus = String((app as unknown as { lastStatusLine?: string }).lastStatusLine ?? '');
      expect(streamingStatus).toContain('streaming');
      expect(streamingStatus).toContain('tok/s');
      expect(streamingStatus).toContain('lat ');

      app.processKey(makeKey({ name: 'k', ctrl: true }));
      expect(app.getState().commandPalette.isOpen).toBe(true);
      app.processKey(makeKey({ name: 'f' }));
      app.processKey(makeKey({ name: 'o' }));
      app.processKey(makeKey({ name: 'c' }));
      app.processKey(makeKey({ name: 'u' }));
      app.processKey(makeKey({ name: 's' }));
      expect(app.getState().commandPalette.filteredActions.length).toBeGreaterThan(0);

      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain('[Command Palette]');

      app.processKey(makeKey({ name: 'escape' }));
      expect(app.getState().commandPalette.isOpen).toBe(false);

      app.processKey(makeKey({ name: 'tab' }));
      app.processKey(makeKey({ name: 'tab' }));
      expect(app.getState().focusedPane).toBe('transcript');

      app.processKey(makeKey({ name: 'pageup' }));
      const scrolled = app.getState();
      const offsetBeforeMoreTokens = scrolled.transcript.viewport.scrollOffset;
      expect(scrolled.transcript.viewport.pinnedToBottom).toBe(false);

      app.pushAssistantToken('tail-token\n');
      await Bun.sleep(60);

      const whileStreaming = app.getState();
      expect(whileStreaming.transcript.viewport.scrollOffset).toBe(offsetBeforeMoreTokens);
      expect(whileStreaming.transcript.viewport.pinnedToBottom).toBe(false);

      app.completeAssistantStream();
      await Bun.sleep(40);

      const idleStatus = String((app as unknown as { lastStatusLine?: string }).lastStatusLine ?? '');
      expect(idleStatus).not.toContain('streaming');
      expect(idleStatus).toContain('cost $');
      expect(idleStatus).toContain('tok in:');
    } finally {
      if (app.isRunning()) {
        app.stop();
      }
      setup.renderer.destroy();
    }
  });
});
