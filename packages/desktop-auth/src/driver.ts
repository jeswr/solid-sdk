// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Claude Sonnet 5.5
import {
  type AuthSessionPlugin,
  createNativeCodeDriver,
  type GetCode,
  NativeAuthError,
} from "@jeswr/suite-native";
import { DesktopAuthError, type DesktopAuthErrorCode } from "./errors.js";
import {
  createDesktopAuthSession,
  type DesktopAuthSessionOptions,
  HOST_FAILED,
  TIMED_OUT,
} from "./session.js";

export interface DesktopCodeDriverOptions extends DesktopAuthSessionOptions {
  /**
   * The app's private-use scheme redirect (RFC 8252 §7.1), for example
   * `ai.artcraft.app:/oauth/callback`. It must equal pod-auth's `redirectUri` and be listed in
   * the Client Identifier Document.
   */
  redirectUri: string;
}

/**
 * suite-native's driver folds every plugin failure into one `NativeAuthError`. This wraps the
 * plugin to record which closed-set code the session failed with, and the returned `GetCode`
 * rethrows that as `DesktopAuthError`. Only the code is kept, never the host's error. Exported
 * for tests, not from the package entry point.
 */
export function withDesktopAuthErrors(plugin: AuthSessionPlugin, redirectUri: string): GetCode {
  let recorded: DesktopAuthErrorCode | null = null;
  let active = false;
  const recording: AuthSessionPlugin = {
    async authenticate(options) {
      try {
        return await plugin.authenticate(options);
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        recorded = code === TIMED_OUT ? "timed-out" : code === HOST_FAILED ? "host-failed" : null;
        throw error;
      }
    },
    cancel: () => plugin.cancel(),
  };
  const getCode = createNativeCodeDriver({ plugin: recording, redirectUri, returns: "callback" });
  return async (authorizationUrl, signal) => {
    // A call made while another is running is refused by the driver; it must not touch the record.
    if (active) return getCode(authorizationUrl, signal);
    active = true;
    recorded = null;
    try {
      return await getCode(authorizationUrl, signal);
    } catch (error) {
      if (error instanceof NativeAuthError && recorded !== null) {
        throw new DesktopAuthError(recorded);
      }
      throw error;
    } finally {
      active = false;
    }
  };
}

/**
 * pod-auth's `ui.getCode` for a desktop app: opens the system browser, waits for the deep link
 * back, and returns the complete validated callback URL (`code`, `state`, `iss`). Use it with
 * `createPodAuth({ nativeRedirect: true, redirectUri, clientId, ui: { getWebId, getCode } })`.
 *
 * All request and callback checks are suite-native's (`createNativeCodeDriver` in callback mode):
 * https authorization endpoint, PKCE S256, one `state`, our exact `redirect_uri`, no JAR or PAR,
 * exactly one `iss`. pod-auth then checks the issuer against the pending request (RFC 9207).
 *
 * A timeout or a host failure rejects with `DesktopAuthError` (`timed-out` or `host-failed`);
 * cancelling rejects with suite-native's `UserCancelledError`.
 */
export function createDesktopCodeDriver(options: DesktopCodeDriverOptions): GetCode {
  const { redirectUri, ...session } = options;
  return withDesktopAuthErrors(createDesktopAuthSession(session), redirectUri);
}
