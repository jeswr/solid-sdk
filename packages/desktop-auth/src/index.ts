// AUTHORED-BY Claude Opus 5.5
export { type DesktopClientIdOptions, desktopClientIdDocument } from "./client-id.js";
export { createDesktopCodeDriver, type DesktopCodeDriverOptions } from "./driver.js";
export {
  createDesktopAuthSession,
  type DesktopAuthSessionOptions,
  type DesktopHost,
  HOST_FAILED,
  MAX_CALLBACK_LENGTH,
  TIMED_OUT,
} from "./session.js";
