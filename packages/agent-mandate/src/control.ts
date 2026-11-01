// AUTHORED-BY Codex GPT-6.1-Sol
import type { ControlStatement } from "@jeswr/agent-model";
import { AGENT, agent, DCT, PROV, XSD } from "@jeswr/agent-model/vocab";
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  type DataIntegrityProof,
  DataIntegritySuite,
  type KeyPair,
  type WebIdKeyResolver,
} from "@jeswr/solid-vc";
import { DataFactory, Store } from "n3";
import { validInstant } from "./instant.js";
import {
  matchesProofConfiguration,
  Node,
  node,
  RDF_TYPE,
  readProof,
  SEC,
  trig,
  writeProof,
} from "./rdf.js";

/** Unsigned agent-model control fields; the record discriminator is implicit in RDF. */
export type ControlStatementClaims = Omit<ControlStatement, "proof" | "type">;
/** Fail-closed control verification result, in approval verification order. */
export type ControlStatementResult =
  | { readonly valid: true; readonly statement: ControlStatementClaims }
  | {
      readonly valid: false;
      readonly reason: "proof-type" | "key" | "signature" | "attribution" | "expired" | "malformed";
    };

const KINDS = ["Halt", "Resume", "SetBindingState", "DispatchNow", "RevokeMandate", "Forget"];
const STATES = ["none", "setup-required", "connected", "error", "disabled"];

function controlClaims(store: Store, id: string): ControlStatementClaims {
  const a = node(store, id);
  if (a.iri(RDF_TYPE) !== agent("ControlStatement")) throw new Error("Expected control statement");
  const kindIri = a.iri(agent("controlKind"));
  const kind = kindIri.slice(AGENT.length) as ControlStatementClaims["kind"];
  if (!kindIri.startsWith(AGENT) || !KINDS.includes(kind)) throw new Error("Invalid control kind");
  const optional = (predicate: string, iri = false): string | undefined => {
    if (a.values(predicate).length === 0) return undefined;
    return iri ? a.iri(predicate) : a.text(predicate);
  };
  const target = optional(agent("target"), true);
  const binding = optional(agent("binding"));
  const bindingState = optional(agent("bindingState")) as ControlStatementClaims["bindingState"];
  const createdAt = a.text(`${DCT}created`);
  if (
    !validInstant(createdAt) ||
    (binding !== undefined && (binding.length === 0 || binding.length > 16384)) ||
    (bindingState !== undefined && !STATES.includes(bindingState)) ||
    (kind === "SetBindingState" && (!binding || !bindingState)) ||
    (["DispatchNow", "RevokeMandate", "Forget"].includes(kind) && !target)
  )
    throw new Error("Malformed control claims");
  return {
    id,
    kind,
    attributedTo: a.iri(`${PROV}wasAttributedTo`),
    createdAt,
    expires: a.text(agent("expires")),
    ...(target !== undefined ? { target } : {}),
    ...(binding !== undefined ? { binding } : {}),
    ...(bindingState !== undefined ? { bindingState } : {}),
  };
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
  const store = new Store();
  const a = node(store, statement.id);
  a.setIri(RDF_TYPE, agent("ControlStatement"));
  a.setIri(agent("controlKind"), agent(statement.kind));
  a.setIri(`${PROV}wasAttributedTo`, statement.attributedTo);
  for (const [predicate, value] of [
    [`${DCT}created`, statement.createdAt],
    [agent("expires"), statement.expires],
  ] as const)
    a.setValue(
      predicate,
      new Node(
        DataFactory.literal(value, DataFactory.namedNode(`${XSD}dateTime`)),
        store,
        a.factory,
      ),
    );
  if (statement.target !== undefined) a.setIri(agent("target"), statement.target);
  if (statement.binding !== undefined) a.setText(agent("binding"), statement.binding);
  if (statement.bindingState !== undefined)
    a.setText(agent("bindingState"), statement.bindingState);
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
    return controlClaims(await parseRdf(document, "application/trig"), id);
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
