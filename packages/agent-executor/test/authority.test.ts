// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { createExecutor } from "../src/index.js";
import { control, harness } from "./helpers.js";

describe("final credential authority", () => {
  for (const stage of [
    "render",
    "validate",
    "approval",
    "ledger",
    "audit",
    "disposition",
  ] as const) {
    it.each(["file", "halt", "revoke"])(`%s during credential recheck ${stage}`, async (change) => {
      const h = harness();
      const e = await h.enqueue();
      let checkingCredentials = false;
      const mutate = () => {
        if (!checkingCredentials) return;
        checkingCredentials = false;
        if (change === "file") h.state.haltFile = true;
        else
          h.statements.push(
            control(change === "halt" ? "Halt" : "RevokeMandate", 0, {
              target: h.state.mandate?.id,
            }),
          );
      };
      if (stage === "render") {
        vi.mocked(h.binding.send.render).mockImplementation(async () => {
          const result = structuredClone(e.wire);
          mutate();
          return result;
        });
      }
      if (stage === "validate") {
        vi.mocked(h.binding.send.validate).mockImplementation(async () => {
          mutate();
          return { ok: true };
        });
      }
      if (stage === "approval") {
        const original = h.approvalStore.findVerified;
        vi.spyOn(h.approvalStore, "findVerified").mockImplementation(async (context) => {
          const result = await original(context);
          mutate();
          return result;
        });
      }
      if (stage === "ledger") {
        const original = h.audit.listCommitted;
        vi.spyOn(h.audit, "listCommitted").mockImplementation(async () => {
          const result = await original();
          mutate();
          return result;
        });
      }
      if (stage === "audit") {
        const original = h.audit.append;
        vi.spyOn(h.audit, "append").mockImplementation(async (record) => {
          await original(record);
          if (record.outcome === "re-evaluated") mutate();
        });
      }
      if (stage === "disposition") {
        const original = h.proposals.writeDisposition;
        vi.spyOn(h.proposals, "writeDisposition").mockImplementation(async (id, result) => {
          await original(id, result);
          if (result.status === "ready") mutate();
        });
      }
      const provider = vi.fn();
      vi.mocked(h.binding.send.transmit).mockImplementation(async (_wire, io) => {
        checkingCredentials = true;
        await io.tokens.send(io.account);
        provider();
        return { outcome: "accepted", providerRef: "must-not-send" };
      });
      expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "uncertain" });
      await h.executor.drain();
      expect(checkingCredentials).toBe(false);
      expect(provider).not.toHaveBeenCalled();
      expect(h.auditRecords).toContainEqual(
        expect.objectContaining({ outcome: change === "revoke" ? "mandate-invalid" : "halted" }),
      );
    });
  }

  it("a signed revocation during lookup prevents a new claim", async () => {
    const h = harness();
    const e = await h.enqueue();
    h.prior(e);
    Object.assign(h.binding.send, {
      finalAbsence: true,
      lookup: async () => {
        h.statements.push(control("RevokeMandate", 0, { target: h.state.mandate?.id }));
        return { outcome: "absent" as const };
      },
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ reason: "mandate-invalid" });
    expect(h.records.get(e.proposal.id)).toMatchObject({ status: "not-sent", attempts: 1 });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });

  it.each([
    "decision",
    "token",
  ])("notifications invalidate a pending %s across executors", async (stage) => {
    const h = harness();
    const e = await h.enqueue();
    const observer = createExecutor(h.options);
    let notification: ReturnType<typeof observer.onControlOrMandateChange> | undefined;
    if (stage === "decision") {
      const original = h.proposals.writeDisposition;
      vi.spyOn(h.proposals, "writeDisposition").mockImplementation(async (id, result) => {
        await original(id, result);
        if (result.status === "ready" && !notification)
          notification = observer.onControlOrMandateChange();
      });
    } else {
      vi.mocked(h.options.tokens.send).mockImplementation(async () => {
        notification = observer.onControlOrMandateChange();
        await notification;
        return { access: "send", accessToken: "synthetic" };
      });
    }
    const provider = vi.fn();
    vi.mocked(h.binding.send.transmit).mockImplementation(async (_wire, io) => {
      await io.tokens.send(io.account);
      provider();
      return { outcome: "accepted", providerRef: "must-not-send" };
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({
      status: stage === "decision" ? "not-sent" : "uncertain",
    });
    await notification;
    await h.executor.drain();
    expect(provider).not.toHaveBeenCalled();
    if (stage === "decision") {
      expect(h.options.tokens.send).not.toHaveBeenCalled();
      expect(h.auditRecords).toContainEqual(
        expect.objectContaining({ outcome: "authority-changed" }),
      );
    }
  });
});
