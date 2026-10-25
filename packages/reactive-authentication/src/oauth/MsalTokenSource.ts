import { ReactiveAuthenticationError } from "../ReactiveAuthenticationError.js";
import { SessionSupersededError } from "../SessionSupersededError.js";
import {
  type AccessToken,
  type AccessTokenRequest,
  type AccessTokenSource,
  AuthorizationFailedError,
  InteractionRequiredError,
} from "./AccessTokenSource.js";
import { abortable } from "./abortable.js";

/*
 * Structural subset of @azure/msal-browser's IPublicClientApplication (checked against the real types in
 * test/types/msal.ts). The SDK is injected: it stays an optional application dependency.
 */

/** Compatible with MSAL's `AccountInfo`. */
export interface MsalAccount {
  readonly homeAccountId: string;
  readonly username: string;
}

/** Compatible with MSAL's `AuthenticationResult`. */
export interface MsalResult<A extends MsalAccount = MsalAccount> {
  readonly accessToken: string;
  readonly expiresOn: Date | null;
  readonly account: A | null;
  readonly scopes: string[];
}

export interface MsalClient<A extends MsalAccount = MsalAccount> {
  acquireTokenSilent(request: {
    scopes: string[];
    account?: A;
    authority?: string;
    forceRefresh?: boolean;
  }): Promise<MsalResult<A>>;
  acquireTokenPopup(request: {
    scopes: string[];
    account?: A;
    authority?: string;
    prompt?: string;
    loginHint?: string;
  }): Promise<MsalResult<A>>;
  getActiveAccount(): A | null;
}

export interface MsalTokenSourceOptions<A extends MsalAccount> {
  /** Scopes of one resource, e.g. `["User.Read"]` for Microsoft Graph or `["api://…/access"]` for your API. */
  readonly scopes: readonly string[];
  /** Authority override for this resource (tenant); MSAL validates issuers for it. */
  readonly authority?: string;
  /**
   * The account to use. When given, it is authoritative (`null`/`undefined` means "no account": interaction
   * required), and the caller owns it: after the user picks an account (e.g. `loginPopup` then
   * `setActiveAccount`), update what the selector returns — {@link MsalTokenSource.authorize} never changes
   * it, and rejects results for another account. Default: the account this source authorized, else MSAL's active account — never an arbitrary
   * first cached account.
   */
  readonly account?: () => A | null | undefined;
  /** Recognizes errors that need interaction. Default: MSAL's `InteractionRequiredAuthError` (name or code). */
  readonly isInteractionRequired?: (error: unknown) => boolean;
  /** Called when a reactive request needs a click-driven {@link MsalTokenSource.authorize}. */
  readonly onInteractionRequired?: (source: MsalTokenSource<A>) => void;
  /** `prompt` for {@link MsalTokenSource.authorize}, e.g. `select_account`. */
  readonly prompt?: string;
  readonly loginHint?: string;
}

/** Error codes of MSAL's InteractionRequiredAuthError (msal-common InteractionRequiredAuthErrorCodes). */
const interactionCodes = new Set([
  "no_tokens_found",
  "native_account_unavailable",
  "refresh_token_expired",
  "ui_not_allowed",
  "interaction_required",
  "consent_required",
  "login_required",
  "bad_token",
  "interrupted_user",
]);

export function isMsalInteractionRequired(error: unknown): boolean {
  const e = error as { name?: unknown; errorCode?: unknown } | null;
  return (
    e?.name === "InteractionRequiredAuthError" ||
    (typeof e?.errorCode === "string" && interactionCodes.has(e.errorCode))
  );
}

/**
 * Microsoft Entra ID access through MSAL.js: `acquireTokenSilent` first (with `forceRefresh` after a rejected
 * token), and interaction only for interaction-required errors — which a reactive retry reports as
 * {@link InteractionRequiredError} for a click-driven {@link authorize}. Other errors propagate. MSAL keeps the
 * token cache and validates tenants/issuers; one source per resource (scopes of one API).
 *
 * SDK promises cannot be cancelled: after abort or {@link forget}, late results are discarded. `forget` is a
 * local logout of this source only; MSAL account sign-out (`logoutPopup`/`logoutRedirect`) and token
 * revocation are the application's call.
 */
export class MsalTokenSource<A extends MsalAccount = MsalAccount> implements AccessTokenSource {
  readonly #msal: MsalClient<A>;
  readonly #options: MsalTokenSourceOptions<A>;
  #account: A | undefined;
  #lastToken: string | undefined;
  #logout = new AbortController();
  readonly id: string;

  constructor(msal: MsalClient<A>, options: MsalTokenSourceOptions<A>) {
    if (options.scopes.length === 0) throw new TypeError("At least one scope is required");
    this.#msal = msal;
    this.#options = options;
    this.id = JSON.stringify(["msal", options.authority ?? "", [...options.scopes].sort()]);
  }

  /**
   * Interactive authorization with MSAL's popup. **Call from a user gesture**: MSAL opens its popup at the
   * start of `acquireTokenPopup`, and nothing is awaited before it. Only one popup per MSAL instance runs at
   * a time (`interaction_in_progress` otherwise). Aborting `signal` or {@link forget} settles immediately;
   * the SDK's late result is discarded.
   */
  async authorize(signal: AbortSignal = new AbortController().signal): Promise<AccessToken> {
    signal.throwIfAborted();
    if (interactive.has(this.#msal))
      throw new AuthorizationFailedError(
        "interaction_in_progress",
        "An MSAL interaction is already in progress",
      );
    const bound = AbortSignal.any([signal, this.#logout.signal]);
    const account = this.#selectedAccount();
    const request = {
      scopes: [...this.#options.scopes],
      ...(account === undefined ? {} : { account }),
      ...(this.#options.authority === undefined ? {} : { authority: this.#options.authority }),
      ...(this.#options.prompt === undefined ? {} : { prompt: this.#options.prompt }),
      ...(this.#options.loginHint === undefined ? {} : { loginHint: this.#options.loginHint }),
    };
    interactive.add(this.#msal);
    let popup: Promise<MsalResult<A>>;
    try {
      popup = this.#msal.acquireTokenPopup(request);
    } catch (error) {
      interactive.delete(this.#msal); // a synchronous failure must not leave the SDK marked busy
      throw error;
    }
    popup = popup.finally(() => interactive.delete(this.#msal));

    const result = await abortable(popup, bound);
    bound.throwIfAborted(); // the result may have won the race just before an abort or logout
    const expected =
      this.#options.account !== undefined ? this.#selectedAccount() : (result.account ?? undefined);
    if (
      this.#options.account !== undefined &&
      account !== undefined &&
      expected?.homeAccountId !== account.homeAccountId
    ) {
      throw new SessionSupersededError(); // the application switched accounts during the popup
    }
    const token = this.#accept(result, expected);
    if (result.account !== null) this.#account = result.account;
    return token;
  }

  async getAccessToken({ signal, rejectedToken }: AccessTokenRequest): Promise<AccessToken> {
    const bound = AbortSignal.any([signal, this.#logout.signal]);
    bound.throwIfAborted();
    const account = this.#selectedAccount();
    if (account === undefined) return this.#interactionRequired();

    let result: MsalResult<A>;
    try {
      result = await abortable(
        this.#msal.acquireTokenSilent({
          scopes: [...this.#options.scopes],
          account,
          ...(this.#options.authority === undefined ? {} : { authority: this.#options.authority }),
          // Bypass MSAL's cache only when the API rejected the token this source last handed out.
          ...(rejectedToken !== undefined && rejectedToken === this.#lastToken
            ? { forceRefresh: true }
            : {}),
        }),
        bound,
      );
      bound.throwIfAborted(); // resolved, but abort or logout came before this continuation
    } catch (error) {
      if (bound.aborted) throw bound.reason; // aborted or logged out: no interaction prompt either
      if ((this.#options.isInteractionRequired ?? isMsalInteractionRequired)(error))
        return this.#interactionRequired(error);
      throw error;
    }
    // The application may have switched accounts while MSAL was working.
    if (this.#selectedAccount()?.homeAccountId !== account.homeAccountId)
      throw new SessionSupersededError();
    return this.#accept(result, account);
  }

  /** Local logout: forget the selected account and settle operations in flight; their late results are discarded. */
  async forget(): Promise<void> {
    this.#logout.abort(new SessionSupersededError());
    this.#logout = new AbortController();
    this.#account = undefined;
    this.#lastToken = undefined;
  }

  /** Accepts a result only for the expected account and with a usable token and expiry. */
  #accept(result: MsalResult<A>, expected: A | undefined): AccessToken {
    if (expected !== undefined && result.account?.homeAccountId !== expected.homeAccountId) {
      throw new ReactiveAuthenticationError("MSAL returned a token for a different account");
    }
    if (typeof result.accessToken !== "string" || result.accessToken === "") {
      throw new ReactiveAuthenticationError("MSAL returned no access token");
    }
    const expiresAt = result.expiresOn?.getTime();
    if (expiresAt !== undefined && !Number.isFinite(expiresAt))
      throw new ReactiveAuthenticationError("MSAL returned an invalid expiry");
    this.#lastToken = result.accessToken;
    return expiresAt === undefined
      ? { token: result.accessToken }
      : { token: result.accessToken, expiresAt };
  }

  #selectedAccount(): A | undefined {
    const select = this.#options.account;
    if (select !== undefined) return select() ?? undefined; // authoritative, including "no account"
    return this.#account ?? this.#msal.getActiveAccount() ?? undefined;
  }

  #interactionRequired(cause?: unknown): never {
    this.#options.onInteractionRequired?.(this);
    throw new InteractionRequiredError(this.id, () => this.authorize(), cause);
  }
}

/** MSAL instances with a popup open (sources sharing an instance must not open a second one). */
const interactive = new WeakSet<object>();
