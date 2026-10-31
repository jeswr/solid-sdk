// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutor, MAX_TRANSMISSION_ATTEMPTS } from "../src/index.js";
import { providerResult } from "../src/transmission.js";
import type { SendResult } from "../src/types.js";
import { control, deferred, harness, seal } from "./helpers.js";

afterEach(() => vi.useRealTimers());
describe("step 7: durable idempotency and pilot recovery", () => {
  it("persists attempting and audits BEFORE transmit", async () => {
    const h = harness();
    const e = await h.enqueue();
    vi.mocked(h.binding.send.transmit).mockImplementation(async () => {
      expect(h.records.get(e.proposal.id)).toMatchObject({ status: "attempting", attempts: 1 });
      expect(h.auditRecords).toContainEqual(
        expect.objectContaining({ type: "transmission", outcome: "attempting" }),
      );
      return { outcome: "accepted", providerRef: "test:1" };
    });
    await h.executor.transmit(e.proposal.id);
    expect(await h.executor.transmit(e.proposal.id)).toEqual({
      status: "duplicate",
      providerRef: "test:1",
    });
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(1);
  });
  it("duplicate with no recorded provider reference still cannot send", async () => {
    const h = harness();
    const e = await h.enqueue();
    h.prior(e, "sent");
    expect(await h.executor.transmit(e.proposal.id)).toEqual({ status: "duplicate" });
  });
  it.each([
    "account",
    "binding",
    "wireDigest",
    "termsDigest",
  ] as const)("recorded %s conflict is tampering", async (key) => {
    const h = harness();
    const e = await h.enqueue();
    const p = h.prior(e);
    h.records.set(p.proposal, { ...p, [key]: "conflicting" });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({
      status: "refused",
      reason: "wire-mismatch",
    });
  });
  it("crash after fsync before transmit: fresh executor treats attempting as uncertain", async () => {
    const h = harness();
    const e = await h.enqueue();
    vi.spyOn(h.audit, "append").mockRejectedValueOnce(new Error("crash after durable attempting"));
    await expect(h.executor.transmit(e.proposal.id)).rejects.toThrow("crash");
    expect(h.records.get(e.proposal.id)?.status).toBe("attempting");
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
    expect(await createExecutor(h.options).transmit(e.proposal.id)).toMatchObject({
      status: "uncertain",
    });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    "absent",
    "unknown",
    "throw",
    "malformed",
  ])("uncertain with lookup %s stays uncertain without finality", async (lookup) => {
    const h = harness();
    const e = await h.enqueue();
    h.prior(e);
    if (lookup === "absent")
      h.binding.send.lookup = vi.fn(async () => ({ outcome: "absent" as const }));
    if (lookup === "unknown")
      h.binding.send.lookup = vi.fn(async () => ({ outcome: "unknown" as const, detail: "lag" }));
    if (lookup === "throw")
      h.binding.send.lookup = vi.fn(async () => {
        throw new Error("offline");
      });
    if (lookup === "malformed")
      h.binding.send.lookup = vi.fn(async () => ({
        outcome: "found" as const,
        providerRef: "bad ref",
      }));
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "uncertain" });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
    expect([...h.receipts.values()][0]?.body).toMatchObject({ outcome: "uncertain", final: false });
  });
  it("positive exact-message lookup reconciles without another send", async () => {
    const h = harness();
    const e = await h.enqueue();
    h.prior(e, "attempting");
    h.binding.send.lookup = vi.fn(async () => ({
      outcome: "found" as const,
      providerRef: "lookup:1",
    }));
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
    expect(h.records.get(e.proposal.id)?.providerRef).toBe("lookup:1");
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it("finalAbsence permits a fresh authorized request, bounded at MAX 3", async () => {
    const h = harness();
    const e = await h.enqueue();
    h.prior(e);
    Object.assign(h.binding.send, {
      finalAbsence: true,
      lookup: vi.fn(async () => ({ outcome: "absent" as const })),
    });
    vi.mocked(h.binding.send.transmit).mockResolvedValue({
      outcome: "rejected",
      detail: "not accepted",
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "not-sent" });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "not-sent" });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({
      status: "refused",
      reason: "attempt-limit",
    });
    expect(h.records.get(e.proposal.id)?.attempts).toBe(MAX_TRANSMISSION_ATTEMPTS);
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(2);
  });
  it("final absence remains not-sent at the attempt bound", async () => {
    const h = harness();
    const e = await h.enqueue();
    h.prior(e, "uncertain", 3);
    Object.assign(h.binding.send, {
      finalAbsence: true,
      lookup: async () => ({ outcome: "absent" as const }),
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ reason: "attempt-limit" });
    expect(h.records.get(e.proposal.id)?.status).toBe("not-sent");
  });
  it.each(["gmail", "direct"])("%s cannot opt into idempotentResend", async (id) => {
    const h = harness(id);
    const e = await h.enqueue();
    h.prior(e);
    Object.assign(h.binding.send, { idempotentResend: true });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "uncertain" });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it.each([
    "accepted",
    "rejected",
    "throw",
  ])("A2A identical resend %s preserves earlier uncertainty unless accepted", async (outcome) => {
    const h = harness("a2a");
    const e = await h.enqueue();
    h.prior(e);
    Object.assign(h.binding.send, { idempotentResend: true });
    vi.mocked(h.binding.send.transmit).mockImplementation(async () => {
      if (outcome === "throw") throw new Error("offline");
      return outcome === "accepted"
        ? { outcome: "accepted", providerRef: "peer:1" }
        : { outcome: "rejected", detail: "rejected" };
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({
      status: outcome === "accepted" ? "sent" : "uncertain",
    });
    await h.executor.drain();
    expect(h.records.get(e.proposal.id)?.status).toBe(
      outcome === "accepted" ? "sent" : "uncertain",
    );
  });
  it("A2A identical resend obeys the global maximum", async () => {
    const h = harness("a2a");
    const e = await h.enqueue();
    h.prior(e, "uncertain", 3);
    Object.assign(h.binding.send, { idempotentResend: true });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ reason: "attempt-limit" });
    expect(h.records.get(e.proposal.id)?.status).toBe("uncertain");
  });
  it("an unresolved resend refused by current policy retains the commitment", async () => {
    const h = harness("a2a");
    const e = await h.enqueue();
    h.prior(e);
    Object.assign(h.binding.send, { idempotentResend: true });
    h.state.mandate = undefined;
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "refused" });
    expect(h.records.get(e.proposal.id)?.status).toBe("uncertain");
  });
  it("two executors sharing a store cannot claim the same proposal twice", async () => {
    const h = harness();
    const e = await h.enqueue();
    const results = await Promise.all([
      h.executor.transmit(e.proposal.id),
      createExecutor(h.options).transmit(e.proposal.id),
    ]);
    expect(results.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(1);
  });
  it("audit, ledger and persistence errors prevent effects", async () => {
    for (const failure of ["audit", "ledger", "put"] as const) {
      const h = harness();
      const e = await h.enqueue();
      if (failure === "audit")
        vi.spyOn(h.audit, "append").mockRejectedValue(new Error("audit failed"));
      if (failure === "ledger")
        vi.spyOn(h.audit, "listCommitted").mockRejectedValue(new Error("ledger failed"));
      if (failure === "put")
        vi.spyOn(h.transmissions, "put").mockRejectedValue(new Error("fsync failed"));
      await expect(h.executor.transmit(e.proposal.id)).rejects.toThrow();
      expect(h.binding.send.transmit).not.toHaveBeenCalled();
    }
  });
});

