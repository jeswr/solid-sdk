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
import { defaultMandate } from "../src/mandate.js";
import { node, SEC, turtle } from "../src/rdf.js";
import { AGENT, type Intent, type Mandate } from "../src/types.js";
export const OWNER = "https://owner.example/profile#me";
export const ACTOR = "https://agent.example/#me";
export const ID = "https://pod.example/agent/mandates/default";
export const STATUS = "https://pod.example/agent/mandates/status.ttl";
export const NOW = new Date("2026-10-26T12:00:00Z");
export const HASH = `sha256:${"a".repeat(64)}`;
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
  const store = await parseRdf(document, "text/turtle");
  const subject = node(store, id);
  const proof = subject.one(`${SEC}proof`);
  const config = [...store].filter(
    (q) => proof.equals(q.subject) && q.predicate.value !== `${SEC}proofValue`,
  );
  const claims = [...store].filter(
    (q) =>
      !proof.equals(q.subject) &&
      !(subject.equals(q.subject) && q.predicate.value === `${SEC}proof`),
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

/** Change RDF proof options without changing the claims or signature bytes. */
export async function alterProofOptions(
  document: string,
  id: string,
  change: "named" | "datatype" | "cryptosuite-datatype" | "extra",
): Promise<string> {
  const store = await parseRdf(document, "text/turtle");
  const subject = node(store, id);
  const proof = subject.one(`${SEC}proof`);
  if (change === "named") {
    const named = node(store, `${id}/proof`);
    const old = [...store].filter((q) => proof.equals(q.subject));
    for (const predicate of new Set(old.map((q) => q.predicate.value)))
      for (const value of proof.values(predicate)) named.setValue(predicate, value);
    store.removeQuads([
      ...old,
      ...[...store].filter((q) => subject.equals(q.subject) && q.predicate.value === `${SEC}proof`),
    ]);
    subject.setIri(`${SEC}proof`, named.value);
  } else if (change === "datatype" || change === "cryptosuite-datatype") {
    const predicate =
      change === "datatype" ? "http://purl.org/dc/terms/created" : `${SEC}cryptosuite`;
    const value = proof.text(predicate);
    store.removeQuads(
      [...store].filter((q) => proof.equals(q.subject) && q.predicate.value === predicate),
    );
    proof.setText(predicate, value);
  } else proof.setText("urn:example:extra", "unsigned option");
  return turtle(store);
}
