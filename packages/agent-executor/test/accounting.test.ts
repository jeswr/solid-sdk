// AUTHORED-BY Codex GPT-6.1-Sol
import { AGENT, type Limit } from "@jeswr/agent-mandate";
import { describe, expect, it } from "vitest";
import {
  checkLimits,
  committedRecords,
  periodStart,
  transmissionRecords,
} from "../src/accounting.js";
import type { AccountingMandate, TransmissionRecord } from "../src/types.js";
import { harness, NOW, seal } from "./helpers.js";

function limit(operand: string, value: number, enforcement: "hard" | "soft" = "hard"): Limit {
  return { leftOperand: `${AGENT}${operand}`, operator: "lteq", rightOperand: value, enforcement };
}
function setLimits(h: ReturnType<typeof harness>, limits: readonly Limit[]) {
  Object.assign(h.state.mandate as object, { limits });
}
describe("step 6: committed outbox + ledger accounting", () => {
  it.each([
    "attempting",
    "uncertain",
    "sent",
  ] as const)("%s commitments count as spent, even before settlement", async (status) => {
    const h = harness();
    const old = await h.enqueue("urn:old", 7);
    const p = h.prior(old, status);
    h.ledger.push(p);
    const e = await h.enqueue("urn:new", 4);
    setLimits(h, [limit("spendPerDay", 10)]);
    expect(await h.executor.transmit(e.proposal.id)).toEqual({
      status: "refused",
      reason: "limit:spendPerDay",
    });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it("deduplicates the same commitment in ledger and outbox", async () => {
    const h = harness();
    const old = await h.enqueue("urn:old", 5);
    const p = h.prior(old, "sent");
    h.ledger.push(p);
    const e = await h.enqueue("urn:new", 5);
    setLimits(h, [limit("spendPerDay", 10)]);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
  });
  it("retains ledger commitments removed from the outbox", async () => {
    const h = harness();
    const old = await h.enqueue("urn:old", 9);
    const p = h.prior(old, "sent");
    h.records.clear();
    h.ledger.push(p);
    const e = await h.enqueue("urn:new", 2);
    setLimits(h, [limit("spendPerWeek", 10)]);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({
      reason: "limit:spendPerWeek",
    });
  });
  it("not-sent obligations are released; retries reserve their own amount once", async () => {
    const h = harness("a2a");
    const old = await h.enqueue("urn:old", 10);
    h.prior(old, "not-sent");
    const e = await h.enqueue("urn:new", 10);
    h.prior(e);
    Object.assign(h.binding.send, { idempotentResend: true });
    setLimits(h, [limit("spendPerDay", 10)]);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
  });
  it.each([
    "spendPerDay",
    "spendPerWeek",
    "spendPerMonth",
  ])("enforces %s at the UTC calendar boundary", async (operand) => {
    const h = harness();
    const old = await h.enqueue("urn:old", 100);
    const p = h.prior(old, "sent");
    const start = periodStart(
      new Date(NOW),
      operand === "spendPerWeek" ? "week" : operand === "spendPerMonth" ? "month" : "day",
    );
    h.records.set(p.proposal, {
      ...p,
      startedAt: new Date(start - 1).toISOString(),
      committedAt: new Date(start - 1).toISOString(),
    });
    const e = await h.enqueue("urn:new", 10);
    setLimits(h, [limit(operand, 10)]);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
  });
  it("per-recipient uses a rolling 24 hours and separates recipients", async () => {
    const h = harness();
    const old = await h.enqueue("urn:old");
    const p = h.prior(old, "sent");
    h.records.set(p.proposal, {
      ...p,
      startedAt: "2026-10-30T12:00:00.000Z",
      committedAt: "2026-10-30T12:00:00.000Z",
    });
    const e = await h.enqueue("urn:new");
    setLimits(h, [limit("perRecipientPerDay", 1)]);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({
      reason: "limit:perRecipientPerDay",
    });
    e.proposal.intent.recipientHash = "other-salted-hash";
    seal(e);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
  });
  it("expired contact reservations no longer count", async () => {
    const h = harness();
    const old = await h.enqueue("urn:old");
    const p = h.prior(old, "sent");
    h.records.set(p.proposal, {
      ...p,
      startedAt: "2026-10-30T11:59:59.999Z",
      committedAt: "2026-10-30T11:59:59.999Z",
    });
    const e = await h.enqueue("urn:new");
    setLimits(h, [limit("perRecipientPerDay", 1)]);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
  });
  it("global daily sends count every recipient", async () => {
    const h = harness();
    const old = await h.enqueue("urn:old");
    h.prior(old, "sent");
    const e = await h.enqueue("urn:new");
    e.proposal.intent.recipientHash = "other";
    seal(e);
    setLimits(h, [limit("sendsPerDay", 1)]);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ reason: "limit:sendsPerDay" });
  });
  it("soft limits requeue with a reason; a normal approval cannot bypass the cap", async () => {
    const h = harness();
    const e = await h.enqueue("urn:new", 11);
    h.needsApproval();
    h.confirm(e);
    setLimits(h, [limit("spendPerDay", 10, "soft")]);
    expect(await h.executor.transmit(e.proposal.id)).toEqual({
      status: "confirm-required",
      reason: "limit:spendPerDay",
    });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it("any hard limit wins even after an earlier soft breach", async () => {
    const h = harness();
    const e = await h.enqueue("urn:new", 1);
    setLimits(h, [limit("spendPerDay", 0, "soft"), limit("sendsPerDay", 0)]);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({
      status: "refused",
      reason: "limit:sendsPerDay",
    });
  });
  it.each([
    "no-currency",
    "other-currency",
    "ledger-currency",
    "operand",
    "namespace",
    "operator",
    "negative",
    "infinite",
  ])("%s context fails closed", async (change) => {
    const h = harness();
    const e = await h.enqueue("urn:new", 1);
    const cap = limit("spendPerDay", 10);
    setLimits(h, [cap]);
    if (change === "no-currency") Object.assign(h.state.mandate as object, { currency: undefined });
    if (change === "other-currency") e.proposal.intent.amount.currency = "EUR";
    if (change === "ledger-currency") {
      const old = await h.enqueue("urn:old", 1);
      old.proposal.intent.amount.currency = "EUR";
      h.prior(old, "sent");
    }
    if (change === "operand") Object.assign(cap, { leftOperand: `${AGENT}unknown` });
    if (change === "namespace") Object.assign(cap, { leftOperand: "urn:unknown" });
    if (change === "operator") Object.assign(cap, { operator: "lt" });
    if (change === "negative") Object.assign(cap, { rightOperand: -1 });
    if (change === "infinite") Object.assign(cap, { rightOperand: Infinity });
    seal(e);
    expect(await h.executor.transmit(e.proposal.id)).toEqual({
      status: "refused",
      reason: "limit-context-unavailable",
    });
  });
  it("overflowing committed amounts cannot evade a cap", async () => {
    const h = harness();
    const e = await h.enqueue("urn:new", Number.MAX_VALUE);
    const old = await h.enqueue("urn:old", Number.MAX_VALUE);
    h.prior(old);
    setLimits(h, [limit("spendPerDay", Number.MAX_VALUE)]);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "refused" });
  });
  it("concurrent proposals cannot both take the last rate slot", async () => {
    const h = harness();
    const a = await h.enqueue("urn:a");
    const b = await h.enqueue("urn:b");
    setLimits(h, [limit("sendsPerDay", 1)]);
    await Promise.all([h.executor.transmit(a.proposal.id), h.executor.transmit(b.proposal.id)]);
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(1);
  });
  it("stale retry outside the limit period does not reserve again", async () => {
    const h = harness();
    const e = await h.enqueue();
    const p = h.prior(e);
    h.records.set(p.proposal, {
      ...p,
      startedAt: "2026-10-01T00:00:00Z",
      committedAt: "2026-10-01T00:00:00Z",
    });
    expect(
      checkLimits(
        { ...(h.state.mandate as AccountingMandate), limits: [limit("sendsPerDay", 0)] },
        e,
        [...h.records.values()],
        new Date(NOW),
      ),
    ).toBeUndefined();
  });
});

