// AUTHORED-BY Codex GPT-6.1-Sol
import { digestOf } from "@jeswr/agent-model/core/canonical";
import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_SCOPE,
  type LedgerEntry as AuditEntry,
  checkedRecord,
  GENESIS,
  HEAD_MISSING,
  parseAuditEntry,
  parseAuditHead,
  seal,
  verifyLatestRange,
  verifyLedger,
  verifyRange,
} from "../src/verify.js";
import { required, witnessFixture } from "./fixture.js";

const AT = "2026-10-26T12:00:00.000Z";
const RECORD = {
  type: "ingest",
  id: "urn:event:1",
  agent: "urn:agent:1",
  owner: "urn:owner:1",
} as const;
function activityFixture(size = 5000): AuditEntry[] {
  const entries: AuditEntry[] = [];
  let prev = GENESIS;
  for (let seq = 1; seq <= size; seq++) {
    const entry = seal(
      seq,
      new Date(Date.UTC(2026, 10, 1) + seq * 1000).toISOString(),
      prev,
      RECORD,
    );
    entries.push(entry);
    prev = entry.hash;
  }
  return entries;
}

describe("verifyRange", () => {
  const entries = activityFixture(5);
  it.each([
    ["modify", () => entries.map((e, i) => (i === 2 ? { ...e, at: AT } : e)), "Hash mismatch", 3],
    ["reorder", () => [entries[0], entries[2], entries[1], ...entries.slice(3)], "Sequence gap", 3],
    ["drop middle", () => entries.filter((e) => e.seq !== 3), "Sequence gap", 4],
    [
      "broken link",
      () => entries.map((e, i) => (i === 2 ? { ...e, prev: digestOf("other") } : e)),
      "Broken link",
      3,
    ],
    ["wrong genesis", () => [{ ...entries[0], prev: digestOf("other") }], "Broken link", 1],
    ["malformed", () => [{ ...entries[0], at: "yesterday" }], "Malformed record", 1],
  ] as const)("detects %s", (_, change, problem, firstBadSeq) => {
    expect(verifyRange(change() as AuditEntry[])).toEqual({
      ok: false,
      firstBadSeq,
      problem,
      scope: AUDIT_SCOPE,
    });
  });
  it("uses one validated snapshot of the head, even if the caller's object changes or throws", () => {
    const last = entries.at(-1) as AuditEntry;
    let reads = 0;
    // Valid on the first read, then claims an earlier seq and a different hash.
    const changing = {
      get seq() {
        return reads++ === 0 ? last.seq : 2;
      },
      get hash() {
        return reads > 1 ? digestOf("other") : last.hash;
      },
    };
    expect(verifyRange(entries, changing).ok).toBe(true);
    const throwing = {
      get seq(): number {
        throw new Error("hostile head");
      },
      hash: last.hash,
    };
    expect(verifyRange(entries, throwing)).toEqual({
      ok: false,
      problem: "Malformed head",
      firstBadSeq: undefined,
      scope: AUDIT_SCOPE,
    });
    expect(verifyLatestRange(entries, throwing).problem).toBe("Malformed head");
  });
  it("checks a matching head and reports a wrong head or entries past the head", () => {
    const last = entries.at(-1) as AuditEntry;
    expect(verifyRange(entries, last).ok).toBe(true);
    expect(verifyRange(entries, { ...last, hash: digestOf("wrong") })).toMatchObject({
      ok: false,
      problem: "Head mismatch",
      firstBadSeq: 5,
    });
    expect(verifyRange(entries, { ...last, seq: 4 }).ok).toBe(false);
    expect(verifyRange(entries.slice(1, 4), last, 4).ok).toBe(true);
    expect(verifyRange(entries.slice(1)).ok).toBe(true);
    expect(verifyRange([], last)).toMatchObject({
      ok: false,
      firstBadSeq: 5,
      problem: "Record 5 is missing",
    });
    expect(verifyRange(entries.slice(0, -1), last)).toMatchObject({
      ok: false,
      firstBadSeq: 5,
      problem: "Record 5 is missing",
    });
    expect(verifyRange([]).ok).toBe(true);
    expect(verifyRange([null] as unknown as AuditEntry[])).toMatchObject({
      ok: false,
      problem: "Malformed record",
    });
  });
  it.each([
    "matching",
    "different hash",
    "missing endpoint",
  ] as const)("compares the %s head against the validated snapshot of a changing Proxy", (scenario) => {
    const entry = seal(1, AT, GENESIS, RECORD);
    const head = {
      seq: scenario === "missing endpoint" ? 2 : 1,
      hash: scenario === "matching" ? entry.hash : digestOf("other head"),
    };
    const reads = { seq: 0, hash: 0 };
    const read = (key: "seq" | "hash") => {
      reads[key]++;
      if (reads[key] === 1) return entry[key];
      return scenario === "matching" ? (key === "seq" ? 2 : digestOf("changed")) : head[key];
    };
    const changing = new Proxy(entry, {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return key === "seq" || key === "hash" ? { ...descriptor, value: read(key) } : descriptor;
      },
      get(target, key) {
        return key === "seq" || key === "hash" ? read(key) : Reflect.get(target, key);
      },
    });
    expect(verifyRange([changing], head)).toMatchObject(
      scenario === "matching"
        ? { ok: true }
        : {
            ok: false,
            problem: scenario === "different hash" ? "Head mismatch" : "Record 2 is missing",
          },
    );
    expect(reads).toEqual({ seq: 1, hash: 1 });
  });
  it("never passes the latest range without a published head", () => {
    const last = entries.at(-1) as AuditEntry;
    // Deleting the newest record and chain.ttl together must not read as "Records check out".
    expect(verifyLatestRange(entries.slice(0, -1), undefined)).toMatchObject({
      ok: false,
      problem: HEAD_MISSING,
    });
    expect(verifyLatestRange(entries, last).ok).toBe(true);
    expect(verifyLatestRange(entries.slice(0, -1), last)).toMatchObject({
      ok: false,
      problem: "Record 5 is missing",
    });
    expect(verifyLatestRange(entries.slice(1, 4), last, 4).ok).toBe(true);
    expect(verifyLatestRange([], undefined).ok).toBe(true);
  });
  it("checks five thousand retained entries", () => {
    const large = activityFixture();
    expect(large).toHaveLength(5000);
    expect(verifyRange(large, large.at(-1)).ok).toBe(true);
  }, 30_000);
});

