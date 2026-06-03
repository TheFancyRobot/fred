/**
 * @fancyrobot/fred-dev - Fred AI framework development tools
 *
 * This package provides dev-only tooling for Fred contributors.
 * Reusable HTTP server APIs now live in @fancyrobot/fred-http.
 */

export { startDevChat } from './dev-chat';
export {
  DEV_CHAT_PROVIDER_PACKAGES,
  detectAvailableProvider,
  loadProviderPackage,
  ensureDefaultChatAgent,
} from './chat-defaults';
