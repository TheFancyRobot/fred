import type { Fred, FredClient } from '@fancyrobot/fred';
import { setupExample } from './src/runtime';

export async function setupFredProject(
  fred: Fred | FredClient,
  context: { configPath: string; projectRoot: string },
): Promise<void> {
  void context.projectRoot;
  await setupExample(fred, { configPath: context.configPath });
}