it.each([
  ["verifyLedger", verifyLedger],
  ["verifyRange", verifyRange],
] as const)("%s fails closed when a Proxy's descriptor trap throws", (_, verify) => {
  const entry = new Proxy(seal(1, AT, GENESIS, RECORD), {
    getOwnPropertyDescriptor() {
      throw new Error("hostile descriptor");
    },
  });
  expect(verify([entry])).toMatchObject({ ok: false, firstBadSeq: undefined });
});

it("keeps full-ledger checkpoint admission distinct from an explicitly scoped range", () => {
  const entries = activityFixture(3);
  expect(verifyLedger(entries.slice(1))).toMatchObject({
    ok: false,
    problem: "missing prefix without a checkpoint",
  });
  expect(verifyRange(entries.slice(1)).ok).toBe(true);
  const prior = digestOf("pruned");
  const checkpoint = seal(3, AT, prior, {
    type: "ledger-checkpoint",
    lastPrunedSeq: 2,
    lastPrunedHash: prior,
  });
  expect(verifyLedger([checkpoint])).toMatchObject({ ok: true, prunedThroughSeq: 2 });
  for (const record of [
    { ...checkpoint.record, lastPrunedSeq: 1 },
    { ...checkpoint.record, lastPrunedHash: digestOf("other") },
  ])
    expect(verifyLedger([seal(3, AT, prior, record)])).toMatchObject({ ok: false });
  expect(verifyRange([seal(3, AT, GENESIS, RECORD)])).toMatchObject({
    ok: false,
    problem: "Broken link",
  });
});

it("applies the strict schema, canonical JSON and UTF-8 size bounds to supplied entries", () => {
  const entry = seal(1, AT, GENESIS, RECORD);
  const getter = vi.fn(() => 1);
  const oversized = { ...RECORD, id: `urn:${"é".repeat(65536)}` };
  for (const value of [
    { ...entry, unsigned: true },
    { ...entry, record: { ...RECORD, body: "private" } },
    { ...entry, record: { ...RECORD, hidden: undefined } },
    { ...entry, record: oversized },
    Object.defineProperty({ ...entry }, "seq", { get: getter }),
    { ...entry, seq: "1" },
    {},
    null,
  ]) {
    expect(() => parseAuditEntry(value)).toThrow();
    expect(verifyRange([value] as AuditEntry[])).toMatchObject({
      ok: false,
      problem: "Malformed record",
    });
  }
  expect(getter).not.toHaveBeenCalled();
  expect(() => seal(1, AT, GENESIS, oversized)).toThrow("bound");
  expect(parseAuditEntry(entry)).toEqual(entry);
});

