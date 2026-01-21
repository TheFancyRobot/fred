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
export async function initializeLangfuse(options: {
  secretKey: string;
  publicKey: string;
  baseUrl?: string;
}): Promise<boolean> {
  try {
    // Dynamic imports to avoid hard dependency (use await import for ESM compatibility in Bun)
    const langfuseOtelModule = await import('@langfuse/otel');
    const sdkNodeModule = await import('@opentelemetry/sdk-node');
    const resourcesModule = await import('@opentelemetry/resources');
    const semanticConventionsModule = await import('@opentelemetry/semantic-conventions');

    // Handle both default and named exports (for ESM/CJS compatibility)
    const LangfuseSpanProcessor = langfuseOtelModule.LangfuseSpanProcessor ?? langfuseOtelModule.default?.LangfuseSpanProcessor;
    const NodeSDK = sdkNodeModule.NodeSDK ?? sdkNodeModule.default?.NodeSDK;
    // Resource is a type, not a class - use resourceFromAttributes to create instances
    const resourceFromAttributes = resourcesModule.resourceFromAttributes ?? resourcesModule.default?.resourceFromAttributes;
    const SemanticResourceAttributes = semanticConventionsModule.SemanticResourceAttributes ?? semanticConventionsModule.default?.SemanticResourceAttributes;

    if (!LangfuseSpanProcessor || !NodeSDK || !resourceFromAttributes || !SemanticResourceAttributes) {
      throw new Error('Failed to load required OpenTelemetry modules. Missing: ' + 
        [
          !LangfuseSpanProcessor && 'LangfuseSpanProcessor',
          !NodeSDK && 'NodeSDK',
          !resourceFromAttributes && 'resourceFromAttributes',
          !SemanticResourceAttributes && 'SemanticResourceAttributes',
        ].filter(Boolean).join(', '));
    }

    // Create Langfuse span processor
    const langfuseSpanProcessor = new LangfuseSpanProcessor({
      secretKey: options.secretKey,
      publicKey: options.publicKey,
      baseUrl: options.baseUrl,
    });

    // Initialize OpenTelemetry SDK
    // Use resourceFromAttributes instead of new Resource() since Resource is a type, not a class
    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [SemanticResourceAttributes.SERVICE_NAME]: 'fred',
      }),
      spanProcessors: [langfuseSpanProcessor],
    });

    // Start the SDK (registers global tracer provider)
    // This MUST be called before any AI SDK calls with experimental_telemetry
    sdk.start();

    // Verify SDK started successfully
    // The SDK should now be registered globally and ready to capture spans
    if (typeof process !== 'undefined' && process.env.DEBUG_LANGFUSE) {
      console.log('[Fred] Langfuse OpenTelemetry SDK started successfully');
    }
    return true;
  } catch (error) {
    // Graceful degradation - if Langfuse packages aren't installed, just return false
    if (error instanceof Error && (
      error.message.includes('Cannot find module') ||
      error.message.includes('Could not resolve') ||
      error.message.includes('Failed to load')
    )) {
      console.warn('[Fred] Langfuse packages not found. Install @langfuse/otel and @opentelemetry/sdk-node to enable Langfuse integration.');
      return false;
    }
    // Log other errors with full details for debugging
    console.error('[Fred] Failed to initialize Langfuse:', error);
    if (error instanceof Error && error.stack) {
      console.error('[Fred] Langfuse initialization error stack:', error.stack);
    }
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
