import OpenAI from 'openai';

const envValue = (name: string): string | undefined => {
  const value = Bun.env[name]?.trim();
  return value ? value : undefined;
};

const baseUrl = (envValue('FRED_HTTP_URL') ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const authToken = envValue('FRED_HTTP_AUTH_TOKEN');

const requestHeaders = (sessionId?: string): Headers => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  // When the server has `requireAuth: true`, every non-preflight request must
  // include this header. Load the token from a secret source; never hard-code it.
  // Equivalent fetch syntax:
  //   headers: { Authorization: `Bearer ${process.env.FRED_HTTP_AUTH_TOKEN}` }
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
  if (sessionId) headers.set('X-Session-Id', sessionId);
  return headers;
};

const post = async (
  path: string,
  body: unknown,
  sessionId?: string,
): Promise<{ body: unknown; sessionId?: string }> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: requestHeaders(sessionId),
    body: JSON.stringify(body),
  });
  const responseBody: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(responseBody)}`);
  }
  return {
    body: responseBody,
    sessionId: response.headers.get('x-session-id') ?? undefined,
  };
};

async function main(): Promise<void> {
  const nativeMessage = await post('/message', {
    message: 'Explain why the HTTP layer is optional in one sentence.',
    options: { useSemanticMatching: false },
  });
  console.log('Native /message response:', nativeMessage.body);
  console.log('Session:', nativeMessage.sessionId);

  const continuedChat = await post(
    '/chat',
    { message: 'Continue that same thought with one practical benefit.' },
    nativeMessage.sessionId,
  );
  console.log('Continued /chat response:', continuedChat.body);

  // The OpenAI SDK requires an apiKey value. When Fred auth is enabled, use
  // the same bearer token. When auth is disabled, the local placeholder is fine.
  const openai = new OpenAI({
    apiKey: authToken ?? 'local-fred-no-auth',
    baseURL: `${baseUrl}/v1`,
    maxRetries: 0,
  });

  const completion = await openai.chat.completions.create({
    model: envValue('FRED_EXAMPLE_MODEL') ?? 'openrouter/free',
    messages: [{ role: 'user', content: 'Give me a short HTTP API testing tip.' }],
  }, {
    headers: nativeMessage.sessionId
      ? { 'X-Session-Id': nativeMessage.sessionId }
      : undefined,
  }).withResponse();
  console.log('OpenAI-compatible response:', completion.data.choices[0]?.message.content);
  console.log('OpenAI session:', completion.response.headers.get('x-session-id'));

  const stream = await openai.chat.completions.create({
    model: envValue('FRED_EXAMPLE_MODEL') ?? 'openrouter/free',
    messages: [{ role: 'user', content: 'Stream a three-word greeting.' }],
    stream: true,
  }, {
    headers: nativeMessage.sessionId
      ? { 'X-Session-Id': nativeMessage.sessionId }
      : undefined,
  });

  process.stdout.write('SSE stream: ');
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta.content ?? '');
  }
  process.stdout.write('\n');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
