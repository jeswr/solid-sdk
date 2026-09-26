import { base58btc } from "multiformats/bases/base58"
import { varint } from "multiformats"
import { SelfIssuedJwtSource } from "./SelfIssuedJwtSource.js"
import type { CredentialRequest, CredentialSource, SubjectCredential } from "./CredentialSource.js"

/** Multicodec codes from the multiformats table: `ed25519-pub` and `p256-pub`. */
const ED25519_PUB = 0xed
const P256_PUB = 0x1200

/**
 * The did:key identifier of a public key (did:key method §3.1): multibase base58btc of the multicodec
 * varint followed by the raw public key (compressed SEC1 point for P-256).
 */
export async function didKeyFromPublicKey(publicKey: CryptoKey): Promise<string> {
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey))
    const algorithm = publicKey.algorithm as EcKeyAlgorithm
    let code: number
    let bytes: Uint8Array
    if (algorithm.name === "Ed25519") {
        code = ED25519_PUB
        bytes = raw
    } else if (algorithm.name === "ECDSA" && algorithm.namedCurve === "P-256") {
        code = P256_PUB
        bytes = compressP256(raw)
    } else {
        throw new TypeError(`did:key is supported for Ed25519 and P-256 keys, not ${algorithm.name}`)
    }

    const prefix = varint.encodeTo(code, new Uint8Array(varint.encodingLength(code)))
    const multikey = new Uint8Array(prefix.length + bytes.length)
    multikey.set(prefix)
    multikey.set(bytes, prefix.length)
    return `did:key:${base58btc.encode(multikey)}`
}

/** SEC1 §2.3.3 point compression of an uncompressed (0x04 ‖ X ‖ Y) P-256 public key. */
function compressP256(raw: Uint8Array): Uint8Array {
    if (raw.length !== 65 || raw[0] !== 0x04) throw new TypeError("Expected an uncompressed P-256 public key")
    const compressed = new Uint8Array(33)
    compressed[0] = (raw[64]! & 1) === 0 ? 0x02 : 0x03
    compressed.set(raw.subarray(1, 33), 1)
    return compressed
}

/**
 * LWS "Self-signed Identity using did:key" (discontinued draft, subsumed by the controlled identifier
 * suite, which accepts DID subjects). The identifier is derived from the signing key itself, so the
 * credential and its subject cannot disagree.
 */
export class DidKeySource implements CredentialSource {
    readonly #did: string
    readonly #inner: SelfIssuedJwtSource

    private constructor(did: string, inner: SelfIssuedJwtSource) {
        this.#did = did
        this.#inner = inner
    }

    /**
     * Creates a source for an existing key pair (non-extractable private key recommended). The pair is
     * checked to correspond by signing a random challenge and verifying it with the public key.
     */
    static async fromKeyPair(keyPair: CryptoKeyPair, lifetimeSeconds?: number): Promise<DidKeySource> {
        const did = await didKeyFromPublicKey(keyPair.publicKey)
        await assertKeyPair(keyPair)
        const algorithm = keyPair.privateKey.algorithm.name === "Ed25519" ? "EdDSA" : "ES256"
        const fingerprint = did.slice("did:key:".length)
        const inner = new SelfIssuedJwtSource({
            subject: did,
            privateKey: keyPair.privateKey,
            algorithm,
            keyId: `${did}#${fingerprint}`,
            ...(lifetimeSeconds === undefined ? {} : {lifetimeSeconds}),
        })
        return new DidKeySource(did, inner)
    }

    /** Generates a new non-extractable key pair. */
    static async generate(algorithm: "Ed25519" | "P-256" = "Ed25519"): Promise<DidKeySource> {
        const params = algorithm === "Ed25519" ? {name: "Ed25519"} : {name: "ECDSA", namedCurve: "P-256"}
        const keyPair = await crypto.subtle.generateKey(params, false, ["sign", "verify"]) as CryptoKeyPair
        return await DidKeySource.fromKeyPair(keyPair)
    }

    get did(): string {
        return this.#did
    }

    get id(): string {
        return `did-key:${this.#did}`
    }

    async getCredential(request: CredentialRequest): Promise<SubjectCredential> {
        return await this.#inner.getCredential(request)
    }
}

async function assertKeyPair({publicKey, privateKey}: CryptoKeyPair): Promise<void> {
    const params = publicKey.algorithm.name === "Ed25519" ? {name: "Ed25519"} : {name: "ECDSA", hash: "SHA-256"}
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    let valid = false
    try {
        valid = await crypto.subtle.verify(params, publicKey, await crypto.subtle.sign(params, privateKey, challenge), challenge)
    } catch {
        valid = false
    }
    if (!valid) throw new TypeError("The private key does not correspond to the public key")
}
