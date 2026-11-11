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

interface DriverBase {
  plugin: AuthSessionPlugin;
  /** Private-use scheme redirect (RFC 8252 §7.1), e.g. `org.jeswr.suite:/oauth/callback`. */
  redirectUri: string;
  /** Accept `http://localhost` / loopback authorization endpoints (local CSS in development only). */
  allowInsecureLoopback?: boolean;
}
export type NativeCodeDriverOptions = DriverBase &
  (
    | {
        /** Resolve with the authorization code only (the original ADR-004 D2 contract). */
        returns?: "code";
        /**
         * The issuer identifier of the authorization server behind an authorization URL, from the
         * metadata pod-auth discovered. Mix-up defence (RFC 9207, Solid-OIDC §8): the callback must
         * carry exactly one `iss` equal to it.
         */
        resolveIssuer(authorizationUrl: URL): string | Promise<string>;
      }
    | {
        /**
         * Resolve with the whole validated callback URL, for pod-auth's current `ui.getCode`, which
         * runs RFC 9207 validation itself against the issuer metadata of the pending request. The
         * driver still requires exactly one `iss`, so a missing one can never pass as legacy mode;
         * with `resolveIssuer` it also checks the value before handing the URL over.
         */
        returns: "callback";
        resolveIssuer?(authorizationUrl: URL): string | Promise<string>;
      }
  );

const SCHEME = /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]*[a-z0-9]$/;
const RESERVED_SCHEMES = new Set(["http", "https", "file", "data", "javascript", "blob", "about"]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ERROR_CODE = /^[\x20\x21\x23-\x5b\x5d-\x7e]{1,128}$/;
const ERROR_DESCRIPTION = /^[\x20\x21\x23-\x5b\x5d-\x7e]{1,500}$/;

export interface Redirect {
  href: string;
  scheme: string;
  protocol: string;
  pathname: string;
}

export function parseRedirect(redirectUri: string): Redirect {
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
  // A request object (JAR) or pushed request (PAR) would carry its own
  // redirect_uri, PKCE method and state, making the checks above vacuous.
  if (params.has("request") || params.has("request_uri")) {
    throw bad("must not use a request object or request_uri")();
  }
  const modes = params.getAll("response_mode");
  if (modes.length > 1 || (modes.length === 1 && modes[0] !== "query")) {
    throw bad("must use the query response mode")();
  }
  return single(params, "state", bad("needs one state"));
}

function checkCallback(
  raw: string,
  redirect: Redirect,
  state: string,
  issuer: string | undefined,
): { url: URL; code: string } {
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
  const iss = single(params, "iss", bad("needs exactly one iss"));
  if (issuer !== undefined && iss !== issuer) {
    throw bad("iss does not match the authorization server")();
  }
  if (params.has("error")) {
    // RFC 6749 §4.1.2.1 limits both fields to %x20-21 / %x23-5B / %x5D-7E; the
    // identity provider is the user's choice, so its text is bounded before it
    // reaches an Error message a UI may show.
    const code = single(params, "error", bad("carries a malformed error"));
    if (!ERROR_CODE.test(code)) throw bad("carries a malformed error")();
    const description = params.getAll("error_description");
    throw new AuthorizationError(
      code,
      description.length === 1 && ERROR_DESCRIPTION.test(description[0] as string)
        ? description[0]
        : undefined,
    );
  }
  return { url, code: single(params, "code", bad("needs exactly one code")) };
}

function abortError(): DOMException {
  return new DOMException("Sign-in was aborted", "AbortError");
}

/**
 * The native implementation of pod-auth's `ui.getCode`: opens the system browser through the
 * `SuiteAuthSession` plugin and returns the authorization code. Fails closed on any request or
 * callback that does not match the configured redirect, PKCE S256, the request's `state` and the
 * resolved issuer.
 * Only the code (or, with `returns: "callback"`, the validated callback URL holding it) leaves
 * this function; PKCE verifier, DPoP and tokens stay in pod-auth.
 */
export function createNativeCodeDriver(options: NativeCodeDriverOptions): GetCode {
  const redirect = parseRedirect(options.redirectUri);
  const { plugin } = options;
  const allowLoopback = options.allowInsecureLoopback === true;
  let busy = false;
  const callback = options.returns === "callback";
  const resolveIssuer = options.resolveIssuer;
  const resolve = async (authorizationUrl: URL): Promise<string | undefined> => {
    if (!resolveIssuer) return undefined;
    let issuer: unknown;
    try {
      issuer = await resolveIssuer(authorizationUrl);
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
    // Validate and open one private copy: the caller's URL object could change while we await.
    const requested = new URL(authorizationUrl.href);
    const state = checkAuthorizationUrl(requested, redirect, allowLoopback);
    const href = requested.href;
    busy = true;
    // Abort settles at once, even while the resolver or the plugin never does.
    let rejectAborted!: (error: DOMException) => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAborted = reject;
    });
    const onAbort = () => {
      rejectAborted(abortError());
      void plugin.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const work = (async () => {
      const issuer = await resolve(new URL(href));
      if (signal.aborted) throw abortError();
      let result: { url: string };
      try {
        result = await plugin.authenticate({ url: href, callbackScheme: redirect.scheme });
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === USER_CANCELLED) {
          throw new UserCancelledError("Sign-in was cancelled");
        }
        throw new NativeAuthError("The system browser sign-in failed");
      }
      const checked = checkCallback(String(result?.url), redirect, state, issuer);
      return callback ? checked.url.href : checked.code;
    })();
    // A result that arrives after an abort is dropped.
    work.catch(() => undefined);
    try {
      return await Promise.race([work, aborted]);
    } finally {
      busy = false;
      signal.removeEventListener("abort", onAbort);
    }
  };
}
