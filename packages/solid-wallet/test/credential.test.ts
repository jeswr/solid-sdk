// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6

import {
  credentialToJsonLd,
  generateKeyPairForSuite,
  issue,
  type KeyPair,
  type VerifiableCredential,
  type VerificationErrorCode,
} from "@jeswr/solid-vc";
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkCredential,
  MAX_CREDENTIAL_BYTES,
  parseCredential,
  summariseCredential,
  verificationDisplay,
} from "../src/index.js";

let key: KeyPair, vc: VerifiableCredential, source: string;
const now = new Date("2026-11-11T12:00:00Z");
beforeAll(async () => {
  key = await generateKeyPairForSuite("https://academy.example/profile#issuer#key", "Ed25519");
  vc = await issue({
    credential: {
      issuer: "https://academy.example/profile#issuer",
      validFrom: "2026-11-10T00:00:00Z",
      validUntil: "2027-11-11T00:00:00Z",
      type: ["https://schema.org/EducationalOccupationalCredential"],
      credentialSubject: {
        id: "https://holder.example/#me",
        "https://schema.org/name": "Rowan Meadow",
        "https://schema.org/description": "Fictional course",
      },
    },
    key,
    options: { created: now },
  });
  source = JSON.stringify({ ...credentialToJsonLd(vc), proof: vc.proof }, null, 2);
});
it("summarises empty, malformed and legacy input without any trust judgement", () => {
  expect(summariseCredential(null)).toMatchObject({
    issuer: "Unknown issuer",
    types: [],
    fields: [],
  });
  expect(
    summariseCredential({
      type: "Course",
      issuer: { name: "An asserted name" },
      issuanceDate: "2026-01-01",
      expirationDate: "2027-01-01",
      credentialSubject: [
        { name: "Rowan", score: 10, passed: true, details: { a: 1 } },
        { id: "second" },
      ],
      credentialStatus: { type: "Unknown" },
    }),
  ).toMatchObject({
    types: ["Course"],
    issuer: "An asserted name",
    validFrom: "2026-01-01",
    validUntil: "2027-01-01",
    holderName: "Rowan",
    fields: expect.arrayContaining([{ subject: 1, name: "score", value: "10" }]),
    status: { type: "Unknown" },
  });
  expect(
    summariseCredential({
      issuer: { id: "did:example:issuer" },
      type: ["A", 3],
      credentialSubject: { "https://schema.org/name": "Rowan", missing: undefined },
    }),
  ).toMatchObject({ issuer: "did:example:issuer", types: ["A"], holderName: "Rowan" });
});
describe("credential admission and verification", () => {
  it("preserves a real signed credential, verifies it, and detects a tampered claim", async () => {
    expect((await parseCredential(source)).issuer).toBe(vc.issuer);
    const opts = {
      resolveKey: () => key.publicKey,
      now,
      resolveStatus: () => ({ status: "absent" as const }),
    };
    expect(await checkCredential(source, opts)).toMatchObject({ state: "verified" });
    const changed = source.replace("Fictional course", "Altered course");
    expect(await checkCredential(changed, opts)).toMatchObject({
      state: "invalid",
      title: "Signature invalid / not from this issuer",
    });
    expect(await checkCredential(source, { ...opts, now: new Date("2028-01-01") })).toMatchObject({
      state: "expired",
    });
    expect(
      await checkCredential(source, {
        ...opts,
        resolveStatus: () => ({ status: "revoked", reason: "Revoked in test" }),
      }),
    ).toMatchObject({ state: "revoked" });
  });
  it("refuses malformed, oversized, unsigned and ambiguous input", async () => {
    for (const value of [
      "{",
      "[]",
      "{}",
      JSON.stringify({ issuer: vc.issuer }),
      " ".repeat(MAX_CREDENTIAL_BYTES + 1),
    ])
      await expect(parseCredential(value)).rejects.toThrow();
    const unsigned = JSON.stringify(credentialToJsonLd(vc));
    await expect(parseCredential(unsigned)).rejects.toThrow(/proof/);
    const noId: Record<string, unknown> = { ...credentialToJsonLd(vc), proof: vc.proof };
    delete noId.id;
    await expect(parseCredential(JSON.stringify(noId))).rejects.toThrow();
    expect(await checkCredential("{", { resolveKey: () => undefined })).toMatchObject({
      state: "unknown",
      title: "Could not check",
    });
  });
  it("refuses a changed context or extra top-level claim that the verification API would lose", async () => {
    const extra = { ...JSON.parse(source), "https://schema.org/description": "extra" };
    await expect(parseCredential(JSON.stringify(extra))).rejects.toThrow(/losing information/);
    const doc = JSON.parse(source);
    doc["@context"] = {
      ...doc["@context"],
      "https://schema.org/name": "https://example.org/altered",
    };
    await expect(parseCredential(JSON.stringify(doc))).rejects.toThrow();
  });
});
const displays = {
  MALFORMED: ["invalid", "Signature invalid / not from this issuer"],
  NO_PROOF: ["invalid", "Signature invalid / not from this issuer"],
  UNKNOWN_CRYPTOSUITE: ["invalid", "Signature invalid / not from this issuer"],
  INVALID_SIGNATURE: ["invalid", "Signature invalid / not from this issuer"],
  ISSUER_MISMATCH: ["invalid", "Signature invalid / not from this issuer"],
  EXPIRED: ["expired", "Expired"],
  NOT_YET_VALID: ["not-yet-valid", "Not yet valid"],
  STATUS_REVOKED: ["revoked", "Revoked"],
  STATUS_SUSPENDED: ["suspended", "Suspended"],
  STATUS_UNREACHABLE: ["unknown", "Could not check"],
  PROOF_PURPOSE_MISMATCH: ["unknown", "Could not check"],
  UNTRUSTED_ISSUER: ["unknown", "Could not check"],
  RELATED_RESOURCE_MISSING: ["unknown", "Could not check"],
  RELATED_RESOURCE_MISMATCH: ["unknown", "Could not check"],
} satisfies Record<VerificationErrorCode, readonly [string, string]>;
it.each(Object.entries(displays))("explains %s", (code, [state, title]) => {
  expect(
    verificationDisplay(
      { verified: false, errors: [{ code: code as VerificationErrorCode, message: "Why" }] },
      "issuer",
    ),
  ).toEqual({ state, title, reason: "Why" });
});
it.each([
  "INVALID_SIGNATURE",
  "ISSUER_MISMATCH",
  "MALFORMED",
  "NO_PROOF",
  "UNKNOWN_CRYPTOSUITE",
] as const)("prioritises %s over untrusted dates and status", (code) => {
  const errors = ["STATUS_REVOKED", "STATUS_SUSPENDED", "EXPIRED", "NOT_YET_VALID", code].map(
    (code) => ({ code: code as VerificationErrorCode, message: code }),
  );
  expect(verificationDisplay({ verified: false, errors }, "issuer").state).toBe("invalid");
});
it("labels an expired forgery as invalid", async () => {
  expect(
    await checkCredential(source.replace("Fictional course", "Forged course"), {
      resolveKey: () => key.publicKey,
      now: new Date("2028-01-01"),
    }),
  ).toMatchObject({ state: "invalid" });
});
it("supplies a reason for an empty error result", () =>
  expect(verificationDisplay({ verified: false, errors: [] }, "issuer").reason).not.toBe(""));

