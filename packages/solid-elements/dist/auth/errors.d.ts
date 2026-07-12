/** A WebID's profile advertises several OIDC issuers; the host must choose one. */
export declare class AmbiguousIssuerError extends Error {
    readonly webId: string;
    readonly issuers: string[];
    constructor(webId: string, issuers: string[]);
}
/** A WebID's profile has no `solid:oidcIssuer` — it cannot be used for Solid login. */
export declare class NoSolidIssuerError extends Error {
    readonly webId: string;
    constructor(webId: string);
}
/** The supplied input is not a usable WebID URL. */
export declare class InvalidWebIdError extends Error {
    constructor(input: string, reason: string);
}
/**
 * `login()` was called but no `authFlow` (the interactive popup driver) was supplied
 * at construction. `authFlow` is OPTIONAL — a restore-only consumer can omit it — but
 * the INTERACTIVE login flow needs it to drive the authorization-code popup. Construct
 * the controller with an `authFlow` to use `login()`.
 */
export declare class MissingAuthFlowError extends Error {
    constructor();
}
