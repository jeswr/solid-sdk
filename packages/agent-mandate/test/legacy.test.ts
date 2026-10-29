// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

// biome-ignore lint/style/useNodejsImportProtocol: the agent import guard requires bare module names
import { readFileSync } from "fs";
import { CompactSign, generateKeyPair, importJWK } from "jose";
import { beforeAll, expect, it } from "vitest";
import { createLegacyMandateVerifier } from "../src/legacy.js";
import { evaluateIntent, solidOdrlEngine } from "../src/policy.js";
import type { Intent, Policy } from "../src/types.js";
import { ACTOR, clock, INVALID_INSTANTS, intent, OWNER } from "./helpers.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/legacy.json", import.meta.url), "utf8"),
);
const base = () => ({
  read: async () => fixture.jws as string,
  ownerWebId: OWNER,
  agentWebId: ACTOR,
  resolvePinned: async () => ({ publicKey, subject: OWNER, alg: "EdDSA" as const }),
  isRevoked: async () => false,
  now: clock,
});
let publicKey: CryptoKey;
let signing: CryptoKey;
beforeAll(async () => {
  publicKey = (await importJWK(fixture.publicJwk, "EdDSA")) as CryptoKey;
  signing = (await generateKeyPair("EdDSA")).privateKey;
});
it("imports a pilot-format signed fixture and reproduces the pilot's per-policy cases", async () => {
  const m = await createLegacyMandateVerifier(base()).load();
  expect(m?.id).toBe(fixture.payload.id);
  const q: Intent = intent({
    action: "use",
    target: "https://w3id.org/jeswr/awp#op/schedule-meeting",
    attributes: {
      purpose: "https://w3id.org/dpv#CommunicationManagement",
      recipient: "https://peer.example/#me",
    },
  });
  expect(await solidOdrlEngine.evaluate(m?.autonomous as Policy, q)).toEqual({ effect: "permit" });
  expect((await evaluateIntent(m, q)).decision).toBe("permit");
  expect(
    (
      await evaluateIntent(m, {
        ...q,
        attributes: {
          purpose: "https://w3id.org/dpv#CommunicationManagement",
          recipient: "https://other.example/#me",
        },
      })
    ).decision,
  ).toBe("confirm-required");
  expect(
    await solidOdrlEngine.evaluate(m?.autonomous as Policy, {
      ...q,
      attributes: { recipient: "https://peer.example/#me" },
    }),
  ).toEqual({ effect: "indeterminate" });
  expect(
    (
      await evaluateIntent(m, {
        ...q,
        action: "compensate",
        target: "https://w3id.org/jeswr/awp#op/payment",
      })
    ).decision,
  ).toBe("prohibited");
});
async function signed(
  payload: unknown,
  header: Record<string, unknown> = { alg: "EdDSA", kid: "test-key", typ: "awp-mandate+jws" },
): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader(header as { alg: string })
    .sign(signing);
}
async function loadSigned(payload: unknown, now = clock) {
  const pair = await generateKeyPair("EdDSA");
  const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "EdDSA", kid: "test-key", typ: "awp-mandate+jws" })
    .sign(pair.privateKey);
  return createLegacyMandateVerifier({
    ...base(),
    now,
    read: async () => jws,
    resolvePinned: async () => ({
      publicKey: pair.publicKey as CryptoKey,
      subject: OWNER,
      alg: "EdDSA",
    }),
  }).load();
}
it.each([
  "validFrom",
  "validUntil",
] as const)("rejects signed legacy calendar instants and timezone bounds in %s", async (field) => {
  for (const value of INVALID_INSTANTS)
    expect(
      await loadSigned(
        {
          ...fixture.payload,
          validFrom: "2025-01-01T00:00:00Z",
          validUntil: "2027-01-01T00:00:00Z",
          [field]: value,
        },
        () => new Date(field === "validFrom" ? "2026-12-01T00:00:00Z" : "2026-01-01T00:00:00Z"),
      ),
      value,
    ).toBeUndefined();
});
it("fails closed for absent, malformed, unverifiable and revoked legacy mandates", async () => {
  for (const read of [
    async () => undefined,
    async () => "x".repeat(256 * 1024 + 1),
    async () => "bad",
    async () => {
      throw new Error("offline");
    },
    async () => `${fixture.jws.slice(0, -10)}AAAAAAAAAA`,
  ])
    expect(await createLegacyMandateVerifier({ ...base(), read }).load()).toBeUndefined();
  for (const change of [
    { resolvePinned: async () => undefined },
    { resolvePinned: async () => ({ publicKey, subject: "urn:other", alg: "EdDSA" as const }) },
    { resolvePinned: async () => ({ publicKey, subject: OWNER, alg: "ES256" as const }) },
    { isRevoked: async () => true },
    {
      isRevoked: async () => {
        throw new Error("unreadable");
      },
    },
  ])
    expect(await createLegacyMandateVerifier({ ...base(), ...change }).load()).toBeUndefined();
});
it("requires an explicit false revocation result", async () => {
  for (const result of [undefined, null, 0, "", "false", {}, [], Number.NaN, true])
    expect(
      await createLegacyMandateVerifier({
        ...base(),
        isRevoked: async () => result as boolean,
      }).load(),
    ).toBeUndefined();
  expect(
    await createLegacyMandateVerifier({ ...base(), isRevoked: async () => false }).load(),
  ).toMatchObject({ id: fixture.payload.id });
});
it("rejects document-supplied keys, unexpected headers and algorithms", async () => {
  for (const header of [
    { alg: "EdDSA", kid: "test", typ: "awp-mandate+jws", jwk: fixture.publicJwk },
    { alg: "EdDSA", kid: "test", typ: "wrong" },
    { alg: "EdDSA", typ: "awp-mandate+jws" },
    { alg: "HS256", kid: "test", typ: "awp-mandate+jws" },
  ]) {
    const rawHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const jws = `${rawHeader}.${fixture.jws.split(".")[1]}.${fixture.jws.split(".")[2]}`;
    expect(
      await createLegacyMandateVerifier({ ...base(), read: async () => jws }).load(),
    ).toBeUndefined();
  }
  expect(
    await createLegacyMandateVerifier({
      ...base(),
      read: async () => await signed(fixture.payload),
    }).load(),
  ).toBeUndefined();
});
it("rejects malformed legacy claims and unsupported pilot policy terms", async () => {
  for (const patch of [
    { type: "Other" },
    { version: 1.5 },
    { version: 0 },
    { id: null },
    { issuer: "urn:other" },
    { subject: "urn:other" },
    { validFrom: "2099-01-01" },
    { validUntil: "2000-01-01" },
    { autonomous: null },
    { withApproval: { id: 42 } },
    { autonomous: { ...fixture.payload.autonomous, conflict: "perm" } },
    { autonomous: { ...fixture.payload.autonomous, obligations: [{ action: "inform" }] } },
  ])
    expect(await loadSigned({ ...fixture.payload, ...patch })).toBeUndefined();
  for (const rule of [
    { type: "permission", action: "write", target: "urn:target" },
    { type: "obligation", action: "read" },
    { type: "permission", action: "read" },
    { type: "permission", action: "read", target: "urn:target", duties: [{ action: "inform" }] },
    {
      type: "permission",
      action: "read",
      target: "urn:target",
      constraints: [{ leftOperand: "count", operator: "eq", rightOperand: 1 }],
    },
    {
      type: "permission",
      action: "read",
      target: "urn:target",
      constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: [false] }],
    },
  ])
    expect(
      await loadSigned({
        ...fixture.payload,
        autonomous: { id: "urn:policy", permissions: [rule] },
      }),
    ).toBeUndefined();
  expect(
    await loadSigned({
      ...fixture.payload,
      autonomous: {
        id: "urn:policy",
        prohibitions: [
          {
            type: "prohibition",
            action: "read",
            constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: 1 }],
          },
        ],
      },
      withApproval: { id: "urn:empty" },
    }),
  ).toMatchObject({ id: fixture.payload.id });
});
it("rejects malformed IRIs, non-instants and terms outside the pilot subset", async () => {
  for (const patch of [
    { id: "relative" },
    { id: `urn:${"a".repeat(600)}` },
    { id: "urn:one#two#three" },
    { validFrom: "2026-10-26" },
    { validFrom: 1 },
    { validFrom: "x".repeat(65) },
    { validUntil: "2026-99-99T00:00:00Z" },
  ])
    expect(await loadSigned({ ...fixture.payload, ...patch })).toBeUndefined();
  for (const rule of [
    { type: "permission", action: "read", id: "relative", target: "urn:target" },
    { type: "permission", action: "read", target: "relative" },
    {
      type: "permission",
      action: "read",
      target: "urn:target",
      constraints: [{ leftOperand: "purpose", operator: "isAllOf", rightOperand: ["urn:purpose"] }],
    },
  ])
    expect(
      await loadSigned({
        ...fixture.payload,
        autonomous: { id: "urn:policy", permissions: [rule] },
      }),
    ).toBeUndefined();
});
it.each([
  "autonomous",
  "withApproval",
] as const)("rejects signed unsupported fields throughout %s policies", async (set) => {
  for (const field of ["delegatedUnder", "inheritFrom", "unknownRestriction"]) {
    expect(
      await loadSigned({
        ...fixture.payload,
        [set]: { ...fixture.payload[set], [field]: "urn:restricted" },
      }),
    ).toBeUndefined();
  }
  for (const collection of ["permissions", "prohibitions"] as const) {
    const rule = {
      type: collection === "permissions" ? "permission" : "prohibition",
      action: "read",
      target: "urn:target",
    };
    for (const field of ["refinement", "remedy", "consequence", "unknownRestriction"]) {
      expect(
        await loadSigned({
          ...fixture.payload,
          [set]: { id: "urn:policy", [collection]: [{ ...rule, [field]: { action: "inform" } }] },
        }),
      ).toBeUndefined();
    }
    for (const field of [
      "unit",
      "status",
      "and",
      "or",
      "rightOperandReference",
      "unknownRestriction",
    ]) {
      expect(
        await loadSigned({
          ...fixture.payload,
          [set]: {
            id: "urn:policy",
            [collection]: [
              {
                ...rule,
                constraints: [
                  {
                    leftOperand: "purpose",
                    operator: "eq",
                    rightOperand: "urn:purpose",
                    [field]: "urn:restriction",
                  },
                ],
              },
            ],
          },
        }),
      ).toBeUndefined();
    }
    expect(
      await loadSigned({
        ...fixture.payload,
        [set]: {
          id: "urn:policy",
          [collection]: [
            { ...rule, type: collection === "permissions" ? "prohibition" : "permission" },
          ],
        },
      }),
    ).toBeUndefined();
  }
});
it("rejects signed unsupported mandate fields and malformed supported metadata", async () => {
  for (const field of ["prohibitions", "limits", "unknownRestriction"])
    expect(await loadSigned({ ...fixture.payload, [field]: [] })).toBeUndefined();
  expect(await loadSigned({ ...fixture.payload, note: {} })).toBeUndefined();
  for (const patch of [{ type: "Unknown" }, { assigner: "relative" }, { assignee: "relative" }])
    expect(
      await loadSigned({
        ...fixture.payload,
        autonomous: { ...fixture.payload.autonomous, ...patch },
      }),
    ).toBeUndefined();
  for (const patch of [{ assigner: "relative" }, { assignee: "relative" }])
    expect(
      await loadSigned({
        ...fixture.payload,
        autonomous: {
          id: "urn:policy",
          permissions: [{ type: "permission", action: "read", target: "urn:target", ...patch }],
        },
      }),
    ).toBeUndefined();
  expect(
    await loadSigned({
      ...fixture.payload,
      autonomous: {
        id: "urn:policy",
        permissions: [
          {
            type: "permission",
            action: "read",
            target: "urn:target",
            constraints: [
              {
                leftOperand: "purpose",
                operator: "eq",
                rightOperand: "urn:purpose",
                datatype: "relative",
              },
            ],
          },
        ],
      },
    }),
  ).toBeUndefined();
  const { note: _note, ...withoutNote } = fixture.payload;
  expect(await loadSigned(withoutNote)).toMatchObject({ id: fixture.payload.id });
  expect(
    await loadSigned({
      ...fixture.payload,
      autonomous: {
        id: "urn:policy",
        type: "Agreement",
        assigner: OWNER,
        assignee: ACTOR,
        obligations: [],
        permissions: [
          {
            id: "urn:rule",
            type: "permission",
            action: "read",
            target: "urn:target",
            assigner: OWNER,
            assignee: ACTOR,
            duties: [],
            constraints: [
              {
                leftOperand: "purpose",
                operator: "eq",
                rightOperand: "urn:purpose",
                datatype: "http://www.w3.org/2001/XMLSchema#anyURI",
              },
            ],
          },
        ],
      },
    }),
  ).toMatchObject({ id: fixture.payload.id });
});
