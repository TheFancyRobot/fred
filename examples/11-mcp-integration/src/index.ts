import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

async function main() {
  const fred = await createFred({ configPath: './config.yaml' });

  try {
    const serverStatus = await fred.mcp.status('filesystem');
    if (serverStatus !== 'connected') {
      console.warn(
        '[MCP] Filesystem server is not connected. Check npx availability and server command, then retry.'
      );
      return;
    }

    console.log('=== MCP Integration Demo ===');
    console.log('Connected to filesystem MCP server. MCP tools are auto-discovered from configured server IDs.');
    console.log('');

    const response = await fred.messages.process('List the files in /tmp/mcp-demo');
    console.log('Response:', response?.content ?? '(no response content)');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[MCP] Request failed:', message);
    console.error('If the MCP server is down, restart it and run this example again.');
  } finally {
    await fred.shutdown();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exitCode = 1;
});
