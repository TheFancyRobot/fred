import { describe, expect, test, spyOn, mock } from 'bun:test';
import { handleDevCommand } from '../../../src/cli/dev';
import * as devChat from '../../../src/dev-chat';

describe('handleDevCommand Langfuse flag', () => {
  test('passes disableLangfuse=true when --no-langfuse is set', async () => {
    const startSpy = spyOn(devChat, 'startDevChat').mockResolvedValue();

    await handleDevCommand({ noLangfuse: true });

    expect(startSpy).toHaveBeenCalled();
    const [, options] = startSpy.mock.calls[0];
    expect(options?.disableLangfuse).toBe(true);

    startSpy.mockRestore();
  });

  test('does not set disableLangfuse when flag not provided', async () => {
    const startSpy = spyOn(devChat, 'startDevChat').mockResolvedValue();

    await handleDevCommand({});

    expect(startSpy).toHaveBeenCalled();
    const [, options] = startSpy.mock.calls[0];
    expect(options?.disableLangfuse).toBeUndefined();

    startSpy.mockRestore();
  });
});
