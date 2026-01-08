# Embedded CLI Commands

Fred projects include a built-in CLI tool that helps you manage your project without installing additional packages. The CLI is available immediately after creating a project with `create-fred`.

## Overview

The `fred` CLI provides commands for:
- Managing AI SDK providers
- Creating new agents
- Creating new tools

All commands work within your project directory and modify your project files automatically.

## Provider Management

### Add a Provider

Install an AI SDK provider package and update your project configuration:

```bash
fred provider add <provider>
```

**Example:**
```bash
fred provider add groq
fred provider add anthropic
```

This will:
- Install the `@ai-sdk/<provider>` package
- Update `.env.example` with the API key variable
- Provide instructions for using the provider in your code

**Supported Providers:**
- `openai` - OpenAI
- `groq` - Groq
- `anthropic` - Anthropic
- `google` - Google
- `mistral` - Mistral
- `cohere` - Cohere
- `vercel` - Vercel AI
- `azure-openai` - Azure OpenAI
- `azure-anthropic` - Azure Anthropic
- `fireworks` - Fireworks
- `xai` - X.AI
- `ollama` - Ollama
- `ai21` - AI21
- `nvidia` - NVIDIA
- `bedrock` - Amazon Bedrock
- `cloudflare` - Cloudflare
- `elevenlabs` - ElevenLabs
- `lepton` - Lepton
- `perplexity` - Perplexity
- `replicate` - Replicate
- `together` - Together AI
- `upstash` - Upstash

### Remove a Provider

Remove a provider package and clean up configuration:

```bash
fred provider remove <provider>
```

**Example:**
```bash
fred provider remove openai
```

This will:
- Uninstall the `@ai-sdk/<provider>` package
- Remove the API key variable from `.env.example`
- Warn if any agents are using the provider

### List Providers

View all installed AI SDK providers:

```bash
fred provider list
```

## Agent Creation

Create a new agent interactively:

```bash
fred agent create
```

The CLI will prompt you for:
- **Agent ID**: Unique identifier (kebab-case, e.g., `math-assistant`)
- **System Message**: What the agent should do
- **Platform**: Select from installed providers
- **Model**: Model name (default suggested based on platform)
- **Temperature**: Optional temperature setting (default: 0.7)
- **Tools**: Multi-select from existing tools (optional)

**Example:**
```bash
$ fred agent create

🤖 Create a new agent

Agent ID (kebab-case, e.g., math-assistant): coding-assistant
System message (what should this agent do?): You are a helpful coding assistant.
Select platform:
  1. openai
  2. groq
Select (1-2): 1
Model name (default: gpt-3.5-turbo): gpt-4
Temperature (0.0-2.0) (default: 0.7): 0.3
Would you like to assign tools to this agent? (y/N): n

✅ Successfully created agent: coding-assistant

File created: src/agents/coding-assistant.ts
The agent has been added to src/index.ts.
```

The generated agent file will be in `src/agents/<agent-id>.ts` and automatically imported into `src/index.ts`.

## Tool Creation

Create a new tool interactively:

```bash
fred tool create
```

The CLI will prompt you for:
- **Tool ID**: Unique identifier (kebab-case, e.g., `weather-api`)
- **Tool Name**: Display name
- **Description**: What the tool does
- **Parameters**: Whether the tool needs parameters (JSON schema can be customized later)

**Example:**
```bash
$ fred tool create

🛠️  Create a new tool

Tool ID (kebab-case, e.g., calculator): weather-api
Tool name (display name): Weather API
Tool description (what does this tool do?): Get current weather for a location
Tool parameters (JSON schema):
Does this tool need parameters? (Y/n): y

✅ Successfully created tool: weather-api

File created: src/tools/weather-api.ts
The tool has been added to src/index.ts.

Next steps:
1. Edit src/tools/weather-api.ts to implement the execute function
2. Customize the parameters schema if needed
```

The generated tool file will be in `src/tools/<tool-id>.ts` and automatically imported into `src/index.ts`.

## Help

Get help for all available commands:

```bash
fred help
```

Or use `--help` with any command:

```bash
fred provider --help
fred agent --help
fred tool --help
```

## How It Works

The embedded CLI:
- **No additional dependencies**: Uses only Bun's built-in capabilities
- **Automatic file updates**: Modifies `src/index.ts`, `package.json`, and `.env.example` as needed
- **Safe operations**: Validates inputs and checks for existing files before creating
- **Interactive prompts**: Guides you through complex operations like agent/tool creation

## Tips

1. **Provider Management**: Use `fred provider add` to quickly add new AI providers without manually editing `package.json`

2. **Agent Scaffolding**: Use `fred agent create` to quickly scaffold new agents with proper TypeScript types and imports

3. **Tool Development**: Use `fred tool create` to generate tool boilerplate, then customize the `execute` function

4. **Project Structure**: The CLI maintains a clean project structure by creating separate files for each agent and tool

## Troubleshooting

### Command not found

If `fred` command is not found, make sure:
- You're in your project directory
- Dependencies were installed (`bun install` if you used `--no-install`)
- The `bin` entry in `package.json` points to `./src/cli.ts`

### File modification errors

If the CLI can't modify files:
- Ensure you have write permissions
- Check that `src/index.ts` exists and has the expected structure
- Verify the project is a valid Fred project (has `fred` in dependencies)

### Provider installation fails

If `fred provider add` fails:
- Check your internet connection
- Verify the provider name is correct
- Ensure Bun is properly installed and in your PATH
