import { Fred } from '@fancyrobot/fred';

async function main() {
  const fred = await Fred.create();

  try {
    await fred.registerProviderPack('openai');

    await fred.configureMCPServers([
      {
        id: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/mcp-demo'],
      },
    ]);

    const serverStatus = fred.getMCPServerRegistry().getServerStatus('filesystem');
    if (serverStatus !== 'connected') {
      console.warn(
        '[MCP] Filesystem server is not connected. Check npx availability and server command, then retry.'
      );
      return;
    }

    await fred.createAgent({
      id: 'file-assistant',
      systemMessage: 'You are a file management assistant. Use MCP tools to read, write, and manage files.',
      platform: 'openai',
      model: 'gpt-4o-mini',
      mcpServers: ['filesystem'],
    });

    fred.setDefaultAgent('file-assistant');

    console.log('=== MCP Integration Demo ===');
    console.log('Connected to filesystem MCP server. MCP tools are auto-discovered from configured server IDs.');
    console.log('');

    const response = await fred.processMessage('List the files in /tmp/mcp-demo');
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
