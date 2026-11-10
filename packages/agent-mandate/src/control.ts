// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type ControlStatement, fromRdf, toRdf } from "@jeswr/agent-model";
import { DCT } from "@jeswr/agent-model/vocab";
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  type DataIntegrityProof,
  DataIntegritySuite,
  type KeyPair,
  type WebIdKeyResolver,
} from "@jeswr/solid-vc";
import { Store } from "n3";
import { validInstant } from "./instant.js";
import { matchesProofConfiguration, RDF_TYPE, readProof, SEC, trig, writeProof } from "./rdf.js";

/** Unsigned agent-model control fields; the record discriminator is implicit in RDF. */
export type ControlStatementClaims = Omit<ControlStatement, "proof" | "type">;
/** Fail-closed control verification result, in approval verification order. */
export type ControlStatementResult =
  | { readonly valid: true; readonly statement: ControlStatementClaims }
  | {
      readonly valid: false;
      readonly reason: "proof-type" | "key" | "signature" | "attribution" | "expired" | "malformed";
    };

function controlClaims(store: Store, id: string): ControlStatementClaims {
  const record = fromRdf(store, id);
  if (record.type !== "control-statement") throw new Error("Expected control statement");
  if (!validInstant(record.createdAt)) throw new Error("Invalid control creation instant");
  const { type: _type, proof: _proof, ...claims } = record;
  return claims;
}

/** Issue agent-model control RDF with ecdsa-rdfc-2019; accepts non-extractable P-256 keys. */
export async function issueControlStatement(
  statement: ControlStatementClaims & { readonly type?: ControlStatement["type"] },
  key: KeyPair,
  now: Date,
): Promise<string> {
  if (
    key.privateKey.algorithm.name !== "ECDSA" ||
    (key.privateKey.algorithm as { name: string; namedCurve: string }).namedCurve !== "P-256"
  )
    throw new Error("Expected P-256 control key");
  // Only the claims are signed: drop any proof a caller's record object still carries.
  const { proof: _proof, ...claims } = statement as ControlStatementClaims & { proof?: unknown };
  const store = new Store([...toRdf({ ...claims, type: "control-statement" })]);
  controlClaims(store, statement.id);
  const proof = await new DataIntegritySuite("ecdsa-rdfc-2019").sign([...store], {
    key,
    proofPurpose: "assertionMethod",
    created: now,
  });
  writeProof(store, statement.id, proof);
  return trig(store);
}

/** Parse unsigned claims for display only, never authority. No signature or expiry verification. */
export async function readControlClaims(
  document: string,
  id: string,
): Promise<ControlStatementClaims | undefined> {
  try {
    const store = await parseRdf(document, "application/trig");
    // The unsigned reader accepts bare claims too. Proofs occupy named graphs;
    // only the claims default graph is an agent-model record.
    const claims = new Store(
      [...store].filter(
        (q) =>
          q.graph.termType === "DefaultGraph" &&
          !(q.subject.value === id && q.predicate.value === `${SEC}proof`),
      ),
    );
    return controlClaims(claims, id);
  } catch {
    return undefined;
  }
}

/** Verify the owner's assertion key and complete signed graph before interpreting control claims. */
export async function verifyControlStatement(
  document: string,
  options: {
    id: string;
    ownerWebId: string;
    webIdKeyResolver: WebIdKeyResolver;
    now: () => Date;
  },
): Promise<ControlStatementResult> {
  const fail = (
    reason: Extract<ControlStatementResult, { valid: false }>["reason"],
  ): ControlStatementResult => ({
    valid: false,
    reason,
  });
  try {
    const store = await parseRdf(document, "application/trig");
    const { p, claims } = readProof(store, options.id);
    if (
      p.iri(RDF_TYPE) !== `${SEC}DataIntegrityProof` ||
      p.text(`${SEC}cryptosuite`) !== "ecdsa-rdfc-2019" ||
      p.iri(`${SEC}proofPurpose`) !== `${SEC}assertionMethod`
    )
      return fail("proof-type");
    const method = p.iri(`${SEC}verificationMethod`);
    const resolver = options.webIdKeyResolver;
    if (!(await resolver.isControlledBy(method, options.ownerWebId))) return fail("key");
    const key = await resolver.resolveKey(method);
    if (
      key?.algorithm.name !== "ECDSA" ||
      (key.algorithm as { name: string; namedCurve: string }).namedCurve !== "P-256"
    )
      return fail("key");
    const proof: DataIntegrityProof = {
      type: "DataIntegrityProof",
      cryptosuite: "ecdsa-rdfc-2019",
      verificationMethod: method,
      proofPurpose: "assertionMethod",
      created: p.text(`${DCT}created`),
      proofValue: p.text(`${SEC}proofValue`),
    };
    if (
      !(await matchesProofConfiguration(p, proof)) ||
      !(await new DataIntegritySuite("ecdsa-rdfc-2019").verify([...claims], proof, {
        resolveKey: () => key,
      }))
    )
      return fail("signature");
    const statement = controlClaims(claims, options.id);
    if (statement.attributedTo !== options.ownerWebId) return fail("attribution");
    if (
      !validInstant(statement.expires) ||
      !(Date.parse(statement.expires) > options.now().getTime())
    )
      return fail("expired");
    return { valid: true, statement };
  } catch {
    return fail("malformed");
  }
}
