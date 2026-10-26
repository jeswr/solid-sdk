// AUTHORED-BY Claude Opus 5.5
export {
  type AuthSessionPlugin,
  createNativeCodeDriver,
  type GetCode,
  type NativeCodeDriverOptions,
  USER_CANCELLED,
} from "./auth-session.js";
export {
  type ClientIdDocument,
  MOBILE_CLIENT_ID_PATH,
  MOBILE_REDIRECT_URI,
  type MobileClientIdOptions,
  mobileClientIdDocument,
} from "./client-id.js";
export {
  AuthorizationError,
  AuthorizationRequestError,
  BusyError,
  InvalidShareError,
  NativeAuthError,
  ShareUnavailableError,
  StateMismatchError,
  SuiteNativeError,
  UserCancelledError,
} from "./errors.js";
export { type CapacitorRuntime, isNativeApp, type Platform, platform } from "./platform.js";
export {
  type ShareContent,
  type SharePlugin,
  type ShareResult,
  type ShareTargets,
  share,
  type WebShare,
} from "./share.js";
export {
  createShareInbox,
  DEFAULT_SHARE_LIMITS,
  type ShareBatch,
  type ShareFileItem,
  type ShareInbox,
  type ShareInboxOptions,
  type ShareIntakePlugin,
  type ShareItem,
  type ShareLimits,
  type ShareTextItem,
  type ShareUrlItem,
  sanitiseFileName,
  validateShareBatch,
} from "./share-intake.js";