it("validates published heads and explicit range endpoints before returning a verdict", () => {
  const entries = activityFixture(2);
  const head = entries[1] as AuditEntry;
  expect(parseAuditHead("200000", head.hash)).toEqual({ seq: 200000, hash: head.hash });
  for (const seq of ["0", "01", "-1", "1.0", "200001", "9007199254740992", "x"]) {
    expect(() => parseAuditHead(seq, head.hash)).toThrow(
      "Invalid audit head: Audit range exceeds bound",
    );
    expect(verifyRange(entries, { seq: Number(seq), hash: head.hash }).ok).toBe(false);
  }
  expect(() => parseAuditHead("1", "invalid")).toThrow("Invalid audit head: Invalid hash");
  expect(verifyRange(entries, { seq: 2, hash: "invalid" })).toMatchObject({
    ok: false,
    problem: "Malformed head",
  });
  for (const through of [0, -1, NaN, Infinity, 1.5, 200001])
    expect(verifyRange(entries, head, through)).toMatchObject({
      ok: false,
      problem: "Invalid range endpoint",
    });
});

it("enforces the UTF-8 record bound even for schema-valid supplied values", () => {
  const iri = `urn:${"漢".repeat(2044)}`;
  const record = {
    ...RECORD,
    id: iri,
    agent: iri,
    owner: iri,
    conversation: iri,
    proposal: iri,
    mandate: iri,
    approval: iri,
    decisionRecord: iri,
    transmission: iri,
    receipt: iri,
    modelCall: iri,
  };
  const entry = {
    seq: 1,
    at: AT,
    prev: GENESIS,
    record,
    hash: digestOf({ seq: 1, at: AT, prev: GENESIS, record }),
  };
  expect(() => parseAuditEntry(entry)).toThrow("bound");
  expect(verifyRange([entry])).toMatchObject({ ok: false, problem: "Malformed record" });
});

const DIGEST = digestOf("checked bytes");
const gateDecision = {
  type: "gate-decision",
  id: "urn:decision:1",
  agent: RECORD.agent,
  owner: RECORD.owner,
  direction: "in",
  outcome: "refuse",
  reason: "bad-signature",
  messageDigest: DIGEST,
  configuration: "urn:configuration:signed-ed25519",
  gateSeq: 3,
  gateHash: digestOf("reference head"),
} as const;
const anchor = {
  type: "record-anchor",
  id: "urn:anchor:1",
  agent: RECORD.agent,
  owner: RECORD.owner,
  seq: 1,
  hash: DIGEST,
  jws: witnessFixture(RECORD, { seq: 1, hash: DIGEST }),
} as const;

it.each([
  gateDecision,
  { ...gateDecision, outcome: "admit", reason: "admit", taskId: "task-1" },
  { ...gateDecision, direction: "out", outcome: "go", reason: "go" },
  { ...gateDecision, direction: "out", outcome: "stop", reason: "prohibited" },
  { ...gateDecision, direction: "out", outcome: "ask-principal", reason: "ask-principal" },
  { ...gateDecision, outcome: "unstructured", reason: "no-structured-content" },
  anchor,
])("accepts body-free $type $outcome", (record) => {
  expect(checkedRecord(record)).toEqual(record);
});

it.each([
  ["missing gate sequence", { ...gateDecision, gateSeq: null }],
  ["wrong digest", { ...gateDecision, messageDigest: "actual message" }],
  ["wrong direction for outcome", { ...gateDecision, direction: "out" }],
  ["invalid configuration", { ...gateDecision, configuration: "prompt text" }],
  ["long reason", { ...gateDecision, reason: "x".repeat(65) }],
  ["arbitrary lowercase reason", { ...gateDecision, reason: "private-prompt-text" }],
  ["free-form reason", { ...gateDecision, reason: "private prompt" }],
  ["body", { ...gateDecision, body: "private message" }],
  ["handle", { ...gateDecision, accountId: "private-handle" }],
  ["prompt", { ...anchor, prompt: "private prompt" }],
  ["long JWS", { ...anchor, jws: "a".repeat(4097) }],
  ["JWS head mismatch", { ...anchor, hash: digestOf("different") }],
  [
    "JWS with embedded content",
    {
      ...anchor,
      jws: anchor.jws.replace(
        /\.([^.]+)\./,
        (_, payload) =>
          `.${Buffer.from(
            JSON.stringify({
              ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
              prompt: "private prompt",
            }),
          ).toString("base64url")}.`,
      ),
    },
  ],
] as const)("accepts the valid shape but rejects %s", (_, record) => {
  const original = record.type === "gate-decision" ? gateDecision : anchor;
  expect(checkedRecord(original)).toEqual(original);
  expect(() => checkedRecord(record)).toThrow();
});

