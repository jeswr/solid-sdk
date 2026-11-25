// AUTHORED-BY Claude Opus 5.5
import { createNativeCodeDriver, type GetCode } from "@jeswr/suite-native";
import { createDesktopAuthSession, type DesktopAuthSessionOptions } from "./session.js";

export interface DesktopCodeDriverOptions extends DesktopAuthSessionOptions {
  /**
   * The app's private-use scheme redirect (RFC 8252 §7.1), for example
   * `ai.artcraft.app:/oauth/callback`. It must equal pod-auth's `redirectUri` and be listed in
   * the Client Identifier Document.
   */
  redirectUri: string;
}

/**
 * pod-auth's `ui.getCode` for a desktop app: opens the system browser, waits for the deep link
 * back, and returns the complete validated callback URL (`code`, `state`, `iss`). Use it with
 * `createPodAuth({ nativeRedirect: true, redirectUri, clientId, ui: { getWebId, getCode } })`.
 *
 * All request and callback checks are suite-native's (`createNativeCodeDriver` in callback mode):
 * https authorization endpoint, PKCE S256, one `state`, our exact `redirect_uri`, no JAR or PAR,
 * exactly one `iss`. pod-auth then checks the issuer against the pending request (RFC 9207).
 */
export function createDesktopCodeDriver(options: DesktopCodeDriverOptions): GetCode {
  const { redirectUri, ...session } = options;
  return createNativeCodeDriver({
    plugin: createDesktopAuthSession(session),
    redirectUri,
    returns: "callback",
  });
}
