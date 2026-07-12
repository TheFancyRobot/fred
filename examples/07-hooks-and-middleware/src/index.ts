import { createFred } from '@fancyrobot/fred';
import type { HookEvent, HookResult, HookType } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

const HOOK_TYPES: HookType[] = [
  'beforeMessageReceived',
  'afterMessageReceived',
  'beforeIntentDetermined',
  'afterIntentDetermined',
  'beforeAgentSelected',
  'afterAgentSelected',
  'beforeToolCalled',
  'afterToolCalled',
  'afterPolicyDecision',
  'beforeResponseGenerated',
  'afterResponseGenerated',
  'beforeContextInserted',
  'afterContextInserted',
  'beforeRouting',
  'afterRouting',
  'afterRoutingDecision',
  'beforePipeline',
  'afterPipeline',
  'beforeStep',
  'afterStep',
  'onStepError',
  'onPipelineError',
];

function redactSecrets(input: string): string {
  return input
    .replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
    .replace(/sk-[A-Za-z0-9]{16,}/g, '[API_KEY_REDACTED]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]');
}

function summarizeEvent(type: HookType, event: HookEvent): Record<string, unknown> {
  const dataShape =
    event.data && typeof event.data === 'object'
      ? Object.keys(event.data as Record<string, unknown>)
      : typeof event.data;

  return {
    type,
    runId: event.runId ?? event.correlation?.runId ?? 'unknown',
    conversationId: event.conversationId ?? event.correlation?.conversationId ?? 'unknown',
    agentId: event.agentId ?? event.correlation?.agentId ?? 'unknown',
    dataShape,
    timestamp: new Date().toISOString(),
  };
}

async function main() {
  const fred = await createFred({ configPath: './config.yaml' });

  const structuredLogs: Array<Record<string, unknown>> = [];

  await fred.hooks.register('beforeMessageReceived', async (event): Promise<HookResult | void> => {
    if (typeof event.data !== 'string') {
      return;
    }

    const sanitized = redactSecrets(event.data);
    if (sanitized !== event.data) {
      console.log('[HOOK:redaction] Sensitive values redacted before processing.');
    }
    return { data: sanitized };
  });

  await fred.hooks.register('beforeAgentSelected', async (event): Promise<HookResult> => {
    const policyPreamble =
      'ORG POLICY: avoid exposing secrets, avoid irreversible actions, and explain assumptions.';

    const baseData =
      event.data && typeof event.data === 'object'
        ? (event.data as Record<string, unknown>)
        : { original: event.data };

    console.log('[HOOK:policy] Added policy preamble metadata before agent selection.');
    return {
      data: {
        ...baseData,
        policyPreamble,
      },
      metadata: {
        policyInjected: true,
      },
    };
  });

  await fred.hooks.register('afterToolCalled', async (event): Promise<void> => {
    const record = summarizeEvent('afterToolCalled', event);
    structuredLogs.push(record);
    console.log('[HOOK:log]', JSON.stringify(record));
  });

  await fred.hooks.register('afterResponseGenerated', async (event): Promise<void> => {
    const record = {
      ...summarizeEvent('afterResponseGenerated', event),
      responseLength: typeof event.data === 'string' ? event.data.length : 0,
    };
    structuredLogs.push(record);
    console.log('[HOOK:log]', JSON.stringify(record));
  });

  console.log('=== Hooks & Middleware Demo ===\n');
  console.log(`Fred exposes ${HOOK_TYPES.length} hook points across the lifecycle.`);

  // --- Per-Message Variable Injection ---
  // addTemplateContext registers a custom namespace whose resolver is called
  // each time the system prompt is resolved (i.e., per message).
  let sessionState = { userId: 'anonymous', requestCount: 0 };
  await fred.templates.addContext('session', () => ({ ...sessionState }));

  // Update session state before each message - the template resolver
  // captures the latest snapshot, so the agent prompt reflects current values.
  sessionState = { userId: 'user-42', requestCount: 1 };
  await fred.templates.addContext('session', () => ({ ...sessionState }));

  const response = await fred.messages.process(
    'Send this report to jane@company.com. Use API key sk-abc123def456ghi789jkl012 and SSN 123-45-6789.'
  );

  console.log('\nResponse:', response?.content ?? '<no response>');

  // Second message with updated session state - demonstrates that
  // the template re-resolves with fresh values on every processMessage.
  sessionState = { userId: 'user-42', requestCount: 2 };
  await fred.templates.addContext('session', () => ({ ...sessionState }));

  const followUp = await fred.messages.process('Summarize what you know about my session.');
  console.log('\nFollow-up:', followUp?.content ?? '<no response>');

  console.log('\n--- Per-Message Variable Demo ---');
  console.log('Session state was injected dynamically via addTemplateContext.');
  console.log('The agent prompt resolved session.userId and session.requestCount per message.');

  console.log('\nStructured log records captured:', structuredLogs.length);

  await fred.shutdown();
}

main().catch((error) => {
  console.error('Hooks demo failed:', error);
  process.exitCode = 1;
});
