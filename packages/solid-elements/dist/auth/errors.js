// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @jeswr/solid-elements/auth — the typed error taxonomy the LoginController throws.
//
// Pure value module (no runtime deps) extracted from the auth controller so the
// named failure modes a `/auth` consumer catches are one small reviewable file.
// Re-exported unchanged from `./index.js` (the public `/auth` contract is byte-stable).
/** A WebID's profile advertises several OIDC issuers; the host must choose one. */
export class AmbiguousIssuerError extends Error {
    webId;
    issuers;
    constructor(webId, issuers) {
        super(`This WebID advertises ${issuers.length} OIDC issuers — supply a 'chooseIssuer' ` +
            `callback so the user can pick one (${webId}).`);
        this.name = "AmbiguousIssuerError";
        this.webId = webId;
        this.issuers = issuers;
    }
}
/** A WebID's profile has no `solid:oidcIssuer` — it cannot be used for Solid login. */
export class NoSolidIssuerError extends Error {
    webId;
    constructor(webId) {
        super(`This WebID has no solid:oidcIssuer, so it can't be used for Solid login (${webId}).`);
        this.name = "NoSolidIssuerError";
        this.webId = webId;
    }
}
/** The supplied input is not a usable WebID URL. */
export class InvalidWebIdError extends Error {
    constructor(input, reason) {
        super(`Not a valid WebID (${reason}): ${input}`);
        this.name = "InvalidWebIdError";
    }
}
/**
 * `login()` was called but no `authFlow` (the interactive popup driver) was supplied
 * at construction. `authFlow` is OPTIONAL — a restore-only consumer can omit it — but
 * the INTERACTIVE login flow needs it to drive the authorization-code popup. Construct
 * the controller with an `authFlow` to use `login()`.
 */
export class MissingAuthFlowError extends Error {
    constructor() {
        super("login() requires an 'authFlow' (the interactive popup driver), but none was " +
            "supplied to createReactiveAuthController. Pass options.authFlow to enable " +
            "interactive login. (Silent restore via restore() does not need it.)");
        this.name = "MissingAuthFlowError";
    }
}
