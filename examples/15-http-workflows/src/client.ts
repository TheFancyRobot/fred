const serverUrl = Bun.env.FRED_HTTP_URL?.trim() || 'http://127.0.0.1:3000';
const apiKey = Bun.env.FRED_HTTP_API_KEY?.trim();

if (!apiKey) {
  throw new Error('Set FRED_HTTP_API_KEY to the one-time output from `fred keys create`');
}

const invoke = (path: string, input: unknown, authenticated = true) => fetch(`${serverUrl}${path}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(authenticated ? { authorization: `Bearer ${apiKey}` } : {}),
  },
  body: JSON.stringify(input),
});

async function main(): Promise<void> {
  const greeting = await invoke('/workflows/greet', { name: 'Ada' });
  console.log('Default path + inherited auth:', await greeting.json());

  const normalized = await invoke('/public/normalize', { text: '  Hello   HTTP  ' }, false);
  console.log('Custom public path:', await normalized.json());

  const sum = await invoke('/workflows/secure-sum', { values: [2, 3, 5] });
  console.log('Scoped JSON workflow:', await sum.json());

  const progress = await invoke('/workflows/progress', { job: 'demo' });
  if (!progress.ok) throw new Error(`SSE workflow returned ${progress.status}`);
  console.log('Scoped SSE lifecycle:\n', await progress.text());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
