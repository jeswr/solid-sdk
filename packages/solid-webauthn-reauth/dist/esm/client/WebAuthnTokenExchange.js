// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
import { startAuthentication } from "@simplewebauthn/browser";
import * as oauth from "oauth4webapi";
import { BUNDLE_VERSION, encodeAssertionBundle, TOKEN_EXCHANGE_GRANT_TYPE, WEBAUTHN_ASSERTION_TOKEN_TYPE, } from "../protocol/index.js";
const DEFAULT_OPTIONS_PATH = "/.oidc/webauthn/assertion-options";
const DEFAULT_TOKEN_PATH = "/.oidc/token";
/** No-op client authentication for a public client with no `client_id`. */
const noClientAuth = () => { };
/**
 * The redirect-free WebAuthn {@link TokenExchange}:
 *
 * 1. resolves the OP for the target request;
 * 2. `POST`s the OP assertion-options endpoint for a single-use challenge;
 * 3. runs the WebAuthn `get()` ceremony (`navigator.credentials.get`, via
 *    SimpleWebAuthn's `startAuthentication`) — the app is the Relying Party, so
 *    the assertion's `clientDataJSON.origin` unspoofably attests the app;
 * 4. encodes the assertion as the versioned bundle `subject_token`; and
 * 5. exchanges it at the token endpoint (RFC 8693) with the provider-supplied
 *    DPoP proof.
 *
 * The DPoP keypair, resource binding, and upgraded request are owned by
 * {@link WebAuthnTokenProvider}; this exchange only attaches the shared DPoP
 * handle to the RFC 8693 grant and asserts the issued token is
 * sender-constrained.
 */
