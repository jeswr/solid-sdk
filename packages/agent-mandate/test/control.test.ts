// AUTHORED-BY Codex GPT-6.1-Sol
import { fromRdf } from "@jeswr/agent-model";
import { AGENT, agent, DCT, PROV } from "@jeswr/agent-model/vocab";
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataIntegritySuite, type KeyPair, type WebIdKeyResolver } from "@jeswr/solid-vc";
import type { Store } from "n3";
import { beforeAll, expect, it } from "vitest";
import {
  type ControlStatementClaims,
  issueControlStatement,
  readControlClaims,
  verifyControlStatement,
} from "../src/index.js";
import { node, RDF_TYPE, readProof, trig, writeProof } from "../src/rdf.js";
import {
  alterProofGraph,
  alterProofOptions,
  approvalKey,
  clock,
  edKey,
  expectStandardProof,
  INVALID_INSTANTS,
  MILLISECOND_FRACTIONS,
  NOW,
  OWNER,
  PROOF_GRAPH_CHANGES,
  profileResolver,
  verifyExportedRdf,
} from "./helpers.js";

let key: KeyPair;
let resolver: WebIdKeyResolver;
const statement: ControlStatementClaims = {
  id: "https://pod.example/agent/control/1",
  kind: "SetBindingState",
  attributedTo: OWNER,
  createdAt: NOW.toISOString(),
  expires: "2026-10-27T12:00:00Z",
  target: "https://pod.example/agent/proposals/1",
  binding: "gmail",
  bindingState: "disabled",
};
const options = () => ({
  id: statement.id,
  ownerWebId: OWNER,
  webIdKeyResolver: resolver,
  now: clock,
});
beforeAll(async () => {
  key = await approvalKey();
  resolver = await profileResolver(key);
});

async function signedChange(change: (store: Store) => void): Promise<string> {
  const doc = await issueControlStatement(statement, key, NOW);
  const { claims } = readProof(await parseRdf(doc, "application/trig"), statement.id);
  change(claims);
  const proof = await new DataIntegritySuite("ecdsa-rdfc-2019").sign([...claims], {
    key,
    proofPurpose: "assertionMethod",
    created: NOW,
  });
  writeProof(claims, statement.id, proof);
  return trig(claims);
}
function remove(store: Store, predicate: string) {
  store.removeQuads(
    [...store].filter((q) => q.subject.value === statement.id && q.predicate.value === predicate),
  );
}
function changeText(store: Store, predicate: string, value: string) {
  remove(store, predicate);
  node(store, statement.id).setText(predicate, value);
}

