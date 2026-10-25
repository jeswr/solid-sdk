// Google Identity Services page: the real GIS script (token model) with GoogleTokenSource,
// OAuthBearerTokenProvider and ReactiveFetchManager running in the page.
import { GoogleTokenSource } from "../../dist/mod.js";
import {
  bindAuthorizeButton,
  errorFacts,
  lastTokenRefused,
  probe,
  probeDecoy,
  wire,
} from "./page-common.js";

/** Google's script URL (fixed: the adapter must exercise the real SDK; offline checks intercept this URL). */
const gisScript = "https://accounts.google.com/gsi/client";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("the Google Identity Services script did not load"));
    document.head.append(script);
  });
}

/**
 * A pass-through view of `google.accounts.oauth2` that counts SDK calls and records whether
 * `requestAccessToken` ran during user activation (the condition for Google's popup). Behaviour is Google's.
 */
function observed(oauth2, sdk) {
  return {
    initTokenClient(config) {
      sdk.initTokenClient++;
      const client = oauth2.initTokenClient(config);
      return {
        requestAccessToken(overrides) {
          sdk.requests.push(navigator.userActivation?.isActive ?? null);
          return client.requestAccessToken(overrides);
        },
      };
    },
    hasGrantedAllScopes: (...args) => oauth2.hasGrantedAllScopes(...args),
    revoke: (token, done) => {
      sdk.revocations++;
      return oauth2.revoke(token, done);
    },
  };
}

const harness = {
  ready: true,
  sdk: { initTokenClient: 0, requests: [], revocations: 0 },
  interactionCallbacks: 0,

  async setup(config) {
    this.config = config;
    await loadScript(gisScript);
    const oauth2 = globalThis.google?.accounts?.oauth2;
    if (typeof oauth2?.initTokenClient !== "function")
      throw new Error("google.accounts.oauth2 is unavailable");
    this.source = new GoogleTokenSource(observed(oauth2, this.sdk), {
      clientId: config.clientId,
      scopes: config.scopes,
      ...(config.prompt === undefined ? {} : { prompt: config.prompt }),
      ...(config.loginHint === undefined ? {} : { loginHint: config.loginHint }),
      revokeOnForget: config.revokeOnForget === true,
      onInteractionRequired: () => {
        this.interactionCallbacks++;
      },
    });
    this.client = wire(this.source, config);
    return { sdkLoaded: true, revokeAvailable: typeof oauth2.revoke === "function" };
  },

  probe() {
    return probe(this.client, this.config);
  },

  probeDecoy() {
    return probeDecoy(this.client, this.config.decoy);
  },

  async forget() {
    try {
      await this.client.manager.logout();
      return { ok: true };
    } catch (error) {
      // logout aggregates provider failures; report the first cause (e.g. revocation_timeout).
      return { ok: false, error: errorFacts(error?.errors?.[0] ?? error) };
    }
  },

  lastTokenRefused() {
    return lastTokenRefused(this.client.recorder, this.config.api);
  },
};

bindAuthorizeButton(harness, () => harness.source.authorize());
globalThis.harness = harness;