export class WebAuthnTokenExchange {
    #config;
    constructor(config) {
        this.#config = config;
    }
    /** Select this exchange when the request host has WebAuthn config. */
    async matches(request) {
        return this.#configFor(request) !== undefined;
    }
    async acquire({ request, dpop }) {
        const issuerConfig = this.#configFor(request);
        if (issuerConfig === undefined) {
            throw new Error(`No WebAuthn configuration for ${request.url}`);
        }
        // (a) Discover the OP — resolve the token endpoint from OIDC discovery
        // (with a conventional fallback); the assertion-options endpoint is a
        // conventional (non-discovery) endpoint.
        const issuer = new URL(issuerConfig.issuer);
        const tokenEndpoint = await this.#resolveTokenEndpoint(issuer, issuerConfig);
        const optionsEndpoint = this.#resolveOptionsEndpoint(issuer, issuerConfig);
        // (b) Fetch a single-use challenge (POST by default — issuing the challenge
        // is state-changing).
        const optionsResponse = await fetch(optionsEndpoint, {
            method: issuerConfig.assertionOptionsMethod ?? "POST",
            headers: { accept: "application/json" },
            signal: request.signal,
        });
        if (!optionsResponse.ok) {
            throw new Error(`Assertion-options request failed: ${optionsResponse.status} ${optionsResponse.statusText}`);
        }
        const optionsJSON = (await optionsResponse.json());
        // (c) Run the WebAuthn assertion ceremony (navigator.credentials.get).
        const credential = await startAuthentication({ optionsJSON });
        // (d) Build and encode the versioned assertion bundle (`subject_token`).
        const bundle = { version: BUNDLE_VERSION, credential };
        const subjectToken = encodeAssertionBundle(bundle);
        // (e) DPoP-bound RFC 8693 token exchange with the provider's DPoP handle;
        // `isDPoPNonceError` drives the single retry (RFC 9449 §8).
        return this.#exchange(issuer, tokenEndpoint, issuerConfig, subjectToken, dpop, request.signal);
    }
    /**
     * RFC 8693 token exchange at the token endpoint with a DPoP proof, retrying
     * once on a `use_dpop_nonce` challenge (RFC 9449 §8). The DPoP handle has
     * already cached the server nonce by the time {@link oauth.isDPoPNonceError}
     * reports the need to retry.
     */
    async #exchange(issuer, tokenEndpoint, config, subjectToken, dpop, signal) {
        const as = {
            issuer: issuer.href,
            token_endpoint: tokenEndpoint.href,
        };
        // The app is a public client (`token_endpoint_auth_method: none`); the OP
        // authenticates it solely by dereferencing this Client ID Document URI
        // (Solid-OIDC). `None()` sends it as the `client_id` body parameter;
        // without it a Solid OP rejects with `invalid_request - no client
        // authentication mechanism provided`. With no `client_id` (non-browser,
        // unconfigured) the OP must accept an unauthenticated public client.
        const clientId = this.#clientId(config);
        // `assertClient` requires a non-empty `client_id`; with no real client
        // (non-browser, unconfigured) we satisfy it with a placeholder and a no-op
        // auth so nothing is sent. `None()` sends the real `client_id`.
        const client = { client_id: clientId?.href ?? as.issuer };
        const clientAuth = clientId !== undefined ? oauth.None() : noClientAuth;
        const parameters = new URLSearchParams();
        parameters.set("subject_token", subjectToken);
        parameters.set("subject_token_type", WEBAUTHN_ASSERTION_TOKEN_TYPE);
        const exchangeOnce = () => oauth.genericTokenEndpointRequest(as, client, clientAuth, TOKEN_EXCHANGE_GRANT_TYPE, parameters, { DPoP: dpop, signal });
        const response = await exchangeOnce();
        try {
            return await this.#processTokenResponse(as, client, response);
        }
        catch (error) {
            if (!oauth.isDPoPNonceError(error)) {
                throw error;
            }
            const retry = await exchangeOnce();
            return this.#processTokenResponse(as, client, retry);
        }
    }
    async #processTokenResponse(as, client, response) {
        const result = await oauth.processGenericTokenEndpointResponse(as, client, response);
        // This flow always sender-constrains with DPoP; a Bearer token would be
        // bound with a (malformed) `Authorization: DPoP` header downstream, so
        // reject it here. `token_type` is normalised to lowercase by oauth4webapi.
        if (result.token_type !== "dpop") {
            throw new Error(`Token exchange returned a non-DPoP token (token_type: ${result.token_type})`);
        }
        return result;
    }
    async #resolveTokenEndpoint(issuer, config) {
        if (config.tokenEndpoint !== undefined) {
            return new URL(config.tokenEndpoint);
        }
        try {
            const discoveryResponse = await oauth.discoveryRequest(issuer);
            const authorizationServer = await oauth.processDiscoveryResponse(issuer, discoveryResponse);
            if (authorizationServer.token_endpoint !== undefined) {
                return new URL(authorizationServer.token_endpoint);
            }
        }
        catch {
            // Fall through to the conventional path.
        }
        return new URL(DEFAULT_TOKEN_PATH, issuer);
    }
    #resolveOptionsEndpoint(issuer, config) {
        return config.assertionOptionsEndpoint !== undefined
            ? new URL(config.assertionOptionsEndpoint)
            : new URL(DEFAULT_OPTIONS_PATH, issuer);
    }
    /**
     * The `client_id` to authenticate as: the configured Client ID Document URI,
     * else the app's own origin root (a valid bare-origin Solid-OIDC client_id)
     * when running in a browser. Returns `undefined` only outside a browser with
     * no configured `clientId` — in which case the OP must accept an
     * unauthenticated public client, or the caller should configure `clientId`.
     */
    #clientId(config) {
        if (config.clientId !== undefined) {
            return new URL(config.clientId);
        }
        if (typeof location !== "undefined" && location.origin && location.origin !== "null") {
            return new URL("/", location.origin);
        }
        return undefined;
    }
    /** First config whose host matches the request host. */
    #configFor(request) {
        const host = new URL(request.url).host;
        return this.#config[host];
    }
}
//# sourceMappingURL=WebAuthnTokenExchange.js.map