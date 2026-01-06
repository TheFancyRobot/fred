# Installation

Fred is built for the Bun runtime and uses the Vercel AI SDK. Follow these steps to get started.

## Prerequisites

- **Bun**: Version 1.0 or higher ([Install Bun](https://bun.sh))
- **Node.js**: Optional, if using npm instead of Bun
- **API Keys**: At least one AI provider API key (OpenAI, Groq, etc.)

## Install Fred

### Using Bun (Recommended)

```bash
bun add fred
```

### Using npm

```bash
npm install fred
```

### Using yarn

```bash
yarn add fred
```

## Install Provider Packages

Fred supports all @ai-sdk providers. Install the ones you need:

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

