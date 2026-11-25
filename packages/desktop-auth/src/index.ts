// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Claude Sonnet 5.5
export { type DesktopClientIdOptions, desktopClientIdDocument } from "./client-id.js";
export { createDesktopCodeDriver, type DesktopCodeDriverOptions } from "./driver.js";
export { DesktopAuthError, type DesktopAuthErrorCode } from "./errors.js";
export {
  createDesktopAuthSession,
  type DesktopAuthSessionOptions,
  type DesktopHost,
  HOST_FAILED,
  type IgnoredReason,
  MAX_CALLBACK_LENGTH,
  TIMED_OUT,
} from "./session.js";