it("accounting union retains positive evidence and rejects conflicting identities", async () => {
  const h = harness();
  const e = await h.enqueue();
  const a = h.prior(e, "attempting");
  const sent = {
    ...a,
    status: "sent",
    updatedAt: "2026-10-31T13:00:00Z",
    providerRef: "test:1",
  } as const;
  const no = { ...sent, status: "not-sent", updatedAt: "2026-10-31T14:00:00Z" } as const;
  expect(committedRecords([sent, no, a])).toEqual([sent]);
  expect(committedRecords([a, sent])).toEqual([sent]);
  expect(committedRecords([a, { ...a, updatedAt: "2026-10-31T11:00:00Z" }])).toEqual([a]);
  expect(() => committedRecords([a, { ...a, amount: { value: 2, currency: "GBP" } }])).toThrow(
    "Conflicting",
  );
  expect(
    committedRecords([
      { ...a, underMandate: "urn:older" },
      { ...a, attempts: 2 },
    ]),
  ).toHaveLength(1);
});

it("memory seams remain isolated, serialized and recover after a rejected transaction", async () => {
  const h = harness();
  const e = await h.enqueue();
  const record = h.prior(e);
  await expect(
    h.transmissions.exclusive(async () => {
      throw new Error("transaction");
    }),
  ).rejects.toThrow();
  expect(await h.transmissions.exclusive(async () => 42)).toBe(42);
  const copy = await h.transmissions.get(record.proposal);
  Object.assign((copy as TransmissionRecord).amount, { value: 999 });
  expect((await h.transmissions.get(record.proposal))?.amount.value).toBe(0);
  await h.proposals.writeDisposition(e.proposal.id, { status: "sent", reason: "sent" });
  expect(await h.proposals.queued()).toEqual([]);
});

