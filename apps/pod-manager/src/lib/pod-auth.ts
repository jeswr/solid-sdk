// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { createPodAuth, type PodAuth } from "@jeswr/pod-auth";
import { CodeRequestCancelledError } from "@jeswr/reactive-authentication";
import { allowInsecureLoopback } from "./auth-environment";
import { IssuerChoiceRequiredError } from "./sign-in";
import type { PopupLoginController } from "./popup-login";
export { publicFetch } from "./source-fetch";

/** The mounted provider owns the gesture-opened popup, including StrictMode replay. */
export const popupHolder: { current: PopupLoginController | null } = { current: null };
let singleton: PodAuth | undefined;
export const STORAGE_ENDPOINTS = ["/account/domains", "/account/domains/", "/.notifications/"];

/** Imported dynamically by the session provider, never evaluated during SSR. */
export function getPodAuth(): PodAuth {
  if (typeof window === "undefined") throw new Error("Browser required");
  const loopback = allowInsecureLoopback();
  singleton ??= createPodAuth({
    clientId: loopback
      ? { dynamicRegistration: true }
      : new URL("/clientid.jsonld", location.origin).href,
    redirectUri: new URL("/callback.html", location.origin).href,
    allowInsecureLoopback: loopback,
    // Pod-server APIs outside the pod folder: custom domains and the notifications service.
    boundary: { storageEndpoints: STORAGE_ENDPOINTS },
    ui: {
      getCode: (url, signal) => {
        if (!popupHolder.current || url.searchParams.get("prompt")?.split(/\s+/u).includes("none"))
          return Promise.reject(new CodeRequestCancelledError(url));
        return popupHolder.current.getCode(url, signal);
      },
      getWebId: async () => {
        throw new Error("Choose an account or address first");
      },
      chooseIssuer: async (issuers) => {
        throw new IssuerChoiceRequiredError(issuers);
      },
    },
  });
  return singleton;
}
