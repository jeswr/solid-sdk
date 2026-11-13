// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { canonicalNQuads } from "@jeswr/solid-vc";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import { generateSigningKey } from "../src/mechanisms/jws.js";
import { PILOT_PROFILE } from "../src/profile/vocabulary.js";
import { VC_CONTEXT } from "../src/wire/contexts.js";
import {
  ANSWERABLE_CONTEXT,
  type Authenticity,
  digest,
  type JsonLdDocument,
  readDocument,
  sign,
  toTrig,
  toTurtle,
  verify,
  writeDocument,
} from "../src/wire/index.js";

function message(): JsonLdDocument {
  return {
    "@context": ANSWERABLE_CONTEXT,
    id: "urn:awp:test:message",
    type: ["Message", "Describe"],
    profile: PILOT_PROFILE,
    configuration: "urn:awp:test:configuration",
    conversation: "urn:awp:test:conversation",
    kind: "describe",
    from: { id: "urn:awp:test:sender", actor: "urn:awp:test:sender-actor" },
    to: { id: "urn:awp:test:recipient", actor: "urn:awp:test:recipient-actor" },
    createdAt: "2026-11-13T10:00:00.000Z",
    expiresAt: "2026-11-13T11:00:00.000Z",
    body: { id: "urn:awp:test:body", want: ["configurations"] },
  };
}

const read = (document: unknown, suite?: Authenticity) =>
  readDocument(JSON.stringify(document), "application/ld+json", { suite });

describe("the offline JSON-LD wire boundary", () => {
  it("composes the standard VC context with Answerable and embeds a credential as RDF", async () => {
    const credential = {
      "@context": [VC_CONTEXT, ANSWERABLE_CONTEXT],
      id: "urn:awp:test:credential",
      type: "VerifiableCredential",
      issuer: "urn:awp:test:source",
      validFrom: "2026-11-13T10:00:00.000Z",
      credentialSubject: { id: "urn:awp:test:principal", name: "Sam" },
    };
    expect(await read(credential)).toMatchObject({ ok: true });
    expect(
      await read({
        ...message(),
        evidence: [{ role: "credential", format: "vc+ld", value: credential }],
      }),
    ).toMatchObject({ ok: true });
  });
  it("admits the original, and rejects top-level and body keys that RDF would silently drop", async () => {
    expect(await read(message())).toMatchObject({ ok: true, root: "urn:awp:test:message" });
    for (const document of [
      { ...message(), undefinedKey: true },
      { ...message(), body: { ...(message().body as object), undefinedKey: true } },
    ])
      expect(await read(document)).toEqual({
        ok: false,
        reason: "malformed",
        detail: "undefined-term",
      });
  });

  it("rejects a foreign, inline, reset, empty-list or nested foreign context before conversion", async () => {
    for (const context of ["https://attacker.example/context", { id: "@id" }, null, []])
      expect(await read({ ...message(), "@context": context })).toEqual({
        ok: false,
        reason: "malformed",
        detail: "context-not-accepted",
      });
    for (const context of ["https://attacker.example/context", { secret: "urn:secret:" }])
      expect(
        await read({ ...message(), body: { ...(message().body as object), "@context": context } }),
      ).toEqual({ ok: false, reason: "malformed", detail: "context-not-accepted" });
    expect(
      await read({
        ...message(),
        body: { ...(message().body as object), "@context": ANSWERABLE_CONTEXT },
      }),
    ).toMatchObject({ ok: true });
  });

  it("reports the shape and path, and rejects a defined property in the wrong body", async () => {
    const missing = message();
    delete missing.createdAt;
    expect(await read(missing)).toMatchObject({
      ok: false,
      reason: "malformed",
      detail: expect.stringContaining(
        "shape=https://w3id.org/jeswr/awp#MessageShape;path=https://w3id.org/jeswr/awp#createdAt",
      ),
    });
    expect(
      await read({
        ...message(),
        body: { ...(message().body as object), termsDigest: "wrong-body" },
      }),
    ).toMatchObject({
      ok: false,
      reason: "malformed",
      detail: expect.stringContaining("Shape;path="),
    });
    expect(await read({ ...message(), kind: "invoke" })).toMatchObject({
      ok: false,
      reason: "malformed",
      detail: expect.stringContaining("DescribeShape;path="),
    });
  });

  it("checks byte/depth bounds before parsing and refuses an unsupported media type", async () => {
    expect(
      await readDocument("x".repeat(DEFAULT_LIMITS.maxEnvelopeBytes + 1), "application/ld+json"),
    ).toMatchObject({ ok: false, reason: "bounds-exceeded", detail: "too-large" });
    expect(await readDocument("[".repeat(32), "application/ld+json")).toMatchObject({
      ok: false,
      reason: "bounds-exceeded",
      detail: "too-deep",
    });
    expect(await readDocument("{}", "application/json")).toMatchObject({
      ok: false,
      reason: "malformed",
      detail: "unsupported-media-type",
    });
  });

  it("writes stable JSON-LD and Turtle for the same unsigned graph", async () => {
    const admitted = await read(message());
    if (!admitted.ok) throw new Error(admitted.detail);
    const node = { id: admitted.root, dataset: admitted.dataset };
    const first = await writeDocument(node);
    expect(JSON.stringify(await writeDocument(node))).toBe(JSON.stringify(first));
    expect(first["@context"]).toBe(ANSWERABLE_CONTEXT);
    const reread = await read(first);
    expect(reread.ok).toBe(true);
    const turtle = await toTurtle(admitted.dataset);
    const parsed = await parseRdf(turtle, "text/turtle");
    expect(await canonicalNQuads([...parsed])).toBe(await canonicalNQuads([...admitted.dataset]));
  });
});

