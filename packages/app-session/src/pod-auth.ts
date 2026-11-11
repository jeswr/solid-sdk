// AUTHORED-BY GPT-6.1 Sol
import { createPodAuth, type PodAuth, type PodAuthOptions } from "@jeswr/pod-auth";
import { appUrl } from "./app-url.js";
import { getCodeThroughHolder } from "./auth-flow-holder.js";
import { IssuerChoiceRequiredError } from "./issuer-choice.js";

// Capture before any authentication initializes. Public reads never use auth.fetch.
const pristineFetch = globalThis.fetch.bind(globalThis);
export const publicFetch: typeof fetch = (input, init) =>
  pristineFetch(input, { ...init, credentials: "omit" });

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    (/^127(?:\.\d{1,3}){3}$/u.test(hostname) &&
      hostname.split(".").every((octet) => Number(octet) <= 255))
  );
}

export function allowInsecureLoopback(
  dev: boolean,
  hostname = typeof location === "undefined" ? "" : location.hostname,
): boolean {
  return dev === true && isLoopbackHost(hostname);
}

export interface AppPodAuthOptions {
  /**
   * The app's base path (e.g. Vite's `import.meta.env.BASE_URL`). When given, the defaults are
   * `<base>clientid.jsonld` and `<base>callback.html` on the current origin, resolved lazily.
   */
  base?: string;
  /** HTTPS Client Identifier Document URL; ignored in dev on loopback (dynamic registration). */
  clientId?: string;
  /** Popup callback URL; defaults to `<base>callback.html`. */
  redirectUri?: string;
  dev: boolean;
  chooseIssuer?: PodAuthOptions["ui"]["chooseIssuer"];
  boundary?: PodAuthOptions["boundary"];
  storage?: PodAuthOptions["storage"];
  maxReplayBodyBytes?: number;
}

/** Create once at the app boundary; the getter shares one core across StrictMode mounts. */
export function createAppPodAuth(options: AppPodAuthOptions): () => Promise<PodAuth> {
  const {
    base,
    clientId: suppliedClientId,
    redirectUri: suppliedRedirect,
    dev,
    chooseIssuer,
    ...coreOptions
  } = options;
  let singleton: Promise<PodAuth> | undefined;
  return () => {
    if (typeof window === "undefined") return Promise.reject(new Error("Browser required"));
    singleton ??= (async () => {
      await import("@jeswr/reactive-authentication/registerElements");
      const loopback = allowInsecureLoopback(dev);
      const redirectUri =
        suppliedRedirect ?? (base === undefined ? undefined : appUrl("callback.html", base));
      if (redirectUri === undefined) throw new TypeError("A redirect URI or app base is required");
      const clientId =
        suppliedClientId ?? (base === undefined ? undefined : appUrl("clientid.jsonld", base));
      if (!loopback && clientId === undefined)
        throw new TypeError("An HTTPS Client Identifier Document URL is required");
      return createPodAuth({
        ...coreOptions,
        clientId: loopback ? { dynamicRegistration: true } : (clientId as string),
        redirectUri,
        allowInsecureLoopback: loopback,
        ui: {
          getCode: getCodeThroughHolder,
          getWebId: async () => {
            throw new Error("Choose an account or sign-in address first");
          },
          chooseIssuer:
            chooseIssuer ??
            (async (issuers) => {
              throw new IssuerChoiceRequiredError(issuers);
            }),
        },
      });
    })().catch((error: unknown) => {
      singleton = undefined;
      throw error;
    });
    return singleton;
  };
}