it.each([
  { attempts: 0 },
  { attempts: 4 },
  { attempts: 1.5 },
  { sequence: -1 },
  { sequence: 0.5 },
  { sequence: Number.POSITIVE_INFINITY },
  { sequence: Number.MAX_SAFE_INTEGER + 1 },
  { startedAt: "invalid" },
  { updatedAt: "invalid" },
  { committedAt: "invalid" },
  { status: "invalid" },
  { amount: { value: -1, currency: "GBP" } },
  { amount: { value: Infinity, currency: "GBP" } },
  { amount: { value: 1, currency: "invalid" } },
])("corrupt accounting %j fails closed", async (patch) => {
  const h = harness();
  const e = await h.enqueue();
  const record = h.prior(e);
  expect(() => committedRecords([{ ...record, ...patch } as TransmissionRecord])).toThrow(
    "Invalid accounting",
  );
});

it("the highest attempt count survives stale ledger ordering", async () => {
  const h = harness();
  const e = await h.enqueue();
  const record = h.prior(e, "uncertain", 3);
  const newer = { ...record, attempts: 1, updatedAt: "2026-10-31T13:00:00Z" };
  expect(committedRecords([record, newer])[0]?.attempts).toBe(3);
  expect(committedRecords([newer, record])[0]?.attempts).toBe(3);
});
it("positive delivery retains the attempt budget recorded by later failures", async () => {
  const h = harness();
  const e = await h.enqueue();
  const sent = h.prior(e, "sent");
  const failure = { ...sent, status: "not-sent", attempts: 3 } as const;
  for (const records of [
    [sent, failure],
    [failure, sent],
  ])
    expect(transmissionRecords(records)).toEqual([{ ...sent, attempts: 3 }]);
});
it("settlements supersede equal-timestamp claims in every legacy ledger order", async () => {
  const h = harness();
  const e = await h.enqueue();
  const claim = h.prior(e, "attempting");
  const uncertain = { ...claim, status: "uncertain" } as const;
  const settled = { ...claim, status: "not-sent" } as const;
  for (const records of [
    [claim, uncertain, settled],
    [settled, uncertain, claim],
    [uncertain, claim, settled],
    [uncertain, settled, claim],
    [claim, settled, uncertain],
    [settled, claim, uncertain],
  ]) {
    expect(transmissionRecords(records)).toEqual([settled]);
    expect(committedRecords(records)).toEqual([]);
  }
});
it("a new attempt supersedes an earlier non-send despite clock rollback", async () => {
  const h = harness();
  const e = await h.enqueue();
  const old = { ...h.prior(e, "not-sent"), sequence: 9 };
  const claim = {
    ...old,
    status: "attempting",
    attempts: 2,
    sequence: 10,
    updatedAt: "2026-10-31T11:00:00Z",
  } as const;
  for (const records of [
    [old, claim],
    [claim, old],
  ])
    expect(committedRecords(records)).toEqual([claim]);
});
it("durable sequence orders matching states independently of timestamps and ledger order", async () => {
  const h = harness();
  const e = await h.enqueue();
  const old = { ...h.prior(e), sequence: 1 };
  const current = {
    ...old,
    sequence: 2,
    updatedAt: "2026-10-31T11:00:00Z",
    underMandate: "urn:current",
  };
  for (const records of [
    [old, current],
    [current, old],
    [current, current],
  ])
    expect(transmissionRecords(records)).toEqual([current]);
  expect(transmissionRecords([{ ...old, sequence: 0 }, h.prior(e)])).toEqual([
    { ...old, sequence: 0 },
  ]);
});
it.each([undefined, 1, ""])("corrupt accounting identity %j fails closed", async (value) => {
  const h = harness();
  const e = await h.enqueue();
  const record = h.prior(e);
  expect(() =>
    committedRecords([{ ...record, recipientHash: value } as TransmissionRecord]),
  ).toThrow("Invalid accounting identity");
});

