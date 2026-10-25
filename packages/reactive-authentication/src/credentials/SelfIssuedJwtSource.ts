import { SignJWT } from "jose"
import { TokenType } from "../lws/constants.js"
import type { CredentialRequest, CredentialSource, SubjectCredential } from "./CredentialSource.js"

export interface SelfIssuedJwtOptions {
    /** The agent's identifier (HTTPS URL of a controlled identifier document, or a DID). Used as sub, iss and client_id. */
    readonly subject: string

    /** Private signing key; keep it non-extractable. */
    readonly privateKey: CryptoKey

    /** JWS algorithm matching the key, e.g. `ES256` or `EdDSA`. */
    readonly algorithm: string

    /**
     * `kid` header: the verification method that verifiers select in the subject's controlled identifier
     * document (CID 1.0 §3.3). Use the verification method's absolute URL (see {@link verificationMethodFor}).
     */
    readonly keyId: string

    /** Credential lifetime. @defaultValue 300 seconds, the LWS recommended maximum for access tokens */
    readonly lifetimeSeconds?: number
}

/**
 * LWS "Self-signed Identity using Controlled Identifiers": the agent signs its own JWT with
 * `sub` = `iss` = `client_id` = its identifier, `aud` = [the authorization server], `iat`, `exp` and a
 * fresh `jti`. A new credential is signed for each authorization server and exchange.
 */
export class SelfIssuedJwtSource implements CredentialSource {
    readonly #options: SelfIssuedJwtOptions

    constructor(options: SelfIssuedJwtOptions) {
        if (options.algorithm === "none") throw new TypeError("Self-issued credentials must be signed")
        if (!isAbsoluteUri(options.subject)) throw new TypeError(`Subject must be an absolute URI: ${options.subject}`)
        if (typeof options.keyId !== "string" || options.keyId.length === 0) throw new TypeError("A kid naming the verification method is required")
        const lifetime = options.lifetimeSeconds ?? 300
        if (!Number.isFinite(lifetime) || lifetime <= 0) throw new RangeError("lifetimeSeconds must be a positive finite number")
        if (options.privateKey.type !== "private" || !options.privateKey.usages.includes("sign")) throw new TypeError("A private signing key is required")
        this.#options = options
    }

    get id(): string {
        return `self-issued:${this.#options.subject}`
    }

    async getCredential(request: CredentialRequest): Promise<SubjectCredential> {
        request.signal.throwIfAborted()
        const {subject, privateKey, algorithm, keyId} = this.#options
        const lifetime = this.#options.lifetimeSeconds ?? 300
        const now = Math.floor(Date.now() / 1000)

        const token = await new SignJWT({client_id: subject})
            .setProtectedHeader({alg: algorithm, typ: "JWT", kid: keyId})
            .setSubject(subject)
            .setIssuer(subject)
            .setAudience([request.authorizationServer.href])
            .setIssuedAt(now)
            .setExpirationTime(now + lifetime)
            .setJti(crypto.randomUUID())
            .sign(privateKey)

        return {token, tokenType: TokenType.jwt, clientId: subject, expiresAt: (now + lifetime) * 1000}
    }
}

/** A CID verification method (JsonWebKey type) for a public key, and the `kid` that selects it. */
export async function verificationMethodFor(subject: string, publicKey: CryptoKey, fragment: string) {
    const {kty, crv, x, y, n, e} = await crypto.subtle.exportKey("jwk", publicKey)
    const id = `${subject}#${fragment}`
    const publicKeyJwk = Object.fromEntries(Object.entries({kty, crv, x, y, n, e}).filter(([, v]) => v !== undefined))
    return {
        keyId: id,
        verificationMethod: {id, type: "JsonWebKey", controller: subject, publicKeyJwk},
    }
}

/**
 * A minimal controlled identifier document publishing the key for authentication, as LWS verifiers
 * dereference `sub` and select the method named by `kid`. Serve it at `subject` as `application/cid`
 * or JSON-LD, at a URL the agent controls.
 */
export async function createControlledIdentifierDocument(subject: string, publicKey: CryptoKey, fragment = "key-1") {
    const {keyId, verificationMethod} = await verificationMethodFor(subject, publicKey, fragment)
    return {
        keyId,
        document: {
            "@context": ["https://www.w3.org/ns/cid/v1"],
            id: subject,
            verificationMethod: [verificationMethod],
            authentication: [keyId],
        },
    }
}

/** An absolute URI: an HTTP(S) URL without credentials or fragment, or a DID. */
function isAbsoluteUri(value: string): boolean {
    if (/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(value)) return true
    try {
        const url = new URL(value)
        return (url.protocol === "https:" || url.protocol === "http:") && url.username === "" && url.password === "" && url.hash === ""
    } catch {
        return false
    }
}
