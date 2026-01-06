# Development Chat

Fred includes a development chat interface for quickly testing agents and intents during development.

## Starting Dev Chat

```bash
bun run dev
```

This starts an interactive terminal chat interface with hot reload.

## Features

### Hot Reload

The dev chat automatically reloads when you change code:

```
💬 Fred Dev Chat (Conversation ID: conv_1234567890_abc123)
Type your messages and press Enter. Type "exit" or "quit" to stop.
💡 Tip: Code changes will automatically reload Fred while preserving context!

> Hello!

🤖 Hello! How can I help you today?

[You edit your agent code...]

🔄 Reloading Fred...
✅ Loaded config from /path/to/config.json
✅ Preserved conversation context (2 messages)
✅ Fred reloaded successfully!

> What did I just say?

🤖 You said "Hello!" earlier in our conversation.
```

### Context Preservation

Conversation context is maintained across reloads, so you can continue testing without losing conversation history.

### Auto-Config Loading

The dev chat automatically loads config files if they exist:

- `config.json`
- `fred.config.json`
- `config.yaml`
- `fred.config.yaml`

## Commands

### exit / quit

Exit the chat interface:

```
> exit
👋 Goodbye!
```

### clear / /clear

Clear conversation context and start fresh:

```
> clear
🧹 Conversation cleared. New conversation started.
```

### help / /help

Show available commands:

```
> help
📖 Commands:
  exit, quit  - Exit the chat
  clear, /clear - Clear conversation context
  help, /help - Show this help message
```

## Usage Example

```bash
$ bun run dev

💬 Fred Dev Chat (Conversation ID: conv_1234567890_abc123)
Type your messages and press Enter. Type "exit" or "quit" to stop.
💡 Tip: Code changes will automatically reload Fred while preserving context!

> Hello!

🤖 Hello! How can I help you today?

> Calculate 5 + 3

🤖 The result is 8.

> [Edit code to add new intent...]

🔄 Reloading Fred...
✅ Fred reloaded successfully!

> Test new intent

🤖 [Response from new intent]
```

## File Watching

The dev chat watches these paths for changes:

- `src/` directory (recursive)
- `config.json`
- `fred.config.json`
- `config.yaml`
- `fred.config.yaml`

Changes trigger automatic reload with a 500ms debounce.

## Configuration

The dev chat uses the same configuration as your application:

1. Loads config files automatically
2. Uses environment variables for API keys
3. Registers default providers if no config

## Best Practices

1. **Keep Terminal Open**: Leave the dev chat running while developing
2. **Test Incrementally**: Test changes as you make them
3. **Use Clear Command**: Clear context when testing new features
4. **Watch for Reloads**: Check reload messages to ensure changes are picked up

## Troubleshooting

### Reload Not Working

- Check that files are being saved
- Verify file paths are correct
- Check console for error messages

### Context Not Preserved

- Ensure conversation ID is maintained
- Check that context manager is working
- Verify no errors during reload

### No Response

- Ensure default agent is set
- Check that providers are configured
- Verify API keys are set

## Next Steps

- Learn about [Agents](agents.md)
- Explore [Intents](intents.md)
- Check [Examples](../examples/basic-usage.md)

