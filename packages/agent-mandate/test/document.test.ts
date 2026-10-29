// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import type { KeyPair, VerifiableCredential } from "@jeswr/solid-vc";
import { beforeAll, expect, it } from "vitest";
import { mandateToTurtle, parseMandateCredential } from "../src/document.js";
import { createVcMandateVerifier, issueMandate } from "../src/mandate.js";
import { node, RDF_TYPE, SEC, turtle } from "../src/rdf.js";
import { AGENT, ODRL } from "../src/types.js";
import {
  ACTOR,
  alterProofOptions,
  clock,
  edKey,
  ID,
  mandate,
  OWNER,
  profileResolver,
  STATUS,
  verifyExportedRdf,
} from "./helpers.js";

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
it("verifies the exported mandate proof configuration independently with WebCrypto", async () => {
  const document = await mandateToTurtle(vc);
  expect(await verifyExportedRdf(document, ID, key.publicKey)).toBe(true);
  const store = await parseRdf(document, "text/turtle");
  const proof = node(store, ID).one(`${SEC}proof`);
  expect(proof.termType).toBe("BlankNode");
  const cryptosuite = proof.one(`${SEC}cryptosuite`);
  expect((cryptosuite as unknown as { datatype: { value: string } }).datatype.value).toBe(
    `${SEC}cryptosuiteString`,
  );
  const created = proof.one("http://purl.org/dc/terms/created");
  expect((created as unknown as { datatype: { value: string } }).datatype.value).toBe(
    "http://www.w3.org/2001/XMLSchema#dateTime",
  );
});
it("preserves ACL, delegation and extension vocabulary in signed mandate Turtle", async () => {
  const m = {
    ...mandate(),
    autonomous: {
      id: "urn:policy",
      permissions: [
        {
          type: "permission" as const,
          action: "append",
          constraints: [
            { leftOperand: "delegationDepth", operator: "lteq" as const, rightOperand: 1 },
            { leftOperand: `${AGENT}binding`, operator: "eq" as const, rightOperand: "gmail" },
          ],
        },
        { type: "permission" as const, action: "control" },
        { type: "permission" as const, action: `${AGENT}SendMessage` },
      ],
    },
  };
  const credential = await issueMandate(m, key, {
    statusListCredential: STATUS,
    statusListIndex: "1",
  });
  const document = await mandateToTurtle(credential);
  expect(await verifyExportedRdf(document, ID, key.publicKey)).toBe(true);
  const store = await parseRdf(document, "text/turtle");
  expect(
    [...store].filter((q) => q.predicate.value === `${ODRL}action`).map((q) => q.object.value),
  ).toEqual(
    expect.arrayContaining([
      "http://www.w3.org/ns/auth/acl#Append",
      "http://www.w3.org/ns/auth/acl#Control",
      `${AGENT}SendMessage`,
    ]),
  );
  expect(
    [...store].filter((q) => q.predicate.value === `${ODRL}leftOperand`).map((q) => q.object.value),
  ).toEqual(
    expect.arrayContaining([
      "https://w3id.org/jeswr/odrl-delegation#delegationDepth",
      `${AGENT}binding`,
    ]),
  );
  const parsed = await parseMandateCredential(document);
  expect(parsed).toBeDefined();
  const loaded = await createVcMandateVerifier({
    read: async () => parsed,
    ownerWebId: OWNER,
    agentWebId: ACTOR,
    statusListCredential: STATUS,
    webIdKeyResolver: await profileResolver(key),
    resolveStatus: async () => ({ status: "valid" }),
    now: clock,
  }).load();
  expect(loaded?.id).toBe(m.id);
  expect(loaded?.autonomous).toMatchObject(m.autonomous);
});
it.each([
  "named",
  "datatype",
  "cryptosuite-datatype",
  "extra",
] as const)("rejects altered mandate proof configuration: %s", async (change) => {
  const document = await alterProofOptions(await mandateToTurtle(vc), ID, change);
  expect(await verifyExportedRdf(document, ID, key.publicKey)).toBe(false);
  expect(await parseMandateCredential(document)).toBeUndefined();
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