it("reports a gate decision that has no matching sequence and hash in the gate ledger", () => {
  const entry = seal(1, AT, GENESIS, gateDecision);
  expect(verifyLedger([entry], { gateEntries: [] })).toMatchObject({
    ok: false,
    firstBadSeq: 1,
    problem: "gate record missing",
  });
  expect(verifyLedger([entry], { gateEntries: [{ seq: 2, hash: gateDecision.gateHash }] }).ok).toBe(
    false,
  );
  expect(verifyLedger([entry], { gateEntries: [{ seq: 3, hash: gateDecision.gateHash }] }).ok).toBe(
    true,
  );
});

it("reports truncation before the latest witnessed head or its anchor", () => {
  const entries = activityFixture(3);
  const head = required(entries[2]);
  const anchored = seal(4, AT, head.hash, {
    ...anchor,
    seq: head.seq,
    hash: head.hash,
    jws: witnessFixture(RECORD, { seq: head.seq, hash: head.hash }),
  });
  expect(verifyLedger([...entries, anchored], { witnessedHeads: [head] }).ok).toBe(true);
  expect(verifyLedger(entries, { witnessedHeads: [head] })).toMatchObject({
    ok: false,
    firstBadSeq: anchored.seq,
    problem: "witness anchor missing",
  });
  expect(verifyLedger(entries.slice(0, -1), { witnessedHeads: [head] })).toMatchObject({
    ok: false,
    firstBadSeq: head.seq,
    problem: "witnessed head missing or changed",
  });
});

it("accepts a latest witness and its anchor pruned by a valid checkpoint", () => {
  const first = required(activityFixture(1)[0]);
  const anchored = seal(2, AT, first.hash, {
    ...anchor,
    hash: first.hash,
    jws: witnessFixture(RECORD, { seq: first.seq, hash: first.hash }),
  });
  const checkpoint = seal(3, AT, anchored.hash, {
    type: "ledger-checkpoint",
    lastPrunedSeq: anchored.seq,
    lastPrunedHash: anchored.hash,
  });
  expect(verifyLedger([checkpoint], { witnessedHeads: [first] }).ok).toBe(true);
  const headOnly = seal(3, AT, anchored.hash, {
    type: "ledger-checkpoint",
    lastPrunedSeq: first.seq,
    lastPrunedHash: first.hash,
  });
  expect(verifyLedger([anchored, headOnly], { witnessedHeads: [first] }).ok).toBe(true);
  expect(
    verifyLedger([anchored, headOnly], {
      witnessedHeads: [{ seq: first.seq, hash: DIGEST }],
    }),
  ).toMatchObject({ ok: false, problem: "witnessed head missing or changed" });
});

it("requires an anchor to name its immediate predecessor at write and verification", () => {
  const first = seal(1, AT, GENESIS, RECORD);
  expect(() => seal(3, AT, DIGEST, anchor)).toThrow("Audit head changed before anchoring");
  expect(() => seal(2, AT, first.hash, anchor)).toThrow("Audit head changed before anchoring");
  const rebuilt = (seq: number, prev: string) => {
    const entry = { seq, at: AT, prev, record: anchor };
    return { ...entry, hash: digestOf(entry) };
  };
  expect(verifyRange([first, rebuilt(2, first.hash)]).problem).toBe("Anchor head mismatch");
  expect(verifyRange([rebuilt(3, DIGEST)]).problem).toBe("Anchor head mismatch");
});

it("checks each signed actor, party and sequence alongside the anchor row", () => {
  const [header, payload, signature] = anchor.jws.split(".") as [string, string, string];
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const withPayload = (part: string) => ({
    ...anchor,
    jws: [header, Buffer.from(part).toString("base64url"), signature].join("."),
  });
  for (const claim of ["actor", "subject", "party", "subjectParty", "seq"]) {
    expect(() =>
      checkedRecord(
        withPayload(
          JSON.stringify({
            ...decoded,
            [claim]: claim === "seq" ? 2 : "urn:other",
          }),
        ),
      ),
    ).toThrow("Invalid record head witness");
  }
  expect(() => checkedRecord(withPayload(` ${JSON.stringify(decoded)}`))).toThrow();
  expect(() =>
    checkedRecord({
      ...anchor,
      jws: `${Buffer.from("{}").toString("base64url")}.${payload}.${signature}`,
    }),
  ).toThrow();
  expect(() => checkedRecord({ ...anchor, jws: `.${payload}.${signature}` })).toThrow();
});