describe("asynchronous send boundary", () => {
  it.each([
    "accepted",
    "rejected",
    "throw",
    "malformed",
  ])("timeout, no blind retry, then late %s", async (outcome) => {
    vi.useFakeTimers();
    const h = harness();
    const e = await h.enqueue();
    const pending = deferred<SendResult>();
    vi.mocked(h.binding.send.transmit).mockReturnValue(pending.promise);
    Object.assign(h.binding.send, {
      finalAbsence: true,
      lookup: async () => ({ outcome: "absent" as const }),
    });
    const ex = createExecutor({ ...h.options, timeoutMs: 10 });
    const sending = ex.transmit(e.proposal.id);
    await vi.advanceTimersByTimeAsync(10);
    expect(await sending).toMatchObject({ status: "uncertain" });
    expect(await ex.transmit(e.proposal.id)).toMatchObject({
      status: "uncertain",
      reason: "in-flight",
    });
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(1);
    if (outcome === "throw") pending.reject(new Error("late failure"));
    else
      pending.resolve(
        outcome === "accepted"
          ? { outcome: "accepted", providerRef: "late:1" }
          : outcome === "rejected"
            ? { outcome: "rejected", detail: "late rejection" }
            : (undefined as never),
      );
    await ex.drain();
    expect(h.records.get(e.proposal.id)?.status).toBe(
      outcome === "accepted" ? "sent" : outcome === "rejected" ? "not-sent" : "uncertain",
    );
  });
  it("late rejected A2A resend does not erase an earlier commitment", async () => {
    vi.useFakeTimers();
    const h = harness("a2a");
    const e = await h.enqueue();
    h.prior(e);
    const pending = deferred<SendResult>();
    Object.assign(h.binding.send, { idempotentResend: true });
    vi.mocked(h.binding.send.transmit).mockReturnValue(pending.promise);
    const ex = createExecutor({ ...h.options, timeoutMs: 10 });
    const send = ex.transmit(e.proposal.id);
    await vi.advanceTimersByTimeAsync(10);
    await send;
    pending.resolve({ outcome: "rejected", detail: "no" });
    await ex.drain();
    expect(h.records.get(e.proposal.id)?.status).toBe("uncertain");
  });
  it("a late audit failure blocks subsequent effects and is exposed by drain", async () => {
    vi.useFakeTimers();
    const h = harness();
    const e = await h.enqueue();
    const pending = deferred<SendResult>();
    vi.mocked(h.binding.send.transmit).mockReturnValue(pending.promise);
    const ex = createExecutor({ ...h.options, timeoutMs: 10 });
    const send = ex.transmit(e.proposal.id);
    await vi.advanceTimersByTimeAsync(10);
    await send;
    vi.spyOn(h.audit, "append").mockRejectedValue(new Error("audit unavailable"));
    pending.resolve({ outcome: "accepted", providerRef: "late:1" });
    await expect(ex.drain()).rejects.toThrow("audit unavailable");
    await expect(ex.transmit(e.proposal.id)).rejects.toThrow("late settlement");
  });
  it("halt arrives during lookup: final absence cannot bypass the halt", async () => {
    const h = harness();
    const e = await h.enqueue();
    h.prior(e);
    Object.assign(h.binding.send, {
      finalAbsence: true,
      lookup: async () => {
        h.state.haltFile = true;
        return { outcome: "absent" as const };
      },
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ reason: "halted" });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it("revocation during lookup is checked before entering transmit", async () => {
    const h = harness();
    const e = await h.enqueue();
    h.prior(e);
    Object.assign(h.binding.send, {
      finalAbsence: true,
      lookup: async () => {
        h.state.mandate = undefined;
        return { outcome: "absent" as const };
      },
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "not-sent" });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it.each([
    "halt",
    "revoke",
    "change",
    "wrong-scope",
    "empty-token",
    "wrong-account",
  ])("credential wait cannot bypass %s", async (change) => {
    const h = harness();
    const e = await h.enqueue();
    vi.mocked(h.options.tokens.send).mockImplementation(async () => {
      if (change === "halt") h.statements.push(control("Halt", 0));
      if (change === "revoke") h.state.mandate = undefined;
      if (change === "change") {
        e.proposal.intent.amount.value = 99;
        seal(e);
      }
      return {
        access: change === "wrong-scope" ? "read" : "send",
        accessToken: change === "empty-token" ? "" : "synthetic",
      } as never;
    });
    if (change === "wrong-account")
      vi.mocked(h.binding.send.transmit).mockImplementation(async (_w, io) => {
        await io.tokens.send({ id: "urn:other-account" });
        return { outcome: "accepted", providerRef: "must-not-happen" };
      });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "uncertain" });
    await h.executor.drain();
    expect(h.records.get(e.proposal.id)?.status).toBe("uncertain");
  });
  it("halt arriving just before credential request prevents obtaining a token", async () => {
    const h = harness();
    const e = await h.enqueue();
    vi.mocked(h.binding.send.transmit).mockImplementation(async (_w, io) => {
      h.state.haltFile = true;
      await io.tokens.send(io.account);
      return { outcome: "accepted", providerRef: "must-not-happen" };
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "uncertain" });
    await h.executor.drain();
    expect(h.options.tokens.send).not.toHaveBeenCalled();
  });
  it("halt after durable claim prevents even entering binding transmit", async () => {
    const h = harness();
    const e = await h.enqueue();
    const append = h.audit.append;
    vi.spyOn(h.audit, "append").mockImplementation(async (record) => {
      await append(record);
      if (record.outcome === "attempting") h.state.haltFile = true;
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "not-sent" });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it("receipt sink failure is reported after preserving sent evidence", async () => {
    const h = harness();
    const e = await h.enqueue();
    vi.spyOn(h.proposals, "emitReceipt").mockRejectedValue(new Error("receipt failure"));
    await expect(h.executor.transmit(e.proposal.id)).rejects.toThrow("receipt failure");
    expect(h.records.get(e.proposal.id)?.status).toBe("sent");
    await expect(createExecutor(h.options).transmit(e.proposal.id)).rejects.toThrow(
      "receipt failure",
    );
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(1);
  });
  it("outcome receipt retains the original conversation if the proposal disappears", async () => {
    const h = harness();
    const e = await h.enqueue();
    vi.mocked(h.binding.send.transmit).mockImplementation(async () => {
      h.entries.delete(e.proposal.id);
      return { outcome: "accepted", providerRef: "test:1" };
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
    expect([...h.receipts.values()][0]?.conversation).toBe(e.proposal.intent.conversation);
  });
  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects invalid timeout %s", (timeoutMs) => {
    const h = harness();
    expect(() => createExecutor({ ...h.options, timeoutMs })).toThrow("Invalid provider timeout");
  });
});

it.each([
  null,
  [],
  true,
  {},
  { outcome: "accepted", providerRef: "bad ref" },
  { outcome: "accepted", providerRef: "ok", extra: true },
  { outcome: "rejected", detail: 1 },
])("malformed send result %j stays unknown", (value) => {
  expect(providerResult(value, false)).toBe("unknown");
});

it("ledger history prevents duplicate sends after local transmission compaction", async () => {
  const h = harness();
  const e = await h.enqueue();
  const record = h.prior(e, "sent");
  h.records.clear();
  h.ledger.push(record);
  expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "duplicate" });
  expect(h.binding.send.transmit).not.toHaveBeenCalled();
});

it("a live request is shared across executor instances, even with finalAbsence", async () => {
  vi.useFakeTimers();
  const h = harness();
  const e = await h.enqueue();
  const pending = deferred<SendResult>();
  vi.mocked(h.binding.send.transmit).mockReturnValue(pending.promise);
  Object.assign(h.binding.send, {
    finalAbsence: true,
    lookup: async () => ({ outcome: "absent" }),
  });
  const ex = createExecutor({ ...h.options, timeoutMs: 10 });
  const send = ex.transmit(e.proposal.id);
  await vi.advanceTimersByTimeAsync(10);
  await send;
  expect(await createExecutor(h.options).transmit(e.proposal.id)).toMatchObject({
    reason: "in-flight",
  });
  pending.resolve({ outcome: "accepted", providerRef: "test:late" });
  await ex.drain();
  expect(h.binding.send.transmit).toHaveBeenCalledTimes(1);
});

it.each([
  "sent",
  "not-sent",
] as const)("timeout preserves concurrent %s evidence and late settlement preserves sent", async (status) => {
  vi.useFakeTimers();
  const h = harness();
  const e = await h.enqueue();
  const pending = deferred<SendResult>();
  vi.mocked(h.binding.send.transmit).mockReturnValue(pending.promise);
  const ex = createExecutor({ ...h.options, timeoutMs: 10 });
  const send = ex.transmit(e.proposal.id);
  setTimeout(() => {
    const record = h.records.get(e.proposal.id);
    h.records.set(e.proposal.id, { ...(record as NonNullable<typeof record>), status });
  }, 9);
  await vi.advanceTimersByTimeAsync(10);
  expect(await send).toMatchObject({ status });
  pending.resolve({ outcome: "rejected", detail: "late refusal" });
  await ex.drain();
  expect(h.records.get(e.proposal.id)?.status).toBe(status);
});

it("audit metadata alone recovers committed usage and idempotency after compaction", async () => {
  const h = harness();
  const e = await h.enqueue();
  await h.executor.transmit(e.proposal.id);
  h.records.clear();
  const event = h.auditRecords.find(
    (record) => record.type === "transmission" && record.outcome === "sent",
  );
  expect(event?.transmission).toMatchObject({
    amount: { value: 0, currency: "GBP" },
    conversation: e.proposal.intent.conversation,
  });
  expect(await createExecutor(h.options).transmit(e.proposal.id)).toMatchObject({
    status: "duplicate",
  });
  expect(h.binding.send.transmit).toHaveBeenCalledTimes(1);
});
it("a duplicate repairs missing audit/outbox/receipt writes without resending", async () => {
  const h = harness();
  const e = await h.enqueue();
  vi.spyOn(h.proposals, "emitReceipt").mockRejectedValueOnce(new Error("receipt unavailable"));
  await expect(h.executor.transmit(e.proposal.id)).rejects.toThrow("receipt unavailable");
  expect(h.receipts.size).toBe(0);
  expect(await createExecutor(h.options).transmit(e.proposal.id)).toMatchObject({
    status: "duplicate",
  });
  expect(h.receipts.size).toBe(1);
  expect(h.binding.send.transmit).toHaveBeenCalledTimes(1);
});
it("receipt conversation cannot be swapped by changing a proposal during send", async () => {
  const h = harness();
  const e = await h.enqueue();
  const original = e.proposal.intent.conversation;
  vi.mocked(h.binding.send.transmit).mockImplementation(async () => {
    e.proposal.intent.conversation = "urn:attacker-conversation";
    return { outcome: "accepted", providerRef: "test:1" };
  });
  expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
  expect([...h.receipts.values()][0]?.conversation).toBe(original);
});

it("tamper auditing failure propagates without an implicit retry", async () => {
  const h = harness();
  const e = await h.enqueue();
  e.proposal.intent.amount.value = -1;
  const append = vi.spyOn(h.audit, "append").mockRejectedValueOnce(new Error("audit offline"));
  await expect(h.executor.transmit(e.proposal.id)).rejects.toThrow("audit offline");
  expect(append).toHaveBeenCalledTimes(1);
  expect(h.binding.send.transmit).not.toHaveBeenCalled();
});
it("even an undefined late audit rejection latches the executor closed", async () => {
  vi.useFakeTimers();
  const h = harness();
  const e = await h.enqueue();
  const pending = deferred<SendResult>();
  vi.mocked(h.binding.send.transmit).mockReturnValue(pending.promise);
  const ex = createExecutor({ ...h.options, timeoutMs: 10 });
  const send = ex.transmit(e.proposal.id);
  await vi.advanceTimersByTimeAsync(10);
  await send;
  vi.spyOn(h.audit, "append").mockRejectedValue(undefined);
  pending.resolve({ outcome: "accepted", providerRef: "test:1" });
  await expect(ex.drain()).rejects.toBeUndefined();
  await expect(ex.transmit(e.proposal.id)).rejects.toThrow("late settlement");
});
