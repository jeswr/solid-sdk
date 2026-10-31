// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutor } from "../src/index.js";
import type { TransmissionRecord } from "../src/types.js";
import { deferred, harness } from "./helpers.js";

afterEach(() => vi.useRealTimers());

describe("pre-dispatch persistence failures", () => {
  for (const stage of ["binding", "credential"] as const) {
    for (const unresolved of [false, true]) {
      it.each([
        "lock",
        "proposal",
        "ledger",
        "audit",
        "disposition",
      ])(`${stage} recheck %s failure propagates with earlier uncertainty ${unresolved}`, async (failure) => {
        const h = harness(unresolved ? "a2a" : "gmail");
        const e = await h.enqueue("urn:proposal:1", 12);
        const error = new Error(`${failure} unavailable`);
        if (unresolved) {
          h.prior(e);
          Object.assign(h.binding.send, { idempotentResend: true });
        }
        const arm = () => {
          if (failure === "lock")
            vi.spyOn(h.transmissions, "exclusive").mockRejectedValueOnce(error);
          if (failure === "proposal") vi.spyOn(h.proposals, "get").mockRejectedValueOnce(error);
          if (failure === "ledger") vi.spyOn(h.audit, "listCommitted").mockRejectedValueOnce(error);
          if (failure === "audit") vi.spyOn(h.audit, "append").mockRejectedValueOnce(error);
          if (failure === "disposition")
            vi.spyOn(h.proposals, "writeDisposition").mockRejectedValueOnce(error);
        };
        if (stage === "binding") {
          const append = h.audit.append;
          let armed = false;
          vi.spyOn(h.audit, "append").mockImplementation(async (record) => {
            await append(record);
            if (record.outcome === "attempting" && !armed) {
              armed = true;
              arm();
            }
          });
        } else {
          vi.mocked(h.options.tokens.send).mockImplementationOnce(async () => {
            arm();
            return { access: "send", accessToken: "synthetic" };
          });
        }
        const provider = vi.fn();
        vi.mocked(h.binding.send.transmit).mockImplementation(async (_wire, io) => {
          await io.tokens.send(io.account);
          provider();
          return { outcome: "accepted", providerRef: "test:recovered" };
        });
        await expect(h.executor.transmit(e.proposal.id)).rejects.toBe(error);
        await expect(h.executor.drain()).resolves.toBeUndefined();
        expect(provider).not.toHaveBeenCalled();
        expect(h.binding.send.transmit).toHaveBeenCalledTimes(stage === "binding" ? 0 : 1);
        expect(h.records.get(e.proposal.id)).toMatchObject({
          status: unresolved ? "uncertain" : "not-sent",
          attempts: unresolved ? 2 : 1,
          amount: { value: 12, currency: "GBP" },
        });
        expect([...h.receipts.values()][0]?.body).toMatchObject({
          outcome: unresolved ? "uncertain" : "not-executed",
          final: !unresolved,
        });
        // The same executor can retry a proven non-send without provider lookup/finalAbsence.
        expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
        expect(provider).toHaveBeenCalledTimes(1);
      });
    }
  }

  it.each([
    false,
    true,
  ])("late credential ledger failure surfaces through drain, prior %s", async (unresolved) => {
    vi.useFakeTimers();
    const h = harness(unresolved ? "a2a" : "gmail");
    const e = await h.enqueue();
    if (unresolved) {
      h.prior(e);
      Object.assign(h.binding.send, { idempotentResend: true });
    }
    const ledger = deferred<readonly TransmissionRecord[]>();
    vi.mocked(h.options.tokens.send).mockImplementationOnce(async () => {
      vi.spyOn(h.audit, "listCommitted").mockReturnValueOnce(ledger.promise);
      return { access: "send", accessToken: "synthetic" };
    });
    const provider = vi.fn();
    vi.mocked(h.binding.send.transmit).mockImplementation(async (_wire, io) => {
      await io.tokens.send(io.account);
      provider();
      return { outcome: "accepted", providerRef: "must-not-send" };
    });
    const ex = createExecutor({ ...h.options, timeoutMs: 10 });
    const sending = ex.transmit(e.proposal.id);
    await vi.advanceTimersByTimeAsync(10);
    const error = new Error("late ledger failure");
    ledger.reject(error);
    expect(await sending).toMatchObject({ status: "uncertain" });
    await expect(ex.drain()).rejects.toBe(error);
    expect(provider).not.toHaveBeenCalled();
    expect(h.records.get(e.proposal.id)?.status).toBe(unresolved ? "uncertain" : "not-sent");
  });

  it("a caught executor failure cannot be bypassed by requesting another token", async () => {
    const h = harness();
    const e = await h.enqueue();
    const error = new Error("ledger unavailable");
    vi.mocked(h.options.tokens.send).mockImplementationOnce(async () => {
      vi.spyOn(h.audit, "listCommitted").mockRejectedValueOnce(error);
      return { access: "send", accessToken: "synthetic" };
    });
    vi.mocked(h.binding.send.transmit).mockImplementation(async (_wire, io) => {
      await expect(io.tokens.send(io.account)).rejects.toBe(error);
      await expect(io.tokens.send(io.account)).rejects.toBe(error);
      return { outcome: "rejected", detail: "no credentials" };
    });
    await expect(h.executor.transmit(e.proposal.id)).rejects.toBe(error);
    expect(h.options.tokens.send).toHaveBeenCalledTimes(1);
    expect(h.records.get(e.proposal.id)?.status).toBe("not-sent");
  });

  it("a persistence failure invalidates concurrent credential requests", async () => {
    const h = harness();
    const e = await h.enqueue();
    const error = new Error("ledger unavailable");
    vi.mocked(h.options.tokens.send).mockImplementationOnce(async () => {
      vi.spyOn(h.audit, "listCommitted").mockRejectedValueOnce(error);
      return { access: "send", accessToken: "synthetic" };
    });
    vi.mocked(h.binding.send.transmit).mockImplementation(async (_wire, io) => {
      const requests = await Promise.allSettled([
        io.tokens.send(io.account),
        io.tokens.send(io.account),
      ]);
      expect(requests).toEqual([
        { status: "rejected", reason: error },
        { status: "rejected", reason: error },
      ]);
      return { outcome: "rejected", detail: "no credentials" };
    });
    await expect(h.executor.transmit(e.proposal.id)).rejects.toBe(error);
    expect(h.options.tokens.send).toHaveBeenCalledTimes(2);
    expect(h.records.get(e.proposal.id)?.status).toBe("not-sent");
  });

  it.each([
    "unknown",
    "accepted",
  ])("credentials already released retain %s provider evidence", async (outcome) => {
    const h = harness();
    const e = await h.enqueue();
    const error = new Error("ledger unavailable");
    vi.mocked(h.binding.send.transmit).mockImplementation(async (_wire, io) => {
      await io.tokens.send(io.account);
      vi.spyOn(h.audit, "listCommitted").mockRejectedValueOnce(error);
      await expect(io.tokens.send(io.account)).rejects.toBe(error);
      if (outcome === "unknown") throw error;
      return { outcome: "accepted", providerRef: "test:sent" };
    });
    await expect(h.executor.transmit(e.proposal.id)).rejects.toBe(error);
    expect(h.records.get(e.proposal.id)?.status).toBe(
      outcome === "accepted" ? "sent" : "uncertain",
    );
  });
});
