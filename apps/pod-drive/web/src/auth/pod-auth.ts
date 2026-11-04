// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodAuth, type PodAuth } from "@jeswr/pod-auth";
import { appUrl } from "./app-url";
import { getCodeThroughHolder } from "./auth-flow-holder";
import { IssuerChoiceRequiredError } from "./issuer-choice";

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

export function allowInsecureLoopback(): boolean {
  // Development builds only: a production bundle served on localhost stays HTTPS-only.
  return (
    import.meta.env.DEV === true &&
    typeof location !== "undefined" &&
    isLoopbackHost(location.hostname)
  );
}

let singleton: Promise<PodAuth> | undefined;

/** One browser core for the page lifetime, shared across StrictMode mounts. */
export function getPodAuth(): Promise<PodAuth> {
  if (typeof window === "undefined") return Promise.reject(new Error("Browser required"));
  singleton ??= (async () => {
    await import("@jeswr/reactive-authentication/registerElements");
    const loopback = allowInsecureLoopback();
    return createPodAuth({
      // pod-auth requires an HTTPS Client Identifier Document; local HTTP development uses
      // its loopback-only dynamic registration instead (development builds only, see above).
      clientId: loopback ? { dynamicRegistration: true } : appUrl("clientid.jsonld"),
      redirectUri: appUrl("callback.html"),
      allowInsecureLoopback: loopback,
      ui: {
        getCode: getCodeThroughHolder,
        getWebId: async () => {
          throw new Error("Choose an account or sign-in address first");
        },
        chooseIssuer: async (issuers) => {
          // The card lists them; the chosen one comes back as an explicit login hint.
          throw new IssuerChoiceRequiredError(issuers);
        },
      },
    });
  })().catch((error: unknown) => {
    singleton = undefined;
    throw error;
  });
  return singleton;
}
