/**
 * @fancyrobot/fred-dev - final compatibility shim
 *
 * @deprecated Install @fancyrobot/fred-cli and use `fred chat` directly.
 * This package will be removed in the next major release.
 */

export { startDevChat } from '@fancyrobot/fred-cli';
export {
  DEV_CHAT_PROVIDER_PACKAGES,
  detectAvailableProvider,
  loadProviderPackage,
  ensureDefaultChatAgent,
} from '@fancyrobot/fred-cli/chat-defaults';
