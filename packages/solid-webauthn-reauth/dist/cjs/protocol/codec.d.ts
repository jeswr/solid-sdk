import type { AssertionBundle } from "./types.js";
/** Error thrown when a presented assertion bundle cannot be decoded/validated. */
export declare class MalformedBundleError extends Error {
    constructor(message: string);
}
/** Encode an assertion bundle to its on-the-wire `subject_token` form. */
export declare function encodeAssertionBundle(bundle: AssertionBundle): string;
/**
 * Decode and validate a `subject_token` into an {@link AssertionBundle}.
 *
 * Validation here is structural only — it guards the parse and the envelope
 * version. Cryptographic verification of the inner WebAuthn assertion is the
 * verifier's job.
 *
 * @throws {MalformedBundleError} on bad base64url, non-JSON, wrong shape, or an
 *   unknown `version` (maps to `invalid_request`).
 */
export declare function decodeAssertionBundle(token: string): AssertionBundle;
//# sourceMappingURL=codec.d.ts.map