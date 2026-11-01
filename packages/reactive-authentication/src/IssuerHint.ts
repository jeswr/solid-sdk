import type { ChallengeContext } from "./challenge.js";
import type { IssuerProvider } from "./IssuerProvider.js";
import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js";
import type { HttpOptions } from "./transport.js";
import { parseHttpUrl } from "./url.js";
import { WebIdIssuerProvider } from "./WebIdIssuerProvider.js";

/**
 * Login hints in an application URL, as sent by third-party-initiated login (OpenID Connect Core §4):
 * `iss` (the issuer to use), `login_hint` and `target_link_uri`.
 */
export interface IssuerHint {
  readonly issuer?: URL;
  readonly loginHint?: string;
  readonly targetLinkUri?: string;
}

/** Reads hints from the query string, falling back to a `#`-fragment with the same syntax. */
export function readIssuerHint(url: string | URL): IssuerHint {
  const parsed = new URL(url);
  const params = parsed.searchParams.has("iss")
    ? parsed.searchParams
    : new URLSearchParams(parsed.hash.slice(1));
  const issuer = parseHttpUrl(params.get("iss") ?? "");
  const loginHint = params.get("login_hint");
  const target = params.get("target_link_uri");
  return {
    ...(issuer === undefined ? {} : { issuer }),
    ...(loginHint === null ? {} : { loginHint }),
    ...(target === null ? {} : { targetLinkUri: target }),
  };
}

/**
 * Uses an issuer hinted in the application URL when `accept` approves it, otherwise defers to `fallback`
 * (e.g. an `<idp-picker>`).
 *
 * Anyone can link to an application with any `iss`, so a hint is a phishing vector if used blindly:
 * `accept` should require HTTPS and an allow-list, or confirmation by the user. The hint is used for the
 * first request only; clear it from the address bar (`history.replaceState`) once read.
 */
export class HintIssuerProvider implements IssuerProvider {
  #hint: URL | undefined;

  constructor(
    hint: IssuerHint,
    private readonly fallback: IssuerProvider,
    private readonly accept: (issuer: URL) => boolean | Promise<boolean>,
  ) {
    this.#hint = hint.issuer;
  }

  async getIssuer(request: Request, challenge?: ChallengeContext): Promise<URL> {
    const hint = this.#hint;
    this.#hint = undefined;
    if (hint !== undefined && (await this.accept(hint))) return hint;
    return await this.fallback.getIssuer(request, challenge);
  }
}

export interface WebIdHintOptions {
  /** Accept `http:` WebIDs (local development only). @defaultValue false */
  readonly allowInsecure?: boolean;
}

/**
 * Reads a WebID hint in the `#autologin/<WebID>` form proposed in upstream issue #5, raw
 * (`#autologin/https://alice.example/profile/card#me`) or percent-encoded. Returns `undefined` for anything
 * that is not an absolute HTTPS URL without credentials (or is longer than 2048 characters).
 */
export function readWebIdHint(url: string | URL, options: WebIdHintOptions = {}): URL | undefined {
  const hash = new URL(url).hash;
  const prefix = "#autologin/";
  if (!hash.startsWith(prefix) || hash.length > 2048 + prefix.length) return undefined;

  let value = hash.slice(prefix.length);
  if (/%[0-9a-f]{2}/i.test(value) && !value.includes("://")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }

  const webId = parseHttpUrl(value);
  if (webId === undefined || (webId.protocol !== "https:" && options.allowInsecure !== true))
    return undefined;
  return webId;
}

export interface WebIdHintIssuerOptions {
  /**
   * Approves the hinted WebID before its profile is fetched. Anyone can link to the application with any
   * WebID, so fetching arbitrary profiles on a link's say-so leaks the visit and lets the link choose the
   * login page: approve only known hosts, or after asking the user.
   */
  readonly acceptWebId: (webId: URL) => boolean | Promise<boolean>;

  /** Approves an issuer listed by the profile. Exactly one issuer must be approved. */
  readonly acceptIssuer: (issuer: URL, webId: URL) => boolean | Promise<boolean>;

  readonly http?: HttpOptions;

  /** Called when the hint is not used (rejected, unreachable, ambiguous), before falling back. */
  readonly onRejected?: (reason: unknown) => void;
}

/**
 * Uses a WebID hint once: if approved, the issuer comes from the WebID profile (`solid:oidcIssuer`, via
 * {@link WebIdIssuerProvider}) and must itself be approved; otherwise — or on any failure — `fallback`
 * (e.g. an `<idp-picker>`) is asked. Clear the hint from the address bar once read.
 */
export class WebIdHintIssuerProvider implements IssuerProvider {
  #webId: URL | undefined;

  constructor(
    webId: URL | undefined,
    private readonly fallback: IssuerProvider,
    private readonly options: WebIdHintIssuerOptions,
  ) {
    this.#webId = webId;
  }

  async getIssuer(request: Request, challenge?: ChallengeContext): Promise<URL> {
    const webId = this.#webId;
    this.#webId = undefined;
    if (webId !== undefined) {
      try {
        return await this.#fromWebId(webId, request);
      } catch (reason) {
        request.signal.throwIfAborted();
        this.options.onRejected?.(reason);
      }
    }
    return await this.fallback.getIssuer(request, challenge);
  }

  async #fromWebId(webId: URL, request: Request): Promise<URL> {
    if (!(await this.options.acceptWebId(webId)))
      throw new ReactiveAuthenticationError(`WebID hint ${webId.href} was not accepted`);
    const choose = async (issuers: URL[]) => {
      const accepted: URL[] = [];
      for (const issuer of issuers)
        if (await this.options.acceptIssuer(issuer, webId)) accepted.push(issuer);
      if (accepted.length !== 1)
        throw new ReactiveAuthenticationError(
          `WebID ${webId.href} lists ${accepted.length} accepted issuers; expected exactly one`,
        );
      return accepted[0]!;
    };
    return await new WebIdIssuerProvider(async () => webId, this.options.http, choose).getIssuer(
      request,
    );
  }
}
