// AUTHORED-BY GPT-6.1 Sol
import { createPodAuth, type PodAuth, type PodAuthOptions } from "@jeswr/pod-auth";
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
  /** HTTPS Client Identifier Document URL; undefined is allowed only in dev on loopback. */
  clientId: string | undefined;
  redirectUri: string;
  dev: boolean;
  chooseIssuer?: PodAuthOptions["ui"]["chooseIssuer"];
  boundary?: PodAuthOptions["boundary"];
  storage?: PodAuthOptions["storage"];
  maxReplayBodyBytes?: number;
}

/** Create once at the app boundary; the getter shares one core across StrictMode mounts. */
export function createAppPodAuth(options: AppPodAuthOptions): () => Promise<PodAuth> {
  const { clientId, redirectUri, dev, chooseIssuer, ...coreOptions } = options;
  let singleton: Promise<PodAuth> | undefined;
  return () => {
    if (typeof window === "undefined") return Promise.reject(new Error("Browser required"));
    singleton ??= (async () => {
      await import("@jeswr/reactive-authentication/registerElements");
      const loopback = allowInsecureLoopback(dev);
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