it.each([
  { existing: 10000000000000000, candidate: 1, cap: 10000000000000000, refused: true },
  { existing: 0.1, candidate: 0.2, cap: 0.3, refused: false },
  { existing: 1e-7, candidate: 1e-7, cap: 1e-7, refused: true },
  { existing: 5e-324, candidate: 5e-324, cap: 5e-324, refused: true },
])("exact decimal spend arithmetic cannot round away a commitment: %j", async ({
  existing,
  candidate,
  cap,
  refused,
}) => {
  const h = harness();
  const old = await h.enqueue("urn:old", existing);
  h.prior(old, "sent");
  const e = await h.enqueue("urn:new", candidate);
  setLimits(h, [limit("spendPerDay", cap)]);
  expect((await h.executor.transmit(e.proposal.id)).status).toBe(refused ? "refused" : "sent");
});
it("a definitive non-send retried on a new day commits against the new day's budget", async () => {
  const h = harness();
  const e = await h.enqueue("urn:retry", 10);
  const p = h.prior(e, "not-sent");
  h.records.set(p.proposal, {
    ...p,
    startedAt: "2026-10-01T00:00:00Z",
    committedAt: "2026-10-01T00:00:00Z",
  });
  setLimits(h, [limit("spendPerDay", 10)]);
  expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
  expect(h.records.get(e.proposal.id)?.committedAt).toBe(NOW);
  const next = await h.enqueue("urn:next", 1);
  expect(await h.executor.transmit(next.proposal.id)).toMatchObject({
    reason: "limit:spendPerDay",
  });
});
