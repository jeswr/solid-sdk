// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { createExecutor } from "../src/index.js";
import { control, harness, NOW, seal } from "./helpers.js";

describe("temporal authority", () => {
  for (const authority of ["proposal", "mandate", "approval", "control"] as const) {
    it.each([
      "policy",
      "ledger",
      "claim",
      "token",
      "audit",
      "disposition",
      "controls",
      "handoff",
    ])(`${authority} expiry during %s prevents credential release`, async (stage) => {
      const h = harness();
      const e = await h.enqueue();
      const deadline = new Date(Date.parse(NOW) + 1000).toISOString();
      if (authority === "proposal") {
        e.proposal.validUntil = deadline;
        seal(e);
      }
      if (authority === "mandate")
        Object.assign(h.state.mandate as object, { validUntil: deadline });
      if (authority === "approval") {
        h.needsApproval();
        h.confirm(e);
        Object.assign(h.approvals[0] as object, { expires: deadline });
      }
      if (authority === "control")
        h.statements.push(control("Halt", 0), control("Resume", 1, { expires: deadline }));
      let checkingCredentials = false;
      const expire = () => {
        h.state.at = new Date(
          Date.parse(deadline) + (authority === "proposal" ? 1 : 0),
        ).toISOString();
      };
      if (stage === "policy") {
        const evaluate = h.options.policy.evaluate;
        Object.assign(h.options, {
          policy: {
            ...h.options.policy,
            evaluate: vi.fn(evaluate).mockImplementationOnce(async (...args) => {
              const result = await evaluate(...args);
              expire();
              return result;
            }),
          },
        });
      }
      if (stage === "ledger") {
        const list = h.audit.listCommitted;
        vi.spyOn(h.audit, "listCommitted").mockImplementationOnce(async () => {
          const result = await list();
          expire();
          return result;
        });
      }
      if (stage === "claim") {
        const put = h.transmissions.put;
        vi.spyOn(h.transmissions, "put").mockImplementationOnce(async (record) => {
          await put(record);
          expire();
        });
      }
      if (stage === "token") {
        vi.mocked(h.options.tokens.send).mockImplementationOnce(async () => {
          expire();
          return { access: "send", accessToken: "synthetic" };
        });
      }
      if (stage === "audit") {
        const append = h.audit.append;
        vi.spyOn(h.audit, "append").mockImplementation(async (record) => {
          await append(record);
          if (checkingCredentials && record.outcome === "re-evaluated") expire();
        });
      }
      if (stage === "disposition") {
        const write = h.proposals.writeDisposition;
        vi.spyOn(h.proposals, "writeDisposition").mockImplementation(async (id, result) => {
          await write(id, result);
          if (checkingCredentials && result.status === "ready") expire();
        });
      }
      if (stage === "controls") {
        const list = h.controls.listVerified;
        let checks = 0;
        vi.spyOn(h.controls, "listVerified").mockImplementation(async (owner) => {
          const result = await list(owner);
          // The last asynchronous control read of the credential recheck.
          if (checkingCredentials && ++checks === 3) expire();
          return result;
        });
      }
      if (stage === "handoff") {
        const exclusive = h.transmissions.exclusive;
        Object.assign(h.transmissions, {
          async exclusive<T>(work: () => Promise<T>): Promise<T> {
            const result = await exclusive(work);
            if (checkingCredentials) queueMicrotask(() => queueMicrotask(expire));
            return result;
          },
        });
      }
      const provider = vi.fn();
      vi.mocked(h.binding.send.transmit).mockImplementation(async (_wire, io) => {
        checkingCredentials = true;
        await io.tokens.send(io.account);
        provider();
        return { outcome: "accepted", providerRef: "must-not-send" };
      });
      const result = await h.executor.transmit(e.proposal.id);
      expect(result.status).not.toBe("sent");
      expect(provider).not.toHaveBeenCalled();
      if (stage === "policy" || stage === "ledger") expect(h.records.size).toBe(0);
    });
  }

  it.each([
    "resume-expired",
    "halt-active",
    "revoke-active",
    "halt-expired",
  ])("control validity uses the clock after loading: %s", async (change) => {
    const h = harness();
    const e = await h.enqueue();
    const deadline = new Date(Date.parse(NOW) + 1000).toISOString();
    if (change === "resume-expired")
      h.statements.push(control("Halt", 0), control("Resume", 1, { expires: deadline }));
    if (change === "halt-active") h.statements.push(control("Halt", 0, { createdAt: deadline }));
    if (change === "revoke-active")
      h.statements.push(
        control("RevokeMandate", 0, {
          createdAt: deadline,
          target: h.state.mandate?.id,
        }),
      );
    if (change === "halt-expired") h.statements.push(control("Halt", 0, { expires: deadline }));
    const list = h.controls.listVerified;
    vi.spyOn(h.controls, "listVerified").mockImplementationOnce(async (owner) => {
      const result = await list(owner);
      h.state.at = deadline;
      return result;
    });
    const proposal = vi.spyOn(h.proposals, "get");
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject(
      change === "halt-expired"
        ? { status: "sent" }
        : { status: "refused", reason: change === "revoke-active" ? "mandate-invalid" : "halted" },
    );
    if (change === "resume-expired" || change === "halt-active") {
      expect(proposal).not.toHaveBeenCalled();
      expect(h.options.mandates.load).not.toHaveBeenCalled();
    }
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(change === "halt-expired" ? 1 : 0);
    expect(h.options.tokens.send).toHaveBeenCalledTimes(change === "halt-expired" ? 1 : 0);
  });

  it("Resume expiry after the dispatch recheck prevents calling the binding", async () => {
    const h = harness();
    const e = await h.enqueue();
    const deadline = new Date(Date.parse(NOW) + 1000).toISOString();
    h.statements.push(control("Halt", 0), control("Resume", 1, { expires: deadline }));
    const exclusive = h.transmissions.exclusive;
    let scheduled = false;
    Object.assign(h.transmissions, {
      async exclusive<T>(work: () => Promise<T>): Promise<T> {
        const result = await exclusive(work);
        if (
          !scheduled &&
          result &&
          typeof result === "object" &&
          "status" in result &&
          result.status === "ready"
        ) {
          scheduled = true;
          queueMicrotask(() =>
            queueMicrotask(() => {
              h.state.at = deadline;
            }),
          );
        }
        return result;
      },
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "not-sent" });
    expect(scheduled).toBe(true);
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
    expect(h.options.tokens.send).not.toHaveBeenCalled();
  });
});

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

  it.each([
    "binding",
    "credential",
  ])("notification after the %s recheck invalidates its result", async (stage) => {
    const h = harness();
    const e = await h.enqueue();
    const observer = createExecutor(h.options);
    const exclusive = h.transmissions.exclusive;
    let credential = false;
    let scheduled = false;
    let notification: ReturnType<typeof observer.onControlOrMandateChange> | undefined;
    Object.assign(h.transmissions, {
      async exclusive<T>(work: () => Promise<T>): Promise<T> {
        const result = await exclusive(work);
        if (
          !scheduled &&
          (stage === "binding" || credential) &&
          result &&
          typeof result === "object" &&
          "status" in result &&
          result.status === "ready"
        ) {
          scheduled = true;
          // Notify after recheck returns, before its caller resumes to dispatch or release a grant.
          queueMicrotask(() =>
            queueMicrotask(() => {
              notification = observer.onControlOrMandateChange();
            }),
          );
        }
        return result;
      },
    });
    const provider = vi.fn();
    vi.mocked(h.binding.send.transmit).mockImplementation(async (_wire, io) => {
      credential = true;
      await io.tokens.send(io.account);
      provider();
      return { outcome: "accepted", providerRef: "must-not-send" };
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({
      status: stage === "binding" ? "not-sent" : "uncertain",
    });
    await notification;
    await h.executor.drain();
    expect(scheduled).toBe(true);
    expect(provider).not.toHaveBeenCalled();
    expect(h.binding.send.transmit).toHaveBeenCalledTimes(stage === "binding" ? 0 : 1);
  });
});
