// AUTHORED-BY Claude Opus 5.5
import { type AuthSessionPlugin, USER_CANCELLED } from "@jeswr/suite-native";

/**
 * What a desktop shell supplies: open a URL in the system browser, and listen for URLs the
 * operating system routes back to the app through its registered private-use scheme. The shapes
 * match Tauri 2's `openUrl` (`@tauri-apps/plugin-opener`) and `onOpenUrl`
 * (`@tauri-apps/plugin-deep-link`), so a Tauri app passes those two functions unchanged. Any other
 * desktop shell (Electron, a test) supplies the same two functions.
 */
export interface DesktopHost {
  /** Opens `url` in the user's default browser. Never an embedded webview (RFC 8252 §8.12). */
  openUrl(url: string): Promise<void>;
  /**
   * Calls `listener` with every batch of URLs routed to the app while listening. Resolves with a
   * function that stops listening.
   */
  onOpenUrl(listener: (urls: string[]) => void): Promise<() => void>;
}

export interface DesktopAuthSessionOptions {
  host: DesktopHost;
  /**
   * How long to wait for the browser to come back, in milliseconds. Defaults to 10 minutes.
   * Unlike a mobile sheet, a desktop browser tab cannot be closed by the app or report that the
   * person gave up, so an unanswered sign-in has to end on its own.
   */
  timeoutMs?: number;
  /** Injected timers, for tests. */
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** Error code the session rejects with when no callback arrives in time. */
export const TIMED_OUT = "TIMED_OUT";
/** Error code the session rejects with when the host cannot open the browser or listen. */
export const HOST_FAILED = "HOST_FAILED";

/** The longest callback URL considered; anything longer is ignored unparsed. */
export const MAX_CALLBACK_LENGTH = 8192;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;

/** Rejection carrying only a code, the shape suite-native's driver inspects. */
class SessionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

interface Expected {
  protocol: string;
  pathname: string;
  state: string;
}

/**
 * Reads what a genuine callback must match from the authorization URL. suite-native's driver has
 * already checked the request; this repeats only what the session needs to tell a real callback
 * from noise, and fails closed if it is missing.
 */
function expectedCallback(url: string, callbackScheme: string): Expected {
  const request = new URL(url);
  const redirects = request.searchParams.getAll("redirect_uri");
  const states = request.searchParams.getAll("state");
  if (redirects.length !== 1 || states.length !== 1 || states[0] === "") {
    throw new SessionError(HOST_FAILED);
  }
  const redirect = new URL(redirects[0] as string);
  if (redirect.protocol !== `${callbackScheme}:`) throw new SessionError(HOST_FAILED);
  return { protocol: redirect.protocol, pathname: redirect.pathname, state: states[0] as string };
}

/**
 * True only for a URL on our redirect that carries exactly our `state`. Anything else that reaches
 * the scheme (another sign-in, a stale tab, a web page probing the scheme) is ignored rather than
 * failing the sign-in, so a stray link cannot cancel a sign-in in progress. The driver still runs
 * every security check on the URL this returns true for.
 */
function matches(candidate: unknown, expected: Expected): candidate is string {
  if (typeof candidate !== "string" || candidate.length > MAX_CALLBACK_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== expected.protocol || url.host !== "") return false;
  if (url.pathname !== expected.pathname) return false;
  const states = url.searchParams.getAll("state");
  return states.length === 1 && states[0] === expected.state;
}

/**
 * suite-native's `AuthSessionPlugin` for desktop shells: the system browser plus a deep link back.
 * Pass it to `createDesktopCodeDriver` (or suite-native's `createNativeCodeDriver`). It returns
 * the callback URL only; codes, PKCE verifiers, DPoP keys and tokens never pass through the host.
 */
export function createDesktopAuthSession(options: DesktopAuthSessionOptions): AuthSessionPlugin {
  const { host } = options;
  if (!host || typeof host.openUrl !== "function" || typeof host.onOpenUrl !== "function") {
    throw new TypeError("host needs openUrl and onOpenUrl functions");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError("timeoutMs must be a whole number of milliseconds up to one hour");
  }
  const setTimer = options.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
  const clearTimer =
    options.clearTimeout ??
    ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));

  let finish: ((error: SessionError) => void) | null = null;

  return {
    authenticate({ url, callbackScheme }) {
      if (finish !== null) return Promise.reject(new SessionError(HOST_FAILED));
      return new Promise<{ url: string }>((resolve, reject) => {
        let settled = false;
        let unlisten: (() => void) | null = null;
        let timer: unknown;
        const stopListening = () => {
          const stop = unlisten;
          unlisten = null;
          if (stop !== null) {
            try {
              stop();
            } catch {
              // A host that fails to unlisten cannot deliver to a settled session anyway.
            }
          }
        };
        const settle = (outcome: () => void) => {
          if (settled) return;
          settled = true;
          finish = null;
          clearTimer(timer);
          stopListening();
          outcome();
        };
        finish = (error) => settle(() => reject(error));

        let expected: Expected;
        try {
          expected = expectedCallback(url, callbackScheme);
        } catch {
          settle(() => reject(new SessionError(HOST_FAILED)));
          return;
        }
        timer = setTimer(() => settle(() => reject(new SessionError(TIMED_OUT))), timeoutMs);

        const listener = (urls: string[]) => {
          if (settled || !Array.isArray(urls)) return;
          for (const candidate of urls) {
            if (matches(candidate, expected)) {
              settle(() => resolve({ url: candidate }));
              return;
            }
          }
        };

        // Listen before opening the browser, so a fast callback is never missed.
        (async () => {
          let stop: () => void;
          try {
            stop = await host.onOpenUrl(listener);
          } catch {
            settle(() => reject(new SessionError(HOST_FAILED)));
            return;
          }
          if (typeof stop !== "function") {
            settle(() => reject(new SessionError(HOST_FAILED)));
            return;
          }
          unlisten = stop;
          // Cancelled or timed out while the listener was being registered.
          if (settled) {
            stopListening();
            return;
          }
          try {
            await host.openUrl(url);
          } catch {
            settle(() => reject(new SessionError(HOST_FAILED)));
          }
        })();
      });
    },
    async cancel() {
      // The browser tab stays open; the app stops waiting for it.
      finish?.(new SessionError(USER_CANCELLED));
    },
  };
}
