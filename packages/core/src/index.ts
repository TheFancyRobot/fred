/**
 * Public Promise-client entrypoint for Fred.
 *
 * `createFred()` owns one scoped Effect runtime and exposes the supported
 * `FredClient` contract. Effect-native consumers should import services and
 * layers from `@fancyrobot/fred/effect`.
 */

export {
  createFred,
  FredClientClosedError,
  executeGraphWorkflowViaRuntime,
  executeWorkflowViaRuntime,
  type FredClient,
  type FredWarningListener,
  type MCPServerInfo,
  type MCPServerOperationResult,
  type MCPToolMetadata,
  type CreateFredOptions,
  type WorkflowDefinition,
  type WorkflowRunResult,
} from './client';

export * from './exports';
