// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The high-level issue/sign API. `issue()` lowers a Credential to its claim graph,
// asks a ProofSuite for a Data Integrity proof over those exact quads, and returns
// the signed VerifiableCredential (data model + the embedded proof). Suite-agnostic
// via the ProofSuite seam; the bundled DataIntegritySuite is the default.

import { randomUUID } from "node:crypto";
import {
  buildAgentAuthorizationCredential,
  credentialToRdf,
  normalizeCredentialSubjects,
} from "./credential.js";
import { DataIntegritySuite, type ProofSuite } from "./proof.js";
import type {
  AgentAuthorization,
  Credential,
  IssueOptions,
  KeyPair,
  VerifiableCredential,
} from "./types.js";

/** Inputs to {@link issue}. */
export interface IssueInput {
  /** The unsigned credential (claim graph). */
  readonly credential: Credential;
  /** The signing key (the bundled suite expects a {@link KeyPair}). */
  readonly key: KeyPair | unknown;
  /**
   * The proof suite to sign with. Defaults to the bundled `eddsa-rdfc-2022`
   * Data Integrity suite. Pass a BBS / JWT / SPARQ-ZK suite to sign with that.
   */
  readonly suite?: ProofSuite;
  /** Signing options (proofPurpose, created). */
  readonly options?: IssueOptions;
}

/**
 * Issue (sign) a Verifiable Credential. The proof is computed over the credential's
 * RDFC-1.0-canonical claim graph (the SAME bytes a verifier reconstructs), so any
 * later tamper to a claim, the issuer, the validity window, or the proof options
 * invalidates the signature.
 *
 * `validFrom` defaults to `now` (the `created` time, or wall-clock) when the caller
 * omitted it — so an issued credential always carries an issuance instant.
 */
export async function issue(input: IssueInput): Promise<VerifiableCredential> {
  const suite = input.suite ?? new DataIntegritySuite("eddsa-rdfc-2022");
  const created = input.options?.created ?? new Date();
  const proofPurpose = input.options?.proofPurpose ?? "assertionMethod";

  // Ensure the credential has a stable @id (so the proof binds a named subject) and a
  // validFrom (issuance instant) before lowering. Normalise the subject id(s) to the
  // SAME form the signed RDF graph uses (a blank/whitespace id → anonymous, stripped;
  // a present relative id → throws) so the RETURNED signed VC agrees byte-for-byte
  // with the blank-node graph the proof is computed over — never returning a
  // whitespace-only id that JSON-LD would read as a present relative `@id`.
  const credential: Credential = normalizeCredentialSubjects({
    ...input.credential,
    id: input.credential.id ?? `urn:uuid:${randomUUID()}`,
    validFrom: input.credential.validFrom ?? created.toISOString(),
  });

  const documentQuads = credentialToRdf(credential);
  const proof = await suite.sign(documentQuads, {
    key: input.key,
    proofPurpose,
    created,
  });
  return { ...credential, proof };
}

/**
 * Convenience: build + sign an {@link AgentAuthorization} ("WebID X authorizes
 * agent Y for action Z under policy P") in one call. The principal WebID is the
 * issuer; sign with that WebID's key.
 */
export async function issueAgentAuthorization(
  auth: AgentAuthorization,
  key: KeyPair | unknown,
  opts?: { suite?: ProofSuite; options?: IssueOptions },
): Promise<VerifiableCredential> {
  const credential = buildAgentAuthorizationCredential(auth);
  return issue({
    credential,
    key,
    ...(opts?.suite !== undefined ? { suite: opts.suite } : {}),
    ...(opts?.options !== undefined ? { options: opts.options } : {}),
  });
}
