// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  base58btcDecode,
  canonicalNQuads,
  createWebIdKeyResolver,
  generateKeyPairForSuite,
  type KeyPair,
  publishVerificationMethod,
  type ResolveWebIdKeyOptions,
} from "@jeswr/solid-vc";
import type { DataFactory as Factory, Quad_Graph } from "@rdfjs/types";
import { NamedGraphDataset, TermAs } from "@rdfjs/wrapper";
// biome-ignore lint/style/useNodejsImportProtocol: the agent import guard requires bare module names
import { readFileSync } from "fs";
import { DataFactory } from "n3";
import { expect } from "vitest";
import { defaultMandate } from "../src/mandate.js";
import { Node, node, readProof, SEC, trig } from "../src/rdf.js";
import { AGENT, type Intent, type Mandate } from "../src/types.js";
export const OWNER = "https://owner.example/profile#me";
export const ACTOR = "https://agent.example/#me";
export const ID = "https://pod.example/agent/mandates/default";
export const STATUS = "https://pod.example/agent/mandates/status.ttl";
export const NOW = new Date("2026-10-26T12:00:00Z");
export const HASH = `sha256:${"a".repeat(64)}`;
/** Invalid instants that permissive date parsers may normalize or accept. */
export const INVALID_INSTANTS = [
  "2026-02-29T00:00:00Z",
  "2026-02-30T00:00:00Z",
  "2026-04-31T00:00:00Z",
  "2100-02-29T00:00:00Z",
  "2026-10-25T24:00:00Z",
  "2026-10-25T12:00:00+14:01",
  "2026-10-25T12:00:00-14:01",
  "2026-10-25T12:00:00+15:00",
  "2026-10-25T12:00:00-15:00",
  "2026-10-25T12:00:00+23:59",
  "2026-10-25T12:00:00+13:60",
  "2026-10-25T12:00:00",
  "2026-10-25",
  "2026-10-25 12:00:00Z",
  "2026-10-25T12:00Z",
];
export const clock = () => NOW;
export const mandate = (): Mandate =>
  defaultMandate({
    id: ID,
    ownerWebId: OWNER,
    agentWebId: ACTOR,
    recipientHashes: [HASH],
    now: NOW,
  });
export const intent = (extra: Partial<Intent> = {}): Intent => ({
  agent: ACTOR,
  action: `${AGENT}SendMessage`,
  target: "https://pod.example/proposals/1",
  at: NOW.toISOString(),
  attributes: { [`${AGENT}binding`]: "gmail", [`${AGENT}recipientSet`]: HASH },
  ...extra,
});
export const edKey = () => generateKeyPairForSuite(`${OWNER}/ed`);
export async function approvalKey(): Promise<KeyPair> {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  return { ...keys, verificationMethod: `${OWNER}/approval` };
}
export async function profileResolver(key: KeyPair) {
  const profile = await publishVerificationMethod({
    controller: OWNER,
    verificationMethod: key.verificationMethod,
    key,
  });
  const fetchFixture: NonNullable<ResolveWebIdKeyOptions["fetch"]> = async () =>
    new Response(profile.turtle, { headers: { "content-type": "text/turtle" } });
  return createWebIdKeyResolver({ fetch: fetchFixture });
}

/** Verify the exported RDF directly, independently of proof reconstruction and suite verification.
 * https://www.w3.org/TR/vc-di-ecdsa/#proof-configuration-ecdsa-rdfc-2019
 */
export async function verifyExportedRdf(
  document: string,
  id: string,
  key: CryptoKey,
): Promise<boolean> {
  const store = await parseRdf(document, "application/trig");
  const subject = node(store, id);
  const graph = subject.one(`${SEC}proof`);
  const factory = DataFactory as unknown as Factory;
  const dataset = new NamedGraphDataset(TermAs.term(graph) as Quad_Graph, store, factory);
  const first = [...dataset][0];
  if (!first) throw new Error("Missing exported proof graph");
  const proof = new Node(first.subject, dataset, factory);
  const config = [...dataset].filter(
    (q) => proof.equals(q.subject) && q.predicate.value !== `${SEC}proofValue`,
  );
  const claims = [...store].filter(
    (q) =>
      !graph.equals(q.graph) && !(subject.equals(q.subject) && q.predicate.value === `${SEC}proof`),
  );
  const hashes = await Promise.all(
    [config, claims].map(
      async (quads) =>
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(await canonicalNQuads(quads)),
          ),
        ),
    ),
  );
  const input = new Uint8Array(64);
  input.set(hashes[0] as Uint8Array, 0);
  input.set(hashes[1] as Uint8Array, 32);
  return crypto.subtle.verify(
    key.algorithm.name === "Ed25519" ? "Ed25519" : { name: "ECDSA", hash: "SHA-256" },
    key,
    base58btcDecode(proof.text(`${SEC}proofValue`)) as Uint8Array<ArrayBuffer>,
    input,
  );
}

