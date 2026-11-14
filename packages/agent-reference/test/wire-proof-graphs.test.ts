// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers

import { RequiredAs, TermFrom } from "@rdfjs/wrapper";
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { EmbeddedCredentialNode, EvidenceItemNode } from "../src/model/evidence-item.js";
import { testKey } from "../src/reference/keys.js";
import { digest, sign, verify } from "../src/wire/authenticity.js";
import { readDocument, writeDocument } from "../src/wire/document.js";
import { signCompact } from "../src/wire/jws-compact.js";

const folder = new URL("./fixtures/whole-messages/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", folder), "utf8"));
const fixture = manifest.fixtures.find(
  (item: { suite: string }) => item.suite === "data-integrity",
);
const document = JSON.parse(readFileSync(new URL(fixture.file, folder), "utf8"));
const resolve = (id: string) => (id === fixture.verificationMethod ? fixture.key : undefined);
describe("the outer Data Integrity proof graph", () => {
  it.each([
    ["missing type", { type: undefined }],
    ["wrong proof type", { type: "JwsProof" }],
    ["missing creation time", { created: undefined }],
    ["invalid creation time", { created: "not-a-time" }],
    ["missing verification method", { verificationMethod: undefined }],
    ["wrong verification method term type", { verificationMethod: { "@value": "urn:test:key" } }],
    ["missing suite", { cryptosuite: undefined }],
    ["wrong suite", { cryptosuite: "ecdsa-rdfc-2019" }],
    ["multiple suites", { cryptosuite: ["eddsa-rdfc-2022", "ecdsa-rdfc-2019"] }],
    ["wrong purpose", { proofPurpose: "authentication" }],
    ["extra proof option", { domain: "unrequested-domain" }],
    [
      "wrong literal datatype",
      { proofValue: { "@value": "ztest", "@type": "http://www.w3.org/2001/XMLSchema#string" } },
    ],
  ])("refuses %s", async (_name, change) => {
    const altered = { ...document, proof: { ...document.proof, ...change } };
    expect(
      await verify(JSON.stringify(altered), "application/ld+json", {
        suite: "data-integrity",
        resolve,
      }),
    ).toMatchObject({ ok: false, reason: "malformed" });
  });
  it("keeps embedded proofs in the digest and extracts only the outer proof after writing RDF", async () => {
    const read = await readDocument(JSON.stringify(document), "application/ld+json");
    if (!read.ok) throw new Error(read.detail);
    const rewritten = await writeDocument({ id: read.root, dataset: read.dataset });
    expect(await digest(rewritten, "data-integrity")).toBe(
      await digest(document, "data-integrity"),
    );
    expect(
      await verify(JSON.stringify(rewritten), "application/ld+json", {
        suite: "data-integrity",
        resolve,
      }),
    ).toMatchObject({ ok: true });
    const changed = structuredClone(rewritten);
    const proof = (changed["@included"] as Record<string, unknown>[]).find(
      (item) => item.type === "CompactJwsProof",
    );
    // Named proof graphs contain their own explicitly typed proof node.
    const graph = (changed["@included"] as Record<string, unknown>[]).find((item) =>
      Array.isArray(item["@graph"]),
    );
    const nested =
      proof ??
      (graph?.["@graph"] as Record<string, unknown>[] | undefined)?.find(
        (item) => item.type === "CompactJwsProof",
      );
    expect(nested).toBeDefined();
    if (!nested) throw new Error("Missing embedded proof graph");
    nested.jws = String(nested.jws) + "x";
    expect(await digest(changed, "data-integrity")).not.toBe(
      await digest(document, "data-integrity"),
    );
    expect(
      await verify(JSON.stringify(changed), "application/ld+json", {
        suite: "data-integrity",
        resolve,
      }),
    ).toMatchObject({ ok: false, reason: "bad-signature" });
  });
  it("refuses an outer proof graph shared with another proof owner", async () => {
    const read = await readDocument(JSON.stringify(document), "application/ld+json");
    if (!read.ok) throw new Error(read.detail);
    const rewritten = await writeDocument({ id: read.root, dataset: read.dataset });
    expect(rewritten.proofGraph).toBeDefined();
    (rewritten["@included"] as Record<string, unknown>[]).push({
      id: "urn:test:second-proof-owner",
      proofGraph: rewritten.proofGraph,
    });
    expect(
      await verify(JSON.stringify(rewritten), "application/ld+json", {
        suite: "data-integrity",
        resolve,
      }),
    ).toMatchObject({ ok: false, reason: "malformed", detail: "malformed-proof" });
    await expect(digest(rewritten, "data-integrity")).rejects.toThrow("malformed-proof");
  });
  it("refuses verification-method IRIs that JSON-LD would drop", async () => {
    const key = await testKey("brief22c/malformed-method");
    await expect(
      sign(document, {
        suite: "data-integrity",
        key,
        verificationMethod: "https://example.test/#key#second-fragment",
        created: "2026-11-13T09:00:00Z",
      }),
    ).rejects.toThrow("malformed-proof-options");
  });
});
it("models selective/chain envelopes as presentations without inventing an envelope signature", async () => {
  const key = await testKey("brief22c/presentation");
  const jws = await signCompact(key, "awp-statement+jws", {
    issuer: "urn:test:issuer",
    subject: "urn:test:subject",
    claimType: "income",
    value: 1,
  });
  for (const [format, value] of [
    ["selective-disclosure+jws", JSON.stringify({ credential: jws, disclosures: [] })],
    ["mandate-chain+jws", JSON.stringify([[jws]])],
  ]) {
    const item = { role: "credential" as const, format: format!, value: value! };
    const node = EvidenceItemNode.toNode(item);
    expect(node.toObject()).toStrictEqual(item);
    expect(
      node.credential?.types.has("https://www.w3.org/2018/credentials#VerifiablePresentation"),
    ).toBe(true);
    expect(
      await node.credential?.verifyOriginal({ typ: "awp-statement+jws", resolve: () => key }),
    ).toBe(false);
    expect(node.credential?.credentials).toHaveLength(1);
    expect(
      await node.credential?.credentials[0]?.verifyOriginal({
        typ: "awp-statement+jws",
        resolve: () => key,
      }),
    ).toBe(true);
    expect(
      await readDocument(JSON.stringify(await writeDocument(node)), "application/ld+json"),
    ).toMatchObject({ ok: true });
  }
  expect(() =>
    EvidenceItemNode.toNode({ role: "credential", format: "unknown-envelope", value: "{}" }),
  ).toThrow("Unsupported");
});

it("refuses substituting a valid but unrelated signed part into a retained presentation", async () => {
  const key = await testKey("22d/presentation-parts");
  const statement = (value: number) =>
    signCompact(key, "awp-statement+jws", {
      issuer: "urn:test:issuer",
      claimType: "count",
      value,
    });
  const original = await statement(1);
  const node = EvidenceItemNode.toNode({
    role: "credential",
    format: "selective-disclosure+jws",
    value: JSON.stringify({ credential: original }),
  });
  const presentation = node.credential!;
  expect(presentation.projectionMatches(node.format)).toBe(true);
  const replacement = EmbeddedCredentialNode.fromJws(
    await statement(2),
    "urn:test:replacement",
    node.dataset,
  );
  RequiredAs.object(
    presentation,
    "https://www.w3.org/2018/credentials#verifiableCredential",
    replacement,
    TermFrom.instance,
  );
  expect(await replacement.verifyOriginal({ typ: "awp-statement+jws", resolve: () => key })).toBe(
    true,
  );
  expect(presentation.originalJws).toBe(node.statement);
  expect(presentation.projectionMatches(node.format)).toBe(false);
});
