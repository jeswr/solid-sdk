// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { buildIndexLog } from "../src/standins/trusted-index.js";
import { checkIndexReceipt } from "../src/suites/trust-index.js";
import { decodeCompactPayload } from "../src/wire/inspect.js";

it("refuses missing, forged, stale, uncovered, substituted and inconsistent log evidence", async () => {
  const key = await testKey("trust-index/log"),
    source = "urn:index",
    at = "2026-11-13T09:00:00.000Z";
  const input = {
    key,
    source,
    records: ["source-signed record A", "source-signed record B"],
    sources: ["urn:lender-a", "urn:lender-b"],
    register: "urn:register",
    at,
  };
  const log = await buildIndexLog(input);
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:sam",
    keys: [
      { kid: key.kid, alg: key.alg, publicJwk: key.publicJwk, role: "issuer", subject: source },
    ],
    sourceAuthority: [
      {
        id: "urn:index-policy",
        version: "1",
        source,
        claimTypes: ["index.transparency"],
        subjects: [source],
      },
    ],
  });
  const record = { role: "credential" as const, format: "jws-compact", value: input.records[0]! };
  const receipts = [...log.receipts.values()];
  const verify = (items = receipts, policy = log.policy, time = at) =>
    checkIndexReceipt(record, items, policy, trust, time, "urn:sam-agent", () => {});
  expect(await verify()).toBe(true);
  expect(await verify([])).toBe(false);
  expect(await verify(receipts, { ...log.policy, source: "urn:unaccepted-index" })).toBe(false);
  expect(await verify(receipts, { ...log.policy, register: "urn:other-register" })).toBe(false);
  expect(await verify(receipts, { ...log.policy, sources: ["urn:other-lender"] })).toBe(false);
  expect(await verify(receipts, log.policy, "2026-11-15T09:00:00.000Z")).toBe(false);
  expect(await verify(receipts, log.policy, "2026-11-12T09:00:00.000Z")).toBe(false);
  expect(
    await verify([{ ...receipts[0]!, value: receipts[0]!.value.slice(0, -5) + "AAAAA" }]),
  ).toBe(false);
  expect(
    await checkIndexReceipt(
      { ...record, value: "substituted source bytes" },
      receipts,
      log.policy,
      trust,
      at,
      "urn:sam-agent",
      () => {},
    ),
  ).toBe(false);
  for (const field of ["consistency", "inclusion", "previousHead", "head"]) {
    const value = decodeCompactPayload(receipts[0]!.value);
    value[field] = field === "head" || field === "previousHead" ? "not-a-signed-head" : [];
    const bad = {
      ...receipts[0]!,
      value: await signStatement(key, "awp-index-receipt+jws", value),
    };
    expect(await verify([bad]), field).toBe(false);
  }
  const fork = await buildIndexLog({ ...input, fork: true });
  expect(await verify([...fork.receipts.values()])).toBe(false);
});