/** Compare export to a generic JSON-LD parser using the locally vendored W3C context. */
export async function expectStandardProof(document: string, id: string): Promise<void> {
  const store = await parseRdf(document, "application/trig");
  const graph = node(store, id).one(`${SEC}proof`);
  const { p } = readProof(store, id);
  expect(graph.termType).toBe("BlankNode");
  expect(p.equals(TermAs.term(graph))).toBe(false);
  const expected = await parseRdf(
    JSON.stringify({
      ...JSON.parse(
        readFileSync(
          new URL("../../solid-vc/src/contexts/data-integrity-v2.json", import.meta.url),
          "utf8",
        ),
      ),
      id,
      proof: {
        type: "DataIntegrityProof",
        cryptosuite: p.text(`${SEC}cryptosuite`),
        verificationMethod: p.iri(`${SEC}verificationMethod`),
        proofPurpose: "assertionMethod",
        created: p.text("http://purl.org/dc/terms/created"),
        proofValue: p.text(`${SEC}proofValue`),
      },
    }),
    "application/ld+json",
  );
  const exported = [...store].filter(
    (q) => graph.equals(q.graph) || q.predicate.value === `${SEC}proof`,
  );
  expect(await canonicalNQuads(exported)).toBe(await canonicalNQuads([...expected]));
}

/** Change RDF proof options without changing the claims or signature bytes. */
export async function alterProofOptions(
  document: string,
  id: string,
  change: "named" | "datatype" | "cryptosuite-datatype" | "extra",
): Promise<string> {
  const store = await parseRdf(document, "application/trig");
  const { p: proof } = readProof(store, id);
  if (change === "named") {
    const named = new Node(DataFactory.namedNode(`${id}/proof`), proof.dataset, proof.factory);
    const old = [...store].filter((q) => proof.equals(q.subject));
    for (const predicate of new Set(old.map((q) => q.predicate.value)))
      for (const value of proof.values(predicate)) named.setValue(predicate, value);
    store.removeQuads(old);
  } else if (change === "datatype" || change === "cryptosuite-datatype") {
    const predicate =
      change === "datatype" ? "http://purl.org/dc/terms/created" : `${SEC}cryptosuite`;
    const value = proof.text(predicate);
    store.removeQuads(
      [...store].filter((q) => proof.equals(q.subject) && q.predicate.value === predicate),
    );
    proof.setText(predicate, value);
  } else proof.setText("urn:example:extra", "unsigned option");
  return trig(store);
}

export const PROOF_GRAPH_CHANGES = [
  "literal-link",
  "empty-graph",
  "extra-node",
  "untyped-value",
  "iri-value",
  "duplicate-value",
  "option-default",
  "extra-graph",
] as const;
/** Malformed graph boundaries and signature datatypes must not be laundered by extraction. */
export async function alterProofGraph(
  document: string,
  id: string,
  change: (typeof PROOF_GRAPH_CHANGES)[number],
): Promise<string> {
  const store = await parseRdf(document, "application/trig");
  const root = node(store, id);
  const graph = root.one(`${SEC}proof`);
  const { p } = readProof(store, id);
  if (change === "literal-link") {
    store.removeQuads(
      [...store].filter((q) => root.equals(q.subject) && q.predicate.value === `${SEC}proof`),
    );
    root.setText(`${SEC}proof`, graph.value);
  } else if (change === "empty-graph") {
    const flat = new Node(TermAs.term(p), store, p.factory);
    for (const q of [...p.dataset])
      flat.setValue(q.predicate.value, new Node(q.object, store, p.factory));
    store.removeQuads([...store].filter((q) => graph.equals(q.graph)));
  } else if (change === "extra-node" || change === "extra-graph") {
    const dataset =
      change === "extra-node"
        ? p.dataset
        : new NamedGraphDataset(DataFactory.namedNode("urn:example:other-graph"), store, p.factory);
    new Node(DataFactory.blankNode(), dataset, p.factory).setText("urn:example:extra", "injected");
  } else if (change === "option-default") {
    const predicate = "http://purl.org/dc/terms/created";
    const value = p.one(predicate);
    store.removeQuads(
      [...store].filter((q) => p.equals(q.subject) && q.predicate.value === predicate),
    );
    new Node(TermAs.term(p), store, p.factory).setValue(predicate, value);
  } else {
    if (change !== "duplicate-value")
      store.removeQuads(
        [...store].filter((q) => p.equals(q.subject) && q.predicate.value === `${SEC}proofValue`),
      );
    if (change === "iri-value") p.setIri(`${SEC}proofValue`, "urn:example:signature");
    else p.setText(`${SEC}proofValue`, "zFakeSignature");
  }
  return trig(store);
}
