// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { canonicalJson } from "@jeswr/agent-model/core/canonical";
import { CompactSign } from "jose";
import { describe, expect, it } from "vitest";
import { money } from "../src/money.js";
import {
  type ApprovalRecord,
  actionDigest,
  CONSENT_TYPE,
  type ConsentRecord,
  createDeviceKey,
  signRecord,
  verifyRecord,
} from "../src/signing.js";

const digest = actionDigest({ action: "buy", amount: 2000 });
const approval: ApprovalRecord = {
  type: "approval",
  id: "approval:1",
  actionDigest: digest,
  decision: "approve",
  issuedAt: "2026-11-13T12:00:00.000Z",
  expiresAt: "2026-11-13T12:10:00.000Z",
};
const ruleRecord: ConsentRecord = {
  type: "spending-rule",
  issuedAt: "2026-11-13T12:00:00.000Z",
  rule: {
    id: "rule:1",
    kind: "budget",
    period: "month",
    limit: money(100, "USD"),
    scope: { kind: "merchant", merchant: "store:stride", label: "Stride & Co" },
    createdAt: "2026-11-13T12:00:00.000Z",
  },
};

describe("device-signed consent records", () => {
  it("second review: accepts UTC precision variants and compares issue and expiry numerically", async () => {
    const key = await createDeviceKey();
    for (const [issuedAt, expiresAt] of [
      ["2026-11-13T12:00:00Z", "2026-11-13T12:00:00.100Z"],
      ["2026-11-13T12:00:00Z", "2026-11-13T12:00:00.000Z"],
    ]) {
      const record = { ...approval, issuedAt: issuedAt as string, expiresAt: expiresAt as string };
      expect(await verifyRecord(await signRecord(key, record), key.publicJwk)).toEqual(record);
    }
    const backwards = {
      ...approval,
      issuedAt: "2026-11-13T12:00:00.100Z",
      expiresAt: "2026-11-13T12:00:00Z",
    };
    expect(await verifyRecord(await signRecord(key, backwards), key.publicJwk)).toBeUndefined();
  });

  it.each([
    { ...approval, issuedAt: "2026-11-13T10:00:00+02:00", expiresAt: "2026-11-13T13:00:00+02:00" },
    { ...approval, issuedAt: "2026-11-13" },
    { ...approval, expiresAt: "2026-11-13T12:10:00+00:00" },
    { ...ruleRecord, issuedAt: "2026-11-13T12:00:00+00:00" },
    { type: "revocation", ruleId: "rule:1", issuedAt: "2026-11-13T12:00:00+00:00" } as const,
  ])("second review: requires UTC Z ISO timestamps: %j", async (record) => {
    const key = await createDeviceKey();
    expect(await verifyRecord(await signRecord(key, record), key.publicJwk)).toBeUndefined();
  });

  it("round-trips each record type under the pinned key", async () => {
    const key = await createDeviceKey();
    expect(key.privateKey.extractable).toBe(false);
    for (const record of [
      approval,
      ruleRecord,
      { type: "revocation", ruleId: "rule:1", issuedAt: "2026-11-13T12:00:00.000Z" } as const,
    ]) {
      expect(await verifyRecord(await signRecord(key, record), key.publicJwk)).toEqual(record);
    }
  });

  it("refuses another key, tampering, odd headers and non-canonical payloads", async () => {
    const key = await createDeviceKey();
    const other = await createDeviceKey();
    const jws = await signRecord(key, approval);
    expect(await verifyRecord(jws, other.publicJwk)).toBeUndefined();
    const [h, p, s] = jws.split(".");
    const forged = Buffer.from(JSON.stringify({ ...approval, decision: "deny" })).toString(
      "base64url",
    );
    expect(await verifyRecord(`${h}.${forged}.${s}`, key.publicJwk)).toBeUndefined();
    expect(await verifyRecord(`${h}.${p}`, key.publicJwk)).toBeUndefined();
    expect(await verifyRecord("x".repeat(20_000), key.publicJwk)).toBeUndefined();
    expect(await verifyRecord(42 as never, key.publicJwk)).toBeUndefined();

    const sign = (payload: string, header: Record<string, unknown>) =>
      new CompactSign(new TextEncoder().encode(payload))
        .setProtectedHeader({ alg: "ES256", ...header })
        .sign(key.privateKey);
    const good = { kid: key.kid, typ: CONSENT_TYPE };
    const body = canonicalJson(approval);
    expect(await verifyRecord(await sign(body, good), key.publicJwk)).toEqual(approval);
    expect(
      await verifyRecord(await sign(body, { ...good, typ: "JWT" }), key.publicJwk),
    ).toBeUndefined();
    expect(
      await verifyRecord(await sign(body, { ...good, kid: "x" }), key.publicJwk),
    ).toBeUndefined();
    expect(
      await verifyRecord(await sign(body, { ...good, cty: "x" }), key.publicJwk),
    ).toBeUndefined();
    expect(
      await verifyRecord(await sign(JSON.stringify(approval, null, 1), good), key.publicJwk),
    ).toBeUndefined();
  });

  it.each([
    ["unknown type", { type: "gift" }],
    ["null", null],
    ["array", []],
    ["approval with bad digest", { ...approval, actionDigest: "sha-256:zz" }],
    ["approval with bad decision", { ...approval, decision: "maybe" }],
    ["approval expiring before issue", { ...approval, expiresAt: "2026-11-13T11:00:00.000Z" }],
    ["approval with bad time", { ...approval, issuedAt: "noon" }],
    ["approval with extra key", { ...approval, extra: 1 }],
    ["approval with numeric id", { ...approval, id: 1 }],
    ["rule record with invalid rule", { ...ruleRecord, rule: { id: "x" } }],
    ["revocation with numeric id", { type: "revocation", ruleId: 1, issuedAt: approval.issuedAt }],
  ])("refuses a signed %s", async (_name, record) => {
    const key = await createDeviceKey();
    const jws = await new CompactSign(new TextEncoder().encode(canonicalJson(record)))
      .setProtectedHeader({ alg: "ES256", kid: key.kid, typ: CONSENT_TYPE })
      .sign(key.privateKey);
    expect(await verifyRecord(jws, key.publicJwk)).toBeUndefined();
  });

  it("refuses a payload that is not JSON", async () => {
    const key = await createDeviceKey();
    const jws = await new CompactSign(new TextEncoder().encode("not json"))
      .setProtectedHeader({ alg: "ES256", kid: key.kid, typ: CONSENT_TYPE })
      .sign(key.privateKey);
    expect(await verifyRecord(jws, key.publicJwk)).toBeUndefined();
  });

  it("binds approvals to the exact action", () => {
    expect(actionDigest({ amount: 2000, action: "buy" })).toBe(digest);
    expect(actionDigest({ action: "buy", amount: 2001 })).not.toBe(digest);
  });
});
