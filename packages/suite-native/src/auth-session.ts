// AUTHORED-BY Claude Opus 5.5
import {
  AuthorizationError,
  AuthorizationRequestError,
  BusyError,
  NativeAuthError,
  StateMismatchError,
  UserCancelledError,
} from "./errors.js";

/** The native `SuiteAuthSession` plugin (ASWebAuthenticationSession on iOS, Custom Tabs on Android). */
export interface AuthSessionPlugin {
  /** Opens `url` in the system browser; resolves with the callback URL the OS routed back. */
  authenticate(options: { url: string; callbackScheme: string }): Promise<{ url: string }>;
  /** Dismisses an open session; a pending `authenticate` then rejects with `USER_CANCELLED`. */
  cancel(): Promise<void>;
}

/** Error code the native plugins reject with when the person dismisses the browser sheet. */
export const USER_CANCELLED = "USER_CANCELLED";

/** ADR-004 D2 `ui.getCode`: hand over an authorization URL, receive the authorization code. */
export type GetCode = (authorizationUrl: URL, signal: AbortSignal) => Promise<string>;

export interface NativeCodeDriverOptions {
  plugin: AuthSessionPlugin;
  /** Private-use scheme redirect (RFC 8252 §7.1), e.g. `org.jeswr.suite:/oauth/callback`. */
  redirectUri: string;
  /**
   * The issuer identifier of the authorization server behind an authorization URL, from the
   * metadata pod-auth discovered. Mix-up defence (RFC 9207, Solid-OIDC §8): the callback must
   * carry exactly one `iss` equal to it.
   */
  resolveIssuer(authorizationUrl: URL): string | Promise<string>;
  /** Accept `http://localhost` / loopback authorization endpoints (local CSS in development only). */
  allowInsecureLoopback?: boolean;
}

const SCHEME = /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]*[a-z0-9]$/;
const RESERVED_SCHEMES = new Set(["http", "https", "file", "data", "javascript", "blob", "about"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

interface Redirect {
  href: string;
  scheme: string;
  protocol: string;
  pathname: string;
}

function parseRedirect(redirectUri: string): Redirect {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    throw new TypeError("redirectUri must be an absolute URI");
  }
  const scheme = url.protocol.slice(0, -1);
  if (!SCHEME.test(scheme) || RESERVED_SCHEMES.has(scheme)) {
    throw new TypeError("redirectUri must use a reverse-domain private-use scheme (RFC 8252 §7.1)");
  }
  if (url.host !== "" || url.search !== "" || url.hash !== "" || !url.pathname.startsWith("/")) {
    throw new TypeError(
      "redirectUri must be <scheme>:/<path> with no authority, query or fragment",
    );
  }
  return { href: url.href, scheme, protocol: url.protocol, pathname: url.pathname };
}

/** Returns the single value of `name`, or throws when it is absent, empty or repeated. */
function single(params: URLSearchParams, name: string, error: () => Error): string {
  const values = params.getAll(name);
  if (values.length !== 1 || values[0] === "") throw error();
  return values[0] as string;
}

function checkAuthorizationUrl(url: URL, redirect: Redirect, allowLoopback: boolean): string {
  const bad = (why: string) => () => new AuthorizationRequestError(`Authorization URL ${why}`);
  const loopbackHttp = allowLoopback && url.protocol === "http:" && LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) throw bad("must use https")();
  if (url.username !== "" || url.password !== "") throw bad("must not carry credentials")();
  const params = url.searchParams;
  if (single(params, "response_type", bad("needs response_type")) !== "code") {
    throw bad("must request response_type=code")();
  }
  single(params, "client_id", bad("needs one client_id"));
  if (single(params, "redirect_uri", bad("needs one redirect_uri")) !== redirect.href) {
    throw bad("redirect_uri does not match this app")();
  }
  single(params, "code_challenge", bad("needs a PKCE code_challenge"));
  if (single(params, "code_challenge_method", bad("needs code_challenge_method")) !== "S256") {
    throw bad("must use PKCE S256")();
  }
  if (params.has("response_mode") && params.get("response_mode") !== "query") {
    throw bad("must use the query response mode")();
  }
  return single(params, "state", bad("needs one state"));
}

function checkCallback(raw: string, redirect: Redirect, state: string, issuer: string) {
  const bad = (why: string) => () => new AuthorizationRequestError(`Callback ${why}`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw bad("is not a URL")();
  }
  if (url.protocol !== redirect.protocol || url.host !== "" || url.pathname !== redirect.pathname) {
    throw bad("does not match the redirect URI")();
  }
  if (url.hash !== "") throw bad("must not carry a fragment")();
  const params = url.searchParams;
  const returned = params.getAll("state");
  if (returned.length !== 1 || returned[0] !== state)
    throw new StateMismatchError("State mismatch");
  if (single(params, "iss", bad("needs exactly one iss")) !== issuer) {
    throw bad("iss does not match the authorization server")();
  }
  if (params.has("error")) {
    const code = single(params, "error", bad("carries a malformed error"));
    throw new AuthorizationError(code, params.get("error_description") ?? undefined);
  }
  return single(params, "code", bad("needs exactly one code"));
}

function abortError(): DOMException {
  return new DOMException("Sign-in was aborted", "AbortError");
}

/**
 * The native implementation of pod-auth's `ui.getCode`: opens the system browser through the
 * `SuiteAuthSession` plugin and returns the authorization code. Fails closed on any request or
 * callback that does not match the configured redirect, PKCE S256, the request's `state` and the
 * resolved issuer.
 * Only the code leaves this function; PKCE verifier, DPoP and tokens stay in pod-auth.
 */
export function createNativeCodeDriver(options: NativeCodeDriverOptions): GetCode {
  const redirect = parseRedirect(options.redirectUri);
  const { plugin } = options;
  const allowLoopback = options.allowInsecureLoopback === true;
  let busy = false;
  const resolve = async (authorizationUrl: URL): Promise<string> => {
    let issuer: unknown;
    try {
      issuer = await options.resolveIssuer(authorizationUrl);
    } catch {
      throw new AuthorizationRequestError("Unknown authorization server");
    }
    if (typeof issuer !== "string" || issuer === "") {
      throw new AuthorizationRequestError("Unknown authorization server");
    }
    return issuer;
  };

  return async (authorizationUrl, signal) => {
    if (signal.aborted) throw abortError();
    if (busy) throw new BusyError("A sign-in is already in progress");
    const state = checkAuthorizationUrl(authorizationUrl, redirect, allowLoopback);
    busy = true;
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      void plugin.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const issuer = await resolve(authorizationUrl);
      if (aborted) throw abortError();
      let result: { url: string };
      try {
        result = await plugin.authenticate({
          url: authorizationUrl.href,
          callbackScheme: redirect.scheme,
        });
      } catch (error) {
        if (aborted) throw abortError();
        if ((error as { code?: unknown } | null)?.code === USER_CANCELLED) {
          throw new UserCancelledError("Sign-in was cancelled");
        }
        throw new NativeAuthError("The system browser sign-in failed");
      }
      if (aborted) throw abortError();
      return checkCallback(String(result?.url), redirect, state, issuer);
    } finally {
      busy = false;
      signal.removeEventListener("abort", onAbort);
    }
  };
}