describe.each<Authenticity>(["jws", "data-integrity"])("%s authenticity", (suite) => {
  it("verifies only the exact document under an independently pinned key", async () => {
    const { key } = await generateSigningKey();
    const method = "urn:awp:test:key";
    const signed = await sign(message(), {
      suite,
      key,
      verificationMethod: method,
      created: "2026-11-13T10:00:00.000Z",
    });
    const resolve = (id: string) => (id === (suite === "jws" ? key.kid : method) ? key : undefined);
    expect(
      await verify(JSON.stringify(signed), "application/ld+json", { suite, resolve }),
    ).toMatchObject({ ok: true });
    const tampered = { ...signed, conversation: "urn:awp:test:another-conversation" };
    expect(
      await verify(JSON.stringify(tampered), "application/ld+json", { suite, resolve }),
    ).toMatchObject({ ok: false, reason: "bad-signature" });
    expect(
      await verify(JSON.stringify(signed), "application/ld+json", {
        suite,
        resolve: () => undefined,
      }),
    ).toMatchObject({ ok: false, reason: "unknown-key" });
    const foreign = { ...signed, "@context": "https://attacker.example/context" };
    const spy = vi.fn(resolve);
    expect(
      await verify(JSON.stringify(foreign), "application/ld+json", { suite, resolve: spy }),
    ).toMatchObject({ ok: false, detail: "context-not-accepted" });
    expect(spy).not.toHaveBeenCalled();
  });
});

it("uses graph digests under RDFC, with key order and whitespace irrelevant", async () => {
  const a = message();
  const b = Object.fromEntries(Object.entries(a).reverse());
  expect(await digest(a, "data-integrity")).toBe(await digest(b, "data-integrity"));
  expect(await digest(a, "data-integrity")).not.toBe(
    await digest({ ...b, conversation: "urn:awp:test:changed" }, "data-integrity"),
  );
});

it("refuses 65 blank nodes before RDFC and accepts the 64-node boundary", async () => {
  const withNodes = (count: number) => ({
    ...message(),
    "@included": Array.from({ length: count }, (_, i) => ({ id: `_:n${i}`, label: `Node ${i}` })),
  });
  expect(await read(withNodes(65), "data-integrity")).toEqual({
    ok: false,
    reason: "malformed",
    detail: "too-many-blank-nodes",
  });
  expect(await read(withNodes(64), "data-integrity")).toMatchObject({ ok: true });
  await expect(digest(withNodes(65), "data-integrity")).rejects.toThrow("too-many-blank-nodes");
});

it("preserves a standard Data Integrity proof through TriG; Turtle refuses named graphs", async () => {
  const { key } = await generateSigningKey();
  const method = "urn:awp:test:key";
  const signed = await sign(message(), {
    suite: "data-integrity",
    key,
    verificationMethod: method,
    created: "2026-11-13T10:00:00.000Z",
  });
  const admitted = await read(signed, "data-integrity");
  if (!admitted.ok) throw new Error(admitted.detail);
  await expect(toTurtle(admitted.dataset)).rejects.toThrow("named-graphs-require-trig");
  const dataset = await parseRdf(await toTrig(admitted.dataset), "application/trig");
  const rewritten = await writeDocument({ id: admitted.root, dataset });
  const reordered = Object.fromEntries(Object.entries(rewritten).reverse());
  expect(
    await verify(JSON.stringify(reordered, null, 3), "application/ld+json", {
      suite: "data-integrity",
      resolve: (id) => (id === method ? key : undefined),
    }),
  ).toMatchObject({ ok: true });
});

