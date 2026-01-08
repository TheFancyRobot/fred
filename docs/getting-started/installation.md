# Installation

Fred is built for the Bun runtime and uses the Vercel AI SDK. Follow these steps to get started.

## Prerequisites

- **Bun**: Version 1.0 or higher ([Install Bun](https://bun.sh))
- **Node.js**: Optional, if using npm instead of Bun
- **API Keys**: At least one AI provider API key (OpenAI, Groq, etc.)

## Install Fred

### Using create-fred (Recommended)

The easiest way to get started is using `create-fred`, which sets up a complete project with all dependencies:

```bash
bunx create-fred my-project
```

This will:
- Create a new Fred project
- Automatically install all dependencies
- Set up the embedded `fred` CLI
- Include example code and configuration

See the [Quick Start Guide](quick-start.md) for next steps.

### Manual Installation

If you prefer to install Fred in an existing project:

#### Using Bun

```bash
bun add fred
```

#### Using npm

```bash
npm install fred
```

#### Using yarn

```bash
yarn add fred
```

## Install Provider Packages

Fred supports all @ai-sdk providers. Install the ones you need:

### Using the Embedded CLI (Recommended)

If you created your project with `create-fred`, use the embedded CLI:

```bash
fred provider add openai
fred provider add groq
fred provider add anthropic
```

This automatically installs the package and updates your configuration.

### Manual Installation

```bash
# OpenAI
bun add @ai-sdk/openai

# Groq
bun add @ai-sdk/groq

# Anthropic
bun add @ai-sdk/anthropic

# Google
bun add @ai-sdk/google

# Or install multiple at once
bun add @ai-sdk/openai @ai-sdk/groq @ai-sdk/anthropic
```

## Verify Installation

Create a simple test file to verify everything works:

```typescript
import { Fred } from 'fred';

const fred = new Fred();
console.log('Fred installed successfully!');
```

Run it:

```bash
bun run test.ts
```

## Environment Variables

Set your API keys as environment variables:

```bash
export OPENAI_API_KEY=your_openai_key
export GROQ_API_KEY=your_groq_key
export ANTHROPIC_API_KEY=your_anthropic_key
```

Or create a `.env` file:

```env
OPENAI_API_KEY=your_openai_key
GROQ_API_KEY=your_groq_key
ANTHROPIC_API_KEY=your_anthropic_key
```

## Next Steps

- Read the [Quick Start Guide](quick-start.md)
- Learn about [Configuration](configuration.md)
- Use the [Embedded CLI](../guides/cli.md) to manage your project

