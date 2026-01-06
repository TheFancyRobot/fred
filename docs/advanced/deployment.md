# Deployment

Guide for deploying Fred applications to production.

## Environment Variables

Set all required API keys:

```bash
export OPENAI_API_KEY=your_key
export GROQ_API_KEY=your_key
```

## Server Deployment

### Docker

```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY package.json .
RUN bun install
COPY . .
CMD ["bun", "run", "src/server.ts"]
```

### Railway

1. Connect your repository
2. Set environment variables
3. Deploy

### Vercel

1. Install Vercel CLI
2. Run `vercel`
3. Set environment variables in dashboard

## Production Considerations

- Use environment variables for API keys
- Implement rate limiting
- Add authentication
- Monitor usage and costs
- Set up logging
- Use production-grade storage for context

