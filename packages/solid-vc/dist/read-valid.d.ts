import type { DatasetCore } from "@rdfjs/types";
import { type CredentialNode } from "./wrappers.js";
/**
 * The result of {@link readValidCredential} — a discriminated union so an invalid
 * credential is a VALUE, never a thrown exception. On `valid: false` the `error`
 * string names the specific structural defect (distinct per rejection reason).
 */
export type ValidCredentialResult = {
    readonly valid: true;
    readonly credential: {
        /** The credential node's IRI (`@id`); a blank node's label when anonymous. */
        readonly id: string;
        /** The single, absolute issuer IRI. */
        readonly issuer: string;
        /** `validFrom` when present and a well-formed `xsd:dateTime`. */
        readonly validFrom?: string;
        /** `validUntil` when present and a well-formed `xsd:dateTime`. */
        readonly validUntil?: string;
        /** Every `rdf:type` IRI on the node (includes `VerifiableCredential`). */
        readonly types: string[];
        /** The underlying typed node, for callers that need the claim graph. */
        readonly node: CredentialNode;
    };
} | {
    readonly valid: false;
    readonly error: string;
};
/**
 * Validate that a parsed RDF dataset contains EXACTLY ONE well-formed Verifiable
 * Credential and project its metadata, FAIL-CLOSED. Returns a discriminated result
 * — `{ valid: true; credential }` or `{ valid: false; error }` — and NEVER throws
 * on hostile input (any internal error is mapped to a `valid: false` result).
 *
 * Rejections (each with a distinct reason):
 *  - no `VerifiableCredential` node in the dataset;
 *  - MORE THAN ONE `VerifiableCredential` node (ambiguous — a hostile graph could
 *    inject a second credential; picking "the first" silently is a fail-open);
 *  - a credential-shaped node missing the `VerifiableCredential` type;
 *  - issuer missing / not exactly one / not a NamedNode / not an absolute IRI;
 *  - no `credentialSubject`;
 *  - `validFrom` / `validUntil` present but not a well-formed `xsd:dateTime`.
 */
export declare function readValidCredential(dataset: DatasetCore): ValidCredentialResult;
/**
 * Parse a credential graph (Turtle / JSON-LD string) AND validate it FAIL-CLOSED
 * in one call — the string-front companion to {@link readValidCredential}. A parse
 * failure (malformed RDF, wrong content type) is caught and returned as
 * `{ valid: false }`; this never throws.
 */
export declare function parseAndValidateCredential(body: string, contentType?: string): Promise<ValidCredentialResult>;
//# sourceMappingURL=read-valid.d.ts.map