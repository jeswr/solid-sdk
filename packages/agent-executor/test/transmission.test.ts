// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutor, MAX_TRANSMISSION_ATTEMPTS } from "../src/index.js";
import { providerResult } from "../src/transmission.js";
import type { SendResult } from "../src/types.js";
import { control, deferred, harness, seal, UNTIL } from "./helpers.js";

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
  it.each([
    1,
    MAX_TRANSMISSION_ATTEMPTS,
  ])("A2A positive lookup reconciles after %s attempts", async (attempts) => {
    const h = harness("a2a");
    const e = await h.enqueue();
    h.prior(e, "uncertain", attempts);
    Object.assign(h.binding.send, {
      idempotentResend: true,
      lookup: vi.fn(async () => ({ outcome: "found" as const, providerRef: "peer:found" })),
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
    expect(h.records.get(e.proposal.id)).toMatchObject({
      status: "sent",
      attempts,
      providerRef: "peer:found",
    });
    expect([...h.receipts.values()][0]?.body).toMatchObject({ outcome: "completed", final: true });
    expect(h.binding.send.lookup).toHaveBeenCalledWith(e.wire);
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
    expect(h.options.tokens.send).not.toHaveBeenCalled();
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "duplicate" });
  });
  it.each([
    false,
    true,
  ])("same-millisecond non-sends retry with newest-first ledger, compacted=%s", async (compacted) => {
    const h = harness();
    const e = await h.enqueue();
    vi.mocked(h.binding.send.transmit).mockResolvedValue({
      outcome: "rejected",
      detail: "not accepted",
    });
    vi.spyOn(h.audit, "listCommitted").mockImplementation(async () =>
      structuredClone([...h.ledger].reverse()),
    );
    for (let attempts = 1; attempts <= MAX_TRANSMISSION_ATTEMPTS; attempts++) {
      if (compacted) h.records.clear();
      expect(await createExecutor(h.options).transmit(e.proposal.id)).toMatchObject({
        status: "not-sent",
      });
      expect(h.records.get(e.proposal.id)?.attempts).toBe(attempts);
    }
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ reason: "attempt-limit" });
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(MAX_TRANSMISSION_ATTEMPTS);
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
  it.each([
    "absent",
    "unknown",
    "throw",
    "malformed",
  ])("A2A lookup %s cannot exceed the retry cap or release uncertainty", async (outcome) => {
    const h = harness("a2a");
    const e = await h.enqueue();
    h.prior(e, "uncertain", MAX_TRANSMISSION_ATTEMPTS);
    Object.assign(h.binding.send, {
      idempotentResend: true,
      lookup: vi.fn(async () => {
        if (outcome === "throw") throw new Error("offline");
        return outcome === "absent"
          ? { outcome: "absent" as const }
          : outcome === "malformed"
            ? { outcome: "found" as const, providerRef: "bad ref" }
            : { outcome: "unknown" as const, detail: "lag" };
      }),
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ reason: "attempt-limit" });
    expect(h.binding.send.lookup).toHaveBeenCalledOnce();
    expect(h.records.get(e.proposal.id)).toMatchObject({
      status: "uncertain",
      attempts: MAX_TRANSMISSION_ATTEMPTS,
    });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it("A2A lookup miss still permits an identical resend below the cap", async () => {
    const h = harness("a2a");
    const e = await h.enqueue();
    h.prior(e);
    Object.assign(h.binding.send, {
      idempotentResend: true,
      lookup: vi.fn(async () => ({ outcome: "absent" as const })),
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
    expect(h.binding.send.lookup).toHaveBeenCalledWith(e.wire);
    expect(h.binding.send.transmit).toHaveBeenCalledOnce();
    expect(h.records.get(e.proposal.id)?.attempts).toBe(2);
  });
  it("sequence exhaustion fails before a new provider call", async () => {
    const h = harness();
    const e = await h.enqueue();
    h.records.set(e.proposal.id, { ...h.prior(e, "not-sent"), sequence: Number.MAX_SAFE_INTEGER });
    await expect(h.executor.transmit(e.proposal.id)).rejects.toThrow(
      "Transmission sequence exhausted",
    );
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
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
  it.each([
    "revoke",
    "deny",
  ])("%s during lookup is checked before entering transmit", async (change) => {
    const h = harness();
    const e = await h.enqueue();
    h.prior(e);
    Object.assign(h.binding.send, {
      finalAbsence: true,
      lookup: async () => {
        if (change === "revoke") h.state.mandate = undefined;
        else h.confirm(e, "deny");
        return { outcome: "absent" as const };
      },
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "not-sent" });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it.each([
    "halt",
    "revoke",
    "deny",
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
      if (change === "deny") h.confirm(e, "deny");
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
  it.each([
    "halt",
    "deny",
  ])("%s after durable claim prevents even entering binding transmit", async (change) => {
    const h = harness();
    const e = await h.enqueue();
    const append = h.audit.append;
    vi.spyOn(h.audit, "append").mockImplementation(async (record) => {
      await append(record);
      if (record.outcome === "attempting") {
        if (change === "halt") h.state.haltFile = true;
        else h.confirm(e, "deny");
      }
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
    await expect(createExecutor(h.options).runOutboxOnce()).rejects.toThrow("receipt failure");
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(1);
  });
  it.each([
    "lock",
    "read",
    "put",
    "audit",
    "disposition",
    "receipt",
  ])("a settled rejection releases pending state after %s failure", async (failure) => {
    for (const replacement of [false, true]) {
      const h = harness();
      const e = await h.enqueue();
      const error = new Error(`${failure} unavailable`);
      const lookup = vi.fn(async () => ({ outcome: "absent" as const }));
      Object.assign(h.binding.send, { finalAbsence: true, lookup });
      vi.mocked(h.binding.send.transmit).mockImplementationOnce(async () => {
        if (failure === "lock") vi.spyOn(h.transmissions, "exclusive").mockRejectedValueOnce(error);
        if (failure === "read") vi.spyOn(h.transmissions, "get").mockRejectedValueOnce(error);
        if (failure === "put") vi.spyOn(h.transmissions, "put").mockRejectedValueOnce(error);
        if (failure === "audit") vi.spyOn(h.audit, "append").mockRejectedValueOnce(error);
        if (failure === "disposition")
          vi.spyOn(h.proposals, "writeDisposition").mockRejectedValueOnce(error);
        if (failure === "receipt")
          vi.spyOn(h.proposals, "emitReceipt").mockRejectedValueOnce(error);
        h.state.at = new Date(h.clock.now().getTime() + 1).toISOString();
        return { outcome: "rejected", detail: "not accepted" };
      });
      await expect(h.executor.transmit(e.proposal.id)).rejects.toBe(error);
      const unresolved = ["lock", "read", "put"].includes(failure);
      expect(h.records.get(e.proposal.id)).toMatchObject({
        status: unresolved ? "attempting" : "not-sent",
        attempts: 1,
        wireDigest: e.wireDigest,
      });
      const retry = replacement ? createExecutor(h.options) : h.executor;
      expect(await retry.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
      expect(lookup).toHaveBeenCalledTimes(unresolved ? 1 : 0);
      expect(h.records.get(e.proposal.id)).toMatchObject({ status: "sent", attempts: 2 });
      expect(h.binding.send.transmit).toHaveBeenCalledTimes(2);
    }
  });
  it.each([
    "audit",
    "disposition",
    "receipt",
  ])("late rejection releases shared pending state despite %s failure", async (failure) => {
    vi.useFakeTimers();
    const h = harness();
    const e = await h.enqueue();
    const pending = deferred<SendResult>();
    vi.mocked(h.binding.send.transmit).mockReturnValueOnce(pending.promise);
    const ex = createExecutor({ ...h.options, timeoutMs: 10 });
    const sending = ex.transmit(e.proposal.id);
    await vi.advanceTimersByTimeAsync(10);
    expect(await sending).toMatchObject({ status: "uncertain" });
    const error = new Error(`${failure} unavailable`);
    if (failure === "audit") vi.spyOn(h.audit, "append").mockRejectedValueOnce(error);
    if (failure === "disposition")
      vi.spyOn(h.proposals, "writeDisposition").mockRejectedValueOnce(error);
    if (failure === "receipt") vi.spyOn(h.proposals, "emitReceipt").mockRejectedValueOnce(error);
    h.state.at = new Date(h.clock.now().getTime() + 1).toISOString();
    pending.resolve({ outcome: "rejected", detail: "late refusal" });
    await expect(ex.drain()).rejects.toBe(error);
    expect(h.records.get(e.proposal.id)).toMatchObject({ status: "not-sent", attempts: 1 });
    await expect(ex.transmit(e.proposal.id)).rejects.toThrow("late settlement");
    expect(await createExecutor(h.options).transmit(e.proposal.id)).toMatchObject({
      status: "sent",
    });
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(2);
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
it.each([
  "before-receipt",
  "after-receipt",
  "disposition",
])("outbox polling repairs %s failure without resending", async (failure) => {
  for (const replacement of [false, true]) {
    const h = harness();
    const e = await h.enqueue();
    const error = new Error("settlement unavailable");
    if (failure === "disposition") {
      const write = h.proposals.writeDisposition;
      vi.spyOn(h.proposals, "writeDisposition").mockImplementation(async (id, result) => {
        if (result.status === "sent") throw error;
        await write(id, result);
      });
    } else {
      const emit = h.proposals.emitReceipt;
      vi.spyOn(h.proposals, "emitReceipt").mockImplementationOnce(async (receipt) => {
        if (failure === "after-receipt") await emit(receipt);
        throw error;
      });
    }
    await expect(h.executor.runOutboxOnce()).rejects.toBe(error);
    expect(h.records.get(e.proposal.id)).toMatchObject({ status: "sent", attempts: 1 });
    expect(await h.proposals.queued()).toEqual([e.proposal.id]);
    expect(h.receipts.size).toBe(failure === "before-receipt" ? 0 : 1);
    if (failure === "disposition") vi.mocked(h.proposals.writeDisposition).mockRestore();
    const executor = replacement ? createExecutor(h.options) : h.executor;
    expect(await executor.runOutboxOnce()).toEqual({
      [e.proposal.id]: { status: "duplicate", providerRef: "test:1" },
    });
    expect(h.receipts.size).toBe(1);
    expect(h.dispositions.get(e.proposal.id)).toEqual({ status: "sent", reason: "sent" });
    expect(await executor.runOutboxOnce()).toEqual({});
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(1);
    expect(h.options.tokens.send).toHaveBeenCalledTimes(1);
  }
});
it.each([
  "expired",
  "halted",
  "mandate-unavailable",
  "changed-proposal",
])("outbox repairs sent receipts when authorization is %s", async (authority) => {
  for (const compacted of [false, true]) {
    for (const replacement of [false, true]) {
      const h = harness();
      const e = await h.enqueue();
      const conversation = e.proposal.intent.conversation;
      vi.spyOn(h.proposals, "emitReceipt").mockRejectedValueOnce(new Error("receipt unavailable"));
      await expect(h.executor.runOutboxOnce()).rejects.toThrow("receipt unavailable");
      expect(h.receipts.size).toBe(0);
      expect(await h.proposals.queued()).toEqual([e.proposal.id]);
      if (compacted) h.records.clear();
      else h.ledger.length = 0;
      if (authority === "expired") h.state.at = new Date(Date.parse(UNTIL) + 1).toISOString();
      if (authority === "halted") h.state.haltFile = true;
      if (authority === "mandate-unavailable") h.state.mandate = undefined;
      if (authority === "changed-proposal")
        e.proposal.intent.conversation = "urn:other-conversation";
      const proposal = vi.spyOn(h.proposals, "get");
      const approvals = vi.spyOn(h.approvalStore, "findVerified");
      vi.mocked(h.options.mandates.load).mockClear();
      vi.mocked(h.binding.send.transmit).mockClear();
      vi.mocked(h.options.tokens.send).mockClear();
      const executor = replacement ? createExecutor(h.options) : h.executor;
      // Control-driven evaluation also repairs settlements without authorizing another send.
      expect(await executor.runOutboxOnce(!replacement)).toEqual({
        [e.proposal.id]: { status: "duplicate", providerRef: "test:1" },
      });
      expect([...h.receipts.values()]).toEqual([
        expect.objectContaining({
          conversation,
          body: expect.objectContaining({ outcome: "completed", final: true }),
        }),
      ]);
      expect(h.records.get(e.proposal.id)).toMatchObject({ status: "sent", attempts: 1 });
      expect(await h.proposals.queued()).toEqual([]);
      expect(proposal).not.toHaveBeenCalled();
      expect(approvals).not.toHaveBeenCalled();
      expect(h.options.mandates.load).not.toHaveBeenCalled();
      expect(h.options.tokens.send).not.toHaveBeenCalled();
      expect(h.binding.send.transmit).not.toHaveBeenCalled();
    }
  }
});
it.each([
  "attempting",
  "uncertain",
  "not-sent",
] as const)("expired %s history does not establish a completed send", async (status) => {
  const h = harness();
  const e = await h.enqueue();
  const prior = h.prior(e, status);
  h.state.at = new Date(Date.parse(UNTIL) + 1).toISOString();
  expect(await h.executor.runOutboxOnce()).toEqual({
    [e.proposal.id]: { status: "refused", reason: "expired" },
  });
  expect(h.records.get(e.proposal.id)).toEqual(prior);
  expect(h.receipts.size).toBe(0);
  expect(h.binding.send.transmit).not.toHaveBeenCalled();
  expect(h.options.tokens.send).not.toHaveBeenCalled();
});
it("outbox repairs a legacy sent receipt without a provider reference", async () => {
  const h = harness();
  const e = await h.enqueue();
  h.prior(e, "sent");
  h.state.at = new Date(Date.parse(UNTIL) + 1).toISOString();
  expect(await h.executor.runOutboxOnce()).toEqual({ [e.proposal.id]: { status: "duplicate" } });
  expect([...h.receipts.values()][0]?.body).toMatchObject({ outcome: "completed", final: true });
  expect(h.binding.send.transmit).not.toHaveBeenCalled();
});
it.each([
  "lock",
  "history",
  "ledger",
  "put",
  "audit",
  "receipt",
  "disposition",
])("outbox recovery propagates %s failures and can repair them on the next pass", async (failure) => {
  const h = harness();
  const e = await h.enqueue();
  h.prior(e, "sent");
  h.state.at = new Date(Date.parse(UNTIL) + 1).toISOString();
  const error = new Error("recovery unavailable");
  if (failure === "lock") vi.spyOn(h.transmissions, "exclusive").mockRejectedValueOnce(error);
  if (failure === "history") vi.spyOn(h.transmissions, "list").mockRejectedValueOnce(error);
  if (failure === "ledger") vi.spyOn(h.audit, "listCommitted").mockRejectedValueOnce(error);
  if (failure === "put") vi.spyOn(h.transmissions, "put").mockRejectedValueOnce(error);
  if (failure === "audit") vi.spyOn(h.audit, "append").mockRejectedValueOnce(error);
  if (failure === "receipt") vi.spyOn(h.proposals, "emitReceipt").mockRejectedValueOnce(error);
  if (failure === "disposition")
    vi.spyOn(h.proposals, "writeDisposition").mockRejectedValueOnce(error);
  await expect(h.executor.runOutboxOnce()).rejects.toBe(error);
  expect(await h.proposals.queued()).toEqual([e.proposal.id]);
  expect(await h.executor.runOutboxOnce()).toEqual({ [e.proposal.id]: { status: "duplicate" } });
  expect(h.receipts.size).toBe(1);
  expect(h.binding.send.transmit).not.toHaveBeenCalled();
  expect(h.options.tokens.send).not.toHaveBeenCalled();
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
