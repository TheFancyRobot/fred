/**
 * Langfuse OpenTelemetry initialization
 * Sets up OpenTelemetry SDK with LangfuseSpanProcessor for automatic span capture
 */

/**
 * Initialize OpenTelemetry with LangfuseSpanProcessor
 * This is a one-time setup that enables automatic capture of AI SDK spans
 * @param options - Langfuse configuration options
 * @returns true if initialization succeeded, false otherwise
 */
export function initializeLangfuse(options: {
  secretKey: string;
  publicKey: string;
  baseUrl?: string;
}): boolean {
  try {
    // Dynamic imports to avoid hard dependency
    const { LangfuseSpanProcessor } = require('@langfuse/otel');
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { Resource } = require('@opentelemetry/resources');
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

    // Create Langfuse span processor
    const langfuseSpanProcessor = new LangfuseSpanProcessor({
      secretKey: options.secretKey,
      publicKey: options.publicKey,
      baseUrl: options.baseUrl,
    });

    // Initialize OpenTelemetry SDK
    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'fred',
      }),
      spanProcessors: [langfuseSpanProcessor],
    });

    // Start the SDK (registers global tracer provider)
    sdk.start();

    return true;
  } catch (error) {
    // Graceful degradation - if Langfuse packages aren't installed, just return false
    if (error instanceof Error && error.message.includes('Cannot find module')) {
      console.warn('[Fred] Langfuse packages not found. Install @langfuse/otel and @opentelemetry/sdk-node to enable Langfuse integration.');
      return false;
    }
    // Log other errors but don't throw
    console.error('[Fred] Failed to initialize Langfuse:', error);
    return false;
  }
}

/**
 * Check if Langfuse packages are available
 * @returns true if packages are installed, false otherwise
 */
export function isLangfuseAvailable(): boolean {
  try {
    require.resolve('@langfuse/otel');
    require.resolve('@opentelemetry/sdk-node');
    return true;
  } catch {
    return false;
  }
}
