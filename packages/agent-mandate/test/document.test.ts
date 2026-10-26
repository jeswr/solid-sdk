// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import type { KeyPair, VerifiableCredential } from "@jeswr/solid-vc";
import { beforeAll, expect, it } from "vitest";
import { mandateToTurtle, parseMandateCredential } from "../src/document.js";
import { createVcMandateVerifier, issueMandate } from "../src/mandate.js";
import { node, RDF_TYPE, SEC, turtle } from "../src/rdf.js";
import { ACTOR, clock, edKey, ID, mandate, OWNER, profileResolver, STATUS } from "./helpers.js";

let vc: VerifiableCredential;
let key: KeyPair;
beforeAll(async () => {
  key = await edKey();
  vc = await issueMandate(mandate(), key, { statusListCredential: STATUS, statusListIndex: "1" });
});
it("round-trips signed mandate Turtle without changing its verified graph", async () => {
  for (const credential of [
    vc,
    { ...vc, proof: [vc.proof] } as VerifiableCredential,
    await issueMandate(mandate(), key, {
      id: `${STATUS}#1`,
      statusListCredential: STATUS,
      statusListIndex: "1",
    }),
  ]) {
    const parsed = await parseMandateCredential(await mandateToTurtle(credential));
    const loaded = await createVcMandateVerifier({
      read: async () => parsed,
      ownerWebId: OWNER,
      agentWebId: ACTOR,
      statusListCredential: STATUS,
      webIdKeyResolver: await profileResolver(key),
      resolveStatus: async () => ({ status: "valid" }),
      now: clock,
    }).load();
    expect(loaded?.id).toBe(ID);
  }
});
it("refuses anonymous, multiple-proof and dateless proof serializations", async () => {
  for (const bad of [
    { ...vc, id: undefined },
    { ...vc, proof: [] },
    { ...vc, proof: { ...(vc.proof as object), created: undefined } },
  ])
    await expect(mandateToTurtle(bad as VerifiableCredential)).rejects.toThrow("single-proof");
});
it("fails closed on malformed, partial and altered mandate RDF", async () => {
  expect(await parseMandateCredential("invalid")).toBeUndefined();
  const document = await mandateToTurtle(vc);
  for (const [from, to] of [
    ["validFrom", "unknownFrom"],
    ["validUntil", "unknownUntil"],
    ["AgentAuthorizationCredential", "UnknownCredential"],
    ["DataIntegrityProof", "OtherProof"],
    ["assertionMethod", "authentication"],
    ["BitstringStatusListEntry", "OtherStatus"],
    ["revocation", "suspension"],
  ])
    expect(
      await parseMandateCredential(document.replace(from as string, to as string)),
    ).toBeUndefined();
  expect(
    await parseMandateCredential(document.replaceAll("VerifiableCredential", "Other")),
  ).toBeUndefined();
  const store = await parseRdf(document, "text/turtle");
  node(store, OWNER).setText("urn:example:extra", "unsigned injection");
  expect(await parseMandateCredential(await turtle(store))).toBeUndefined();
  const duplicate = await parseRdf(document, "text/turtle");
  node(duplicate, ID).setIri(`${SEC}proof`, "urn:another-proof");
  node(duplicate, "urn:another-proof").setIri(RDF_TYPE, `${SEC}DataIntegrityProof`);
  expect(await parseMandateCredential(await turtle(duplicate))).toBeUndefined();
});
