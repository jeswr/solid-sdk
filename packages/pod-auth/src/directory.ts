// AUTHORED-BY Codex GPT-6.1-Sol
import { issuersFromWebId, sameIssuer } from "@jeswr/reactive-authentication";
import { abortable, boundedDocumentFetch } from "./documents.js";
import { secureUrl } from "./options.js";

/** Public presentation metadata; custom labels and icons are opt-in host configuration. */
export interface SolidProvider {
  id: string;
  name: string;
  issuer: string;
  description?: string;
  signUpUrl?: string;
  label?: string;
  iconUrl?: string;
}

// Taken from Pod Manager's directory and suite spec 02-§8.1. Re-verify live before release;
// the build sandbox cannot reach these providers. Default icons are local monograms.
export const KNOWN_PROVIDERS: readonly SolidProvider[] = Object.freeze(
  [
    {
      id: "solidcommunity",
      name: "solidcommunity.net",
      issuer: "https://solidcommunity.net/",
      description: "Free, run by the Solid community",
      signUpUrl: "https://solidcommunity.net/.account/login/password/register/",
    },
    {
      id: "inrupt",
      name: "Inrupt PodSpaces",
      issuer: "https://login.inrupt.com/",
      description: "Run by Inrupt",
      signUpUrl: "https://start.inrupt.com/",
    },
    {
      id: "teamid",
      name: "teamid.live",
      issuer: "https://teamid.live/",
      description: "Free, quick sign-up",
    },
  ].map((provider) => Object.freeze(provider)),
);

/** Parse the suite's comma-separated HTTPS provider configuration, returning independent copies. */
export function providersFromConfig(
  raw: string | undefined,
  fallback: readonly SolidProvider[] = KNOWN_PROVIDERS,
): SolidProvider[] {
  const providers: SolidProvider[] = [];
  for (const entry of raw?.split(",") ?? []) {
    try {
      const url = secureUrl(entry.trim(), false, "provider");
      if (providers.some((provider) => sameIssuer(provider.issuer, url.href))) continue;
      const known = KNOWN_PROVIDERS.find((provider) => sameIssuer(provider.issuer, url.href));
      providers.push(known ? { ...known } : { id: url.host, name: url.host, issuer: url.href });
    } catch {
      /* Invalid configuration entries do not hide the fallback directory. */
    }
  }
  return providers.length === 0 ? fallback.map((provider) => ({ ...provider })) : providers;
}

/** The hint passed to pod-auth after the address has been checked. */
export type LoginTarget = { kind: "webid"; webId: string } | { kind: "issuer"; issuer: string };

/** The input is not a secure absolute sign-in URL. */
export class InvalidLoginAddressError extends TypeError {
  readonly input: string;
  constructor(input: string) {
    super("Enter a full HTTPS WebID or provider address");
    this.name = "InvalidLoginAddressError";
    this.input = input;
  }
}

/** Neither a WebID profile nor provider discovery was found at this address. */
export class NotALoginAddressError extends Error {
  readonly input: string;
  constructor(input: string) {
    super(`${input} is not a WebID or sign-in provider address`);
    this.name = "NotALoginAddressError";
    this.input = input;
  }
}

function loginUrl(input: string, insecure: boolean): URL {
  try {
    return secureUrl(input.trim(), insecure, "sign-in address");
  } catch {
    throw new InvalidLoginAddressError(input);
  }
}

function bareOrigin(url: URL): boolean {
  return url.pathname === "/" && !url.href.includes("?") && !url.href.includes("#");
}

/** Classify by URL shape only, without network requests; resolution tries both interpretations. */
export function classifyLoginInput(
  input: string,
  opts?: { allowInsecureLoopback?: boolean },
): "webid" | "issuer" | "invalid" {
  try {
    return bareOrigin(loginUrl(input, opts?.allowInsecureLoopback === true)) ? "issuer" : "webid";
  } catch {
    return "invalid";
  }
}

/** Resolve one public address with bounded responses and no authentication state or global transport. */
export async function resolveLoginTarget(
  input: string,
  opts: { fetch: typeof fetch; allowInsecureLoopback?: boolean; signal?: AbortSignal },
): Promise<LoginTarget> {
  const insecure = opts.allowInsecureLoopback === true;
  const url = loginUrl(input, insecure);
  const transport = boundedDocumentFetch(opts.fetch, insecure);
  const probe = async (kind: "issuer" | "webid"): Promise<LoginTarget | undefined> => {
    try {
      return await abortable(opts.signal, async () => {
        if (kind === "webid") {
          // Reuse WebIdIssuerProvider's RDF parser and subject-scoped typed accessor.
          const issuers = await issuersFromWebId(url, opts.signal, {
            fetch: transport,
            allowInsecureRequests: insecure,
          });
          return issuers.length === 0 ? undefined : { kind, webId: url.href };
        }
        const discovery = new URL(url);
        discovery.pathname = `${url.pathname.replace(/\/+$/, "")}/.well-known/openid-configuration`;
        discovery.hash = "";
        const response = await transport(discovery, {
          headers: { accept: "application/json" },
          redirect: "error",
          signal: opts.signal,
        });
        if (!response.ok) return undefined;
        const config: unknown = await response.json();
        if (
          typeof config !== "object" ||
          config === null ||
          !("issuer" in config) ||
          typeof config.issuer !== "string" ||
          !("authorization_endpoint" in config) ||
          typeof config.authorization_endpoint !== "string" ||
          !sameIssuer(config.issuer, url.href)
        )
          return undefined;
        return { kind, issuer: config.issuer };
      });
    } catch (error) {
      opts.signal?.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") throw error;
      return undefined;
    }
  };
  const first = bareOrigin(url) ? "issuer" : "webid";
  const target = (await probe(first)) ?? (await probe(first === "issuer" ? "webid" : "issuer"));
  opts.signal?.throwIfAborted();
  if (target === undefined) throw new NotALoginAddressError(input);
  return target;
}

/** Store at most five public HTTPS provider addresses, tolerating unavailable browser storage. */
export function createRecentProvidersStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined,
  key = "pod-auth.recentProviders.v1",
): { list(): string[]; remember(issuer: string): void; clear(): void } {
  const clean = (values: unknown[]): string[] => {
    const issuers: string[] = [];
    for (const value of values) {
      if (typeof value !== "string") continue;
      try {
        const issuer = secureUrl(value, false, "provider").href;
        if (!issuers.some((previous) => sameIssuer(previous, issuer))) issuers.push(issuer);
      } catch {
        /* Only public HTTPS provider addresses belong in this store. */
      }
    }
    return issuers.slice(0, 5);
  };
  const list = (): string[] => {
    try {
      const raw: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
      return Array.isArray(raw) ? clean(raw) : [];
    } catch {
      return [];
    }
  };
  return {
    list,
    remember: (issuer) => {
      const valid = clean([issuer]);
      if (valid.length === 0) return;
      try {
        storage?.setItem(key, JSON.stringify(clean([...valid, ...list()])));
      } catch {
        /* Remembering a public address is best-effort. */
      }
    },
    clear: () => {
      try {
        storage?.removeItem(key);
      } catch {
        /* Unavailable storage must not prevent sign-in. */
      }
    },
  };
}