it("rejects a graph-equivalent JWS projection whose JSON structure changed", async () => {
  const { key } = await generateSigningKey();
  const signed = await sign(message(), {
    suite: "jws",
    key,
    verificationMethod: "urn:awp:test:key",
    created: "2026-11-13T10:00:00.000Z",
  });
  const admitted = await read(signed);
  if (!admitted.ok) throw new Error(admitted.detail);
  const dataset = await parseRdf(await toTrig(admitted.dataset), "application/trig");
  const rewritten = await writeDocument({ id: admitted.root, dataset });
  expect(await digest(rewritten, "data-integrity")).toBe(await digest(signed, "data-integrity"));
  expect(
    await verify(JSON.stringify(rewritten), "application/ld+json", {
      suite: "jws",
      resolve: (id) => (id === key.kid ? key : undefined),
    }),
  ).toMatchObject({ ok: false, reason: "bad-signature" });
  // JCS deliberately accepts formatting/key-order changes that preserve the JSON value.
  expect(
    await verify(
      JSON.stringify(Object.fromEntries(Object.entries(signed).reverse()), null, 2),
      "application/ld+json",
      { suite: "jws", resolve: (id) => (id === key.kid ? key : undefined) },
    ),
  ).toMatchObject({ ok: true });
});

it("refuses duplicate keys, including escaped spellings, before any signature lookup", async () => {
  const { key } = await generateSigningKey();
  const signed = await sign(message(), {
    suite: "jws",
    key,
    verificationMethod: "urn:test:key",
    created: "2026-11-13T10:00:00.000Z",
  });
  const bytes = JSON.stringify(signed);
  const duplicate = bytes.replace('"kind":"describe"', '"kind":"invoke","k\\u0069nd":"describe"');
  const resolve = vi.fn(() => key);
  expect(await verify(duplicate, "application/ld+json", { suite: "jws", resolve })).toEqual({
    ok: false,
    reason: "malformed",
    detail: "duplicate-key",
  });
  expect(resolve).not.toHaveBeenCalled();
});

it("refuses values JSON-LD would drop and requires decimal amounts to remain strings", async () => {
  expect(await read({ ...message(), to: null })).toEqual({
    ok: false,
    reason: "malformed",
    detail: "unrepresentable-null",
  });
  expect(await read({ ...message(), inReplyTo: "relative" })).toEqual({
    ok: false,
    reason: "malformed",
    detail: "invalid-iri",
  });
  expect(await read({ ...message(), id: `urn:${"x".repeat(513)}` })).toMatchObject({
    ok: false,
    reason: "malformed",
    detail: expect.stringContaining("path=@id"),
  });
  const offer = {
    ...message(),
    type: ["Message", "Propose"],
    kind: "propose",
    body: {
      operation: { id: "urn:test:operation", version: "1" },
      terms: { price: "450.00", priceCurrency: "USD" },
      termsDigest: "sha-256:test",
      round: 1,
    },
  };
  expect(await read(offer)).toMatchObject({ ok: true });
  expect(
    await read({ ...offer, body: { ...offer.body, terms: { price: 450, priceCurrency: "USD" } } }),
  ).toEqual({ ok: false, reason: "malformed", detail: "decimal-must-be-string" });
});

it("never falls back from an unknown suite and rejects unsupported directional literals", async () => {
  await expect(digest(message(), "unregistered" as never)).rejects.toThrow(
    "configuration-mismatch",
  );
  const directional = {
    ...message(),
    "@included": [
      {
        id: "urn:test:direction",
        label: { "@value": "same words", "@language": "en", "@direction": "rtl" },
      },
    ],
  };
  expect(await read(directional, "data-integrity")).toEqual({
    ok: false,
    reason: "malformed",
    detail: "unsupported-direction",
  });
});

it("checks JWS integrity before RDF shape conversion", async () => {
  const { key } = await generateSigningKey();
  const signed = await sign(message(), {
    suite: "jws",
    key,
    verificationMethod: "urn:test:key",
    created: "2026-11-13T10:00:00.000Z",
  });
  const malformed = { ...signed, body: { ...(signed.body as object), want: 123 } };
  expect(
    await verify(JSON.stringify(malformed), "application/ld+json", {
      suite: "jws",
      resolve: () => key,
    }),
  ).toMatchObject({ ok: false, reason: "bad-signature" });
  expect(await read(malformed)).toMatchObject({
    ok: false,
    reason: "malformed",
    detail: expect.stringContaining("Shape;path="),
  });
});
