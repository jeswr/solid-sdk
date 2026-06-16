import { type JWK } from "jose";
import type { KeyPair } from "./types.js";
/** The asymmetric key types the bundled suite supports. */
export type SuiteKeyType = "Ed25519" | "P-256";
/**
 * Generate a fresh asymmetric {@link KeyPair} for a verification method IRI. The
 * keys are WebCrypto `CryptoKey`s (extractable, so they can be JWK-exported for
 * persistence). `jose`/WebCrypto only — no hand-rolled keygen.
 */
export declare function generateKeyPairForSuite(verificationMethod: string, type?: SuiteKeyType): Promise<KeyPair>;
/** The cryptosuite id matching a key type (so a caller picks the right suite). */
export declare function cryptosuiteForKeyType(type: SuiteKeyType): string;
/** Export a key's public JWK (for publishing a verification method / a WebID profile). */
export declare function exportPublicJwk(key: KeyPair): Promise<JWK>;
/** Export a key's private JWK (for secure persistence — handle with care). */
export declare function exportPrivateJwk(key: KeyPair): Promise<JWK>;
/** Import a public verification key from a JWK (for the verifier `resolveKey`). */
export declare function importPublicKey(jwk: JWK): Promise<CryptoKey>;
/** Import a {@link KeyPair} from a private JWK + its verification method IRI. */
export declare function importKeyPair(verificationMethod: string, privateJwk: JWK): Promise<KeyPair>;
//# sourceMappingURL=keys.d.ts.map