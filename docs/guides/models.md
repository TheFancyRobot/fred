# AI Models Reference

This document provides a comprehensive list of all AI models supported by Fred through the Vercel AI SDK. Models are organized by provider.

## Overview

Fred supports all models available through the [Vercel AI SDK](https://ai-sdk.dev/docs/foundations/providers-and-models). The AI SDK provides a unified interface to interact with models from various providers.

> **Note**: Model names and availability may change. Always refer to the provider's official documentation for the most up-to-date model list.

## OpenAI

**Provider**: `openai`  
**Environment Variable**: `OPENAI_API_KEY`

### Chat Models

- `gpt-5.2-pro` - Latest GPT-5.2 Pro model
- `gpt-5.2-chat-latest` - Latest GPT-5.2 Chat
- `gpt-5.2` - GPT-5.2 base model
- `gpt-5.1-chat-latest` - Latest GPT-5.1 Chat
- `gpt-5.1-codex-mini` - GPT-5.1 Codex Mini
- `gpt-5.1-codex` - GPT-5.1 Codex
- `gpt-5.1` - GPT-5.1 base model
- `gpt-5-codex` - GPT-5 Codex
- `gpt-5-chat-latest` - Latest GPT-5 Chat
- `gpt-5` - GPT-5 base model
- `gpt-5-mini` - GPT-5 Mini
- `gpt-5-nano` - GPT-5 Nano
- `gpt-4o` - GPT-4 Optimized
- `gpt-4-turbo` - GPT-4 Turbo
- `gpt-4` - GPT-4
- `gpt-3.5-turbo` - GPT-3.5 Turbo (recommended for cost-effective use)

### Embedding Models

- `text-embedding-3-large` - Large embedding model
- `text-embedding-3-small` - Small embedding model
- `text-embedding-ada-002` - Ada embedding model

### Image Generation Models

- `dall-e-3` - DALL-E 3 image generation
- `dall-e-2` - DALL-E 2 image generation
- `gpt-image-1` - GPT image generation

### Speech Models

- `tts-1-hd` - High-definition text-to-speech
- `tts-1` - Standard text-to-speech
- `gpt-4o-mini-tts` - GPT-4o Mini text-to-speech

## Anthropic

**Provider**: `anthropic`  
**Environment Variable**: `ANTHROPIC_API_KEY`

### Chat Models

- `claude-opus-4-5` - Latest Claude Opus 4.5
- `claude-opus-4-1` - Claude Opus 4.1
- `claude-opus-4-0` - Claude Opus 4.0
- `claude-sonnet-4-0` - Claude Sonnet 4.0
- `claude-3-7-sonnet-latest` - Latest Claude 3.7 Sonnet
- `claude-3-5-haiku-latest` - Latest Claude 3.5 Haiku (recommended for fast, cost-effective use)
- `claude-3-opus-20240229` - Claude 3 Opus
- `claude-3-sonnet-20240229` - Claude 3 Sonnet
- `claude-3-haiku-20240307` - Claude 3 Haiku

## Google Generative AI

**Provider**: `google`  
**Environment Variable**: `GOOGLE_GENERATIVE_AI_API_KEY`

### Chat Models

- `gemini-2.0-flash-exp` - Experimental Gemini 2.0 Flash
- `gemini-1.5-flash` - Gemini 1.5 Flash (recommended for fast responses)
- `gemini-1.5-pro` - Gemini 1.5 Pro
- `gemini-pro` - Gemini Pro

### Embedding Models

- `text-embedding-004` - Text embedding model
- `gemini-embedding-001` - Gemini embedding model

## Mistral

**Provider**: `mistral`  
**Environment Variable**: `MISTRAL_API_KEY`

### Chat Models

- `pixtral-large-latest` - Latest Pixtral Large (supports images)
- `mistral-large-latest` - Latest Mistral Large
- `mistral-medium-latest` - Latest Mistral Medium
- `mistral-medium-2505` - Mistral Medium 2505
- `mistral-small-latest` - Latest Mistral Small (recommended for cost-effective use)
- `pixtral-12b-2409` - Pixtral 12B (supports images)

## Groq

**Provider**: `groq`  
**Environment Variable**: `GROQ_API_KEY`

### Chat Models

- `meta-llama/llama-4-scout-17b-16e-instruct` - Llama 4 Scout (supports images)
- `llama-3.3-70b-versatile` - Llama 3.3 70B Versatile (recommended, v2-compatible)
- `llama-3.1-8b-instant` - Llama 3.1 8B Instant (fast, v2-compatible)
- `mixtral-8x7b-32768` - Mixtral 8x7B
- `gemma2-9b-it` - Gemma2 9B Instruct

> **Note**: `llama-3.1-70b-versatile` has been deprecated. Use `llama-3.3-70b-versatile` instead.

## DeepSeek

**Provider**: `deepseek`  
**Environment Variable**: `DEEPSEEK_API_KEY`

### Chat Models

- `deepseek-chat` - DeepSeek Chat (recommended)
- `deepseek-reasoner` - DeepSeek Reasoner

## Cerebras

**Provider**: `cerebras`  
**Environment Variable**: `CEREBRAS_API_KEY`

### Chat Models

- `llama3.3-70b` - Llama 3.3 70B
- `llama3.1-70b` - Llama 3.1 70B
- `llama3.1-8b` - Llama 3.1 8B

## Cohere

**Provider**: `cohere`  
**Environment Variable**: `COHERE_API_KEY`

### Chat Models

- `command` - Command model (recommended)
- `command-light` - Command Light
- `command-r` - Command R
- `command-r-plus` - Command R Plus

### Embedding Models

- `embed-english-v3.0` - English embeddings
- `embed-multilingual-v3.0` - Multilingual embeddings

## Perplexity

**Provider**: `perplexity`  
**Environment Variable**: `PERPLEXITY_API_KEY`

### Chat Models

- `llama-3.1-sonar-small-128k-online` - Sonar Small (online, recommended)
- `llama-3.1-sonar-large-128k-online` - Sonar Large (online)
- `llama-3.1-sonar-small-128k-chat` - Sonar Small (chat)
- `llama-3.1-sonar-large-128k-chat` - Sonar Large (chat)

## Fireworks

**Provider**: `fireworks`  
**Environment Variable**: `FIREWORKS_API_KEY`

### Chat Models

- `accounts/fireworks/models/llama-v3-70b-instruct` - Llama v3 70B Instruct
- `accounts/fireworks/models/llama-v3-8b-instruct` - Llama v3 8B Instruct
- `accounts/fireworks/models/llama-v2-70b-chat` - Llama v2 70B Chat

## Together.ai

**Provider**: `together`  
**Environment Variable**: `TOGETHER_API_KEY`

### Chat Models

- `meta-llama/Llama-3-70b-chat-hf` - Llama 3 70B Chat
- `meta-llama/Llama-3-8b-chat-hf` - Llama 3 8B Chat
- `meta-llama/Llama-2-70b-chat-hf` - Llama 2 70B Chat

## X.AI (Grok)

**Provider**: `xai`  
**Environment Variable**: `XAI_API_KEY`

### Chat Models

- `grok-4` - Grok 4
- `grok-3` - Grok 3
- `grok-3-fast` - Grok 3 Fast
- `grok-3-mini` - Grok 3 Mini
- `grok-3-mini-fast` - Grok 3 Mini Fast
- `grok-2-1212` - Grok 2 1212
- `grok-beta` - Grok Beta (recommended)
- `grok-2-vision-1212` - Grok 2 Vision (supports images)
- `grok-vision-beta` - Grok Vision Beta (supports images)

## Replicate

**Provider**: `replicate`  
**Environment Variable**: `REPLICATE_API_KEY`

### Chat Models

- `meta/llama-2-70b-chat` - Llama 2 70B Chat
- `meta/llama-2-13b-chat` - Llama 2 13B Chat
- `meta/llama-2-7b-chat` - Llama 2 7B Chat

> **Note**: Replicate model names may include version hashes. Check Replicate's documentation for exact model identifiers.

## AI21

**Provider**: `ai21`  
**Environment Variable**: `AI21_API_KEY`

### Chat Models

- `j2-ultra` - Jurassic-2 Ultra
- `j2-mid` - Jurassic-2 Mid (recommended)
- `j2-grande` - Jurassic-2 Grande
- `j2-large` - Jurassic-2 Large

## NVIDIA

**Provider**: `nvidia`  
**Environment Variable**: `NVIDIA_API_KEY`

### Chat Models

- `meta/llama-3-70b-instruct` - Llama 3 70B Instruct
- `meta/llama-3-8b-instruct` - Llama 3 8B Instruct
- `mistralai/mistral-7b-instruct` - Mistral 7B Instruct

## Upstash

**Provider**: `upstash`  
**Environment Variable**: `UPSTASH_API_KEY`

### Chat Models

- `meta-llama/llama-3-70b-instruct` - Llama 3 70B Instruct
- `meta-llama/llama-3-8b-instruct` - Llama 3 8B Instruct

## Lepton

**Provider**: `lepton`  
**Environment Variable**: `LEPTON_API_KEY`

### Chat Models

- `llama3` - Llama 3
- `llama2` - Llama 2

## Amazon Bedrock

**Provider**: `bedrock` or `amazon-bedrock`  
**Environment Variable**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`

### Chat Models

- `amazon.titan-text-express-v1` - Titan Text Express
- `anthropic.claude-3-opus-20240229-v1:0` - Claude 3 Opus
- `anthropic.claude-3-sonnet-20240229-v1:0` - Claude 3 Sonnet
- `anthropic.claude-3-haiku-20240307-v1:0` - Claude 3 Haiku

### Embedding Models

- `amazon.titan-embed-text-v1` - Titan Embed Text v1
- `amazon.titan-embed-text-v2:0` - Titan Embed Text v2

### Image Generation Models

- `amazon.nova-canvas-v1:0` - Nova Canvas

## Azure OpenAI

**Provider**: `azure-openai` or `azure`  
**Configuration**: Requires Azure endpoint and API key

### Chat Models

Same models as OpenAI, accessed through Azure endpoints:
- `gpt-4`, `gpt-4-turbo`, `gpt-3.5-turbo`, etc.

## Azure Anthropic

**Provider**: `azure-anthropic`  
**Configuration**: Requires Azure endpoint and API key

### Chat Models

Same models as Anthropic, accessed through Azure endpoints:
- `claude-3-opus-20240229`, `claude-3-sonnet-20240229`, etc.

## Vercel

**Provider**: `vercel`  
**Configuration**: Requires Vercel API key

### Chat Models

- `v0-1.0-md` - Vercel v0 model (supports images and object generation)

## Ollama (Local)

**Provider**: `ollama`  
**Configuration**: Requires local Ollama instance (baseURL: `http://localhost:11434`)

### Chat Models

Any model available in your local Ollama installation:
- `llama2`, `llama3`, `mistral`, `codellama`, `phi`, etc.

> **Note**: Ollama requires a local installation. Models must be pulled locally before use.

## Cloudflare Workers AI

**Provider**: `cloudflare`  
**Configuration**: Requires Cloudflare account and API token

### Chat Models

- `@cf/meta/llama-2-7b-chat-fp16` - Llama 2 7B Chat
- `@cf/meta/llama-3-8b-instruct` - Llama 3 8B Instruct

## ElevenLabs (Speech)

**Provider**: `elevenlabs`  
**Environment Variable**: `ELEVENLABS_API_KEY`

### Speech Models

- `eleven_multilingual_v2` - Multilingual v2
- `eleven_v3` - Voice v3
- `flash` - Flash (fast)

## DeepInfra

**Provider**: `deepinfra`  
**Environment Variable**: `DEEPINFRA_API_KEY`

### Chat Models

Various open-source models hosted on DeepInfra. Check DeepInfra documentation for available models.

## Baseten

**Provider**: `baseten`  
**Environment Variable**: `BASETEN_API_KEY`

### Chat Models

Various models hosted on Baseten. Check Baseten documentation for available models.

## Model Selection Guide

### For Speed
- **Groq**: `llama-3.1-8b-instant` or `llama-3.3-70b-versatile`
- **Cloudflare**: `@cf/meta/llama-3-8b-instruct`
- **DeepSeek**: `deepseek-chat`

### For Capability
- **OpenAI**: `gpt-5.2-pro` or `gpt-4o`
- **Anthropic**: `claude-opus-4-5` or `claude-sonnet-4-0`
- **Google**: `gemini-1.5-pro`

### For Cost-Effectiveness
- **OpenAI**: `gpt-3.5-turbo`
- **Anthropic**: `claude-3-5-haiku-latest`
- **Google**: `gemini-1.5-flash`
- **Mistral**: `mistral-small-latest`

### For Local/Privacy
- **Ollama**: Any locally installed model

## Model Capabilities

Different models support different capabilities:

| Capability | Providers |
|-----------|-----------|
| **Chat/Text** | All providers |
| **Image Input** | OpenAI (GPT-4o), Anthropic (Claude 3.5+), Google (Gemini), Groq (Llama 4 Scout), Mistral (Pixtral), xAI (Grok Vision) |
| **Image Generation** | OpenAI (DALL-E), xAI (Grok), Amazon Bedrock (Nova Canvas), Vercel (v0) |
| **Tool Usage** | OpenAI, Anthropic, Google, Mistral, Groq, and most modern models |
| **Speech/TTS** | OpenAI, ElevenLabs, LMNT, Hume |
| **Embeddings** | OpenAI, Google, Amazon Bedrock, Cohere |

## Best Practices

1. **Check Provider Documentation**: Model availability changes frequently. Always verify model names with the provider's official documentation.

2. **Use Latest Models**: When available, use `-latest` suffixed models for the most up-to-date versions.

3. **Test Model Compatibility**: Not all models support all features (tools, images, etc.). Test your use case.

4. **Monitor Costs**: Different models have different pricing. Monitor usage, especially with larger models.

5. **Fallback Strategy**: Have backup models/providers for reliability.

## Related Documentation

- [Providers Guide](providers.md) - How to configure and use providers
- [API Reference - Providers](../api-reference/providers.md) - Provider API documentation
- [Getting Started](../getting-started/quick-start.md) - Quick start guide

## External Resources

- [AI SDK Documentation](https://ai-sdk.dev/docs/foundations/providers-and-models) - Official AI SDK provider documentation
- [AI SDK Providers](https://ai-sdk.dev/providers/ai-sdk-providers) - Complete provider list with capabilities