it("explains non-Error failures from a credential parser", async () => {
  const { vi } = await import("vitest");
  const parsing = vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
    throw "Parser unavailable";
  });
  try {
    expect(await checkCredential(source, { resolveKey: () => undefined })).toMatchObject({
      state: "unknown",
      reason: "Credential could not be read",
    });
  } finally {
    parsing.mockRestore();
  }
});

it("distinguishes an unavailable key from a cryptographically invalid signature", async () => {
  const unavailable = await checkCredential(source, { resolveKey: () => undefined, now });
  expect(unavailable).toMatchObject({
    state: "unknown",
    title: "Could not check",
    reason: expect.stringContaining("public key"),
  });
  expect(
    await checkCredential(source, {
      resolveKey: () => {
        throw new Error("offline");
      },
      now,
    }),
  ).toMatchObject({ state: "unknown" });
});

it("preserves UTF-8 BOM bytes through import while rejecting invalid or oversized byte input", async () => {
  const { credentialFileText } = await import("../src/index.js");
  const original = `\uFEFF${source}\n`;
  const decoded = credentialFileText(new TextEncoder().encode(original).buffer);
  expect(decoded).toBe(original);
  expect(await parseCredential(decoded)).toMatchObject({ issuer: vc.issuer });
  expect(() => credentialFileText(new Uint8Array([255]).buffer)).toThrow();
  expect(() => credentialFileText(new ArrayBuffer(MAX_CREDENTIAL_BYTES + 1))).toThrow(/256 KiB/);
});