it.each([
  "Halt",
  "Resume",
  "SetBindingState",
  "DispatchNow",
  "RevokeMandate",
  "Forget",
] as const)("round trips %s with a non-extractable P-256 key and model-compatible claims", async (kind) => {
  const claims = { ...statement, kind };
  const doc = await issueControlStatement({ type: "control-statement", ...claims }, key, NOW);
  expect(key.privateKey.extractable).toBe(false);
  expect(await verifyControlStatement(doc, options())).toEqual({ valid: true, statement: claims });
  expect(await readControlClaims(doc, claims.id)).toEqual(claims);
  const { claims: graph } = readProof(await parseRdf(doc, "application/trig"), claims.id);
  expect(fromRdf(graph, claims.id)).toEqual({ type: "control-statement", ...claims });
});
it("round trips Halt and Resume without optional claims", async () => {
  for (const kind of ["Halt", "Resume"] as const) {
    const { target: _target, binding: _binding, bindingState: _bindingState, ...base } = statement;
    const claims = { ...base, kind };
    const doc = await issueControlStatement(claims, key, NOW);
    expect(await verifyControlStatement(doc, options())).toEqual({
      valid: true,
      statement: claims,
    });
  }
});
it("exports a standard proof verifiable independently with WebCrypto", async () => {
  const doc = await issueControlStatement(statement, key, NOW);
  await expectStandardProof(doc, statement.id);
  expect(await verifyExportedRdf(doc, statement.id, key.publicKey)).toBe(true);
});
it.each([
  ["id", statement.id, "https://pod.example/agent/control/2"],
  ["kind", `${AGENT}SetBindingState`, `${AGENT}Halt`],
  ["attributedTo", statement.attributedTo, "https://other.example/#me"],
  ["createdAt", statement.createdAt, "2026-10-25T12:00:00.000Z"],
  ["expires", statement.expires, "2026-10-28T12:00:00Z"],
  ["target", statement.target as string, "https://pod.example/agent/proposals/2"],
  ["binding", "gmail", "direct"],
  ["bindingState", "disabled", "connected"],
])("rejects tampered %s as signature", async (field, original, changed) => {
  const signed = await issueControlStatement(statement, key, NOW);
  const doc =
    field === "id" ? signed.replaceAll(original, changed) : signed.replace(original, changed);
  expect(
    await verifyControlStatement(doc, {
      ...options(),
      id: field === "id" ? changed : statement.id,
    }),
  ).toEqual({ valid: false, reason: "signature" });
});
it("requires both authoritative key control and exact owner attribution", async () => {
  const doc = await issueControlStatement(statement, key, NOW);
  expect(
    await verifyControlStatement(doc, { ...options(), ownerWebId: "https://other.example/#me" }),
  ).toEqual({ valid: false, reason: "key" });
  expect(
    await verifyControlStatement(
      await issueControlStatement(
        { ...statement, attributedTo: "https://other.example/#me" },
        key,
        NOW,
      ),
      options(),
    ),
  ).toEqual({ valid: false, reason: "attribution" });
  const wrong = await approvalKey();
  const ed = await edKey();
  const p384 = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, false, [
    "sign",
    "verify",
  ]);
  for (const [publicKey, reason] of [
    [undefined, "key"],
    [ed.publicKey, "key"],
    [p384.publicKey, "key"],
    [wrong.publicKey, "signature"],
  ] as const)
    expect(
      await verifyControlStatement(doc, {
        ...options(),
        webIdKeyResolver: { isControlledBy: async () => true, resolveKey: async () => publicKey },
      }),
    ).toEqual({ valid: false, reason });
});
it("rejects signing with Ed25519 or another ECDSA curve", async () => {
  const p384 = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, false, [
    "sign",
    "verify",
  ]);
  for (const bad of [await edKey(), { ...p384, verificationMethod: key.verificationMethod }])
    await expect(issueControlStatement(statement, bad, NOW)).rejects.toThrow("P-256");
});
it("checks proof suite, type and purpose before consulting keys", async () => {
  const doc = await issueControlStatement(statement, key, NOW);
  for (const [original, changed] of [
    ["ecdsa-rdfc-2019", "eddsa-rdfc-2022"],
    ["security#DataIntegrityProof", "security#OtherProof"],
    ["security#assertionMethod", "security#authentication"],
  ])
    expect(
      await verifyControlStatement(doc.replace(original as string, changed as string), {
        ...options(),
        webIdKeyResolver: {
          isControlledBy: async () => {
            throw Error("must not resolve");
          },
          resolveKey: async () => {
            throw Error("must not resolve");
          },
        },
      }),
    ).toEqual({ valid: false, reason: "proof-type" });
});
it.each(PROOF_GRAPH_CHANGES)("rejects malformed control proof graph: %s", async (change) => {
  expect(
    (
      await verifyControlStatement(
        await alterProofGraph(
          await issueControlStatement(statement, key, NOW),
          statement.id,
          change,
        ),
        options(),
      )
    ).valid,
  ).toBe(false);
});
it.each([
  "named",
  "datatype",
  "cryptosuite-datatype",
  "extra",
] as const)("rejects altered control proof options: %s", async (change) => {
  expect(
    await verifyControlStatement(
      await alterProofOptions(
        await issueControlStatement(statement, key, NOW),
        statement.id,
        change,
      ),
      options(),
    ),
  ).toEqual({ valid: false, reason: "signature" });
});
it("rejects expiry at the boundary and invalid verification clocks", async () => {
  const doc = await issueControlStatement(statement, key, NOW);
  for (const now of [
    () => new Date(statement.expires),
    () => new Date("2099-01-01"),
    () => new Date("invalid"),
  ])
    expect(await verifyControlStatement(doc, { ...options(), now })).toEqual({
      valid: false,
      reason: "expired",
    });
});
it.each(INVALID_INSTANTS)("rejects signed invalid/lossy expiry %s", async (expires) => {
  const doc = await issueControlStatement({ ...statement, expires }, key, NOW);
  expect(await verifyControlStatement(doc, options())).toEqual({ valid: false, reason: "expired" });
});
it.each(MILLISECOND_FRACTIONS)("preserves lossless expiry fraction %s", async (fraction) => {
  const claims = { ...statement, expires: `2026-10-27T12:00:00.${fraction}Z` };
  const doc = await issueControlStatement(claims, key, NOW);
  expect(await verifyControlStatement(doc, options())).toEqual({ valid: true, statement: claims });
});
it.each([
  (s: Store) => {
    remove(s, RDF_TYPE);
    node(s, statement.id).setIri(RDF_TYPE, agent("Approval"));
  },
  (s: Store) => {
    remove(s, agent("controlKind"));
    node(s, statement.id).setIri(agent("controlKind"), "https://other.example/Halt");
  },
  (s: Store) => {
    remove(s, agent("controlKind"));
    node(s, statement.id).setIri(agent("controlKind"), agent("Approval"));
  },
  (s: Store) => changeText(s, `${DCT}created`, "invalid"),
  (s: Store) => changeText(s, agent("binding"), ""),
  (s: Store) => changeText(s, agent("binding"), "x".repeat(16385)),
  (s: Store) => changeText(s, agent("bindingState"), "unknown"),
  (s: Store) => remove(s, agent("binding")),
  (s: Store) => remove(s, agent("bindingState")),
  (s: Store) => {
    remove(s, agent("controlKind"));
    node(s, statement.id).setIri(agent("controlKind"), agent("DispatchNow"));
    remove(s, agent("target"));
  },
  (s: Store) => node(s, statement.id).setText(agent("binding"), "duplicate"),
  (s: Store) => {
    remove(s, `${PROV}wasAttributedTo`);
    node(s, statement.id).setText(`${PROV}wasAttributedTo`, OWNER);
  },
])("rejects structurally malformed signed control claims %#", async (change) => {
  const doc = await signedChange(change);
  expect(await verifyControlStatement(doc, options())).toEqual({
    valid: false,
    reason: "malformed",
  });
  expect(await readControlClaims(doc, statement.id)).toBeUndefined();
});
it("returns malformed for garbage, missing subject and resolver errors", async () => {
  expect(await verifyControlStatement("garbage", options())).toEqual({
    valid: false,
    reason: "malformed",
  });
  expect(await readControlClaims("garbage", statement.id)).toBeUndefined();
  const doc = await issueControlStatement(statement, key, NOW);
  expect(await verifyControlStatement(doc, { ...options(), id: "urn:missing" })).toEqual({
    valid: false,
    reason: "malformed",
  });
  expect(
    await verifyControlStatement(doc, {
      ...options(),
      webIdKeyResolver: {
        isControlledBy: async () => {
          throw Error("offline");
        },
        resolveKey: async () => undefined,
      },
    }),
  ).toEqual({ valid: false, reason: "malformed" });
});
it("reads altered and expired unsigned claims for display without granting authority", async () => {
  const doc = await issueControlStatement(statement, key, NOW);
  const changed = doc.replace(statement.expires, "2025-01-01T00:00:00Z");
  expect(await readControlClaims(changed, statement.id)).toEqual({
    ...statement,
    expires: "2025-01-01T00:00:00Z",
  });
  expect(await verifyControlStatement(changed, options())).toEqual({
    valid: false,
    reason: "signature",
  });
});
