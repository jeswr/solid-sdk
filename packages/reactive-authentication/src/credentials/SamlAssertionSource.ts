import { base64url } from "jose"
import { TokenType } from "../lws/constants.js"
import { ReactiveAuthenticationError } from "../ReactiveAuthenticationError.js"
import type { CredentialRequest, CredentialSource, SubjectCredential } from "./CredentialSource.js"

/** A signed SAML 2.0 assertion obtained from an identity provider by an established SAML stack. */
export interface SamlAssertion {
    /** The signed `<saml:Assertion>` XML, exactly as issued (re-serializing breaks the signature). */
    readonly xml: string

    /** The LWS client identifier: the assertion's `SubjectConfirmationData/@Recipient`. */
    readonly clientId: string

    /** `NotOnOrAfter` of the assertion (ms since epoch), if known. */
    readonly expiresAt?: number
}

export interface SamlAssertionSourceOptions {
    /** Stable, secret-free identifier of the SAML identity context (e.g. IdP entity ID and NameID). */
    readonly id: string

    /**
     * Obtains an assertion whose audience includes the authorization server — typically by calling the
     * application's own SAML service provider backend (e.g. built with samlify, node-saml or Shibboleth).
     */
    readonly obtainAssertion: (request: CredentialRequest) => Promise<SamlAssertion>

    /** @defaultValue 256 KiB */
    readonly maxBytes?: number
}

/**
 * LWS SAML 2.0 suite, client side: transports a signed assertion as an RFC 8693 `saml2` subject token
 * (base64url of the assertion XML).
 *
 * This source does not parse or validate XML or signatures — browsers and Node.js have no safe built-in
 * XML signature stack. Validation (signature per SAML Core §5 against an out-of-band trusted IdP, issuer,
 * audience, recipient and validity window) is the authorization server's responsibility; the tests
 * demonstrate it with xml-crypto in a mock authorization server.
 */
export class SamlAssertionSource implements CredentialSource {
    readonly #options: SamlAssertionSourceOptions

    constructor(options: SamlAssertionSourceOptions) {
        this.#options = options
    }

    get id(): string {
        return `saml:${this.#options.id}`
    }

    async getCredential(request: CredentialRequest): Promise<SubjectCredential> {
        const assertion = await this.#options.obtainAssertion(request)
        const bytes = new TextEncoder().encode(assertion.xml)
        if (bytes.length === 0 || bytes.length > (this.#options.maxBytes ?? 256 * 1024)) {
            throw new ReactiveAuthenticationError("SAML assertion is empty or too large")
        }
        if (!/<(?:\w+:)?Assertion[\s>]/.test(assertion.xml)) {
            throw new ReactiveAuthenticationError("SAML credential is not an Assertion element")
        }

        return {
            token: base64url.encode(bytes),
            tokenType: TokenType.saml2,
            clientId: assertion.clientId,
            ...(assertion.expiresAt === undefined ? {} : {expiresAt: assertion.expiresAt}),
        }
    }
}
