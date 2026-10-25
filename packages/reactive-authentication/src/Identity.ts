/**
 * Who a session authenticated, from a validated ID token. Contains no secrets.
 */
export interface Identity {
    /** The ID token issuer (`iss`). */
    readonly issuer: string

    /** The subject identifier at the issuer (`sub`). */
    readonly subject: string

    /** The Solid-OIDC `webid` claim, if present and a valid HTTPS URL. */
    readonly webId?: string

    /** The authorized party (`azp`), i.e. the client the ID token was issued to. */
    readonly clientId?: string

    /** The ID token audience (`aud`). */
    readonly audience?: readonly string[]

    /**
     * Whether the WebID profile was fetched and lists the issuer (`solid:oidcIssuer`), as Solid-OIDC
     * requires verifiers to check. Without it, `webId` is only what the issuer asserted.
     */
    readonly webIdVerified: boolean
}
