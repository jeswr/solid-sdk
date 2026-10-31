// AUTHORED-BY Codex GPT-6.1-Sol
import { AGENT } from "@jeswr/agent-mandate";
import { describe, expect, it, vi } from "vitest";
import { createExecutor } from "../src/index.js";
import { control, harness, NOW, seal } from "./helpers.js";

describe("temporal authority", () => {
  for (const authority of [
    "proposal",
    "mandate",
    "approval",
    "control",
    "future-halt",
    "future-revoke",
    "permission",
    "prohibition",
  ] as const) {
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
      if (authority === "future-halt" || authority === "future-revoke")
        h.statements.push(
          control(authority === "future-halt" ? "Halt" : "RevokeMandate", 0, {
            createdAt: deadline,
            target: h.state.mandate?.id,
          }),
        );
      if (authority === "permission")
        Object.assign(h.state.mandate?.autonomous as object, {
          permissions: [
            {
              type: "permission",
              action: `${AGENT}SendMessage`,
              constraints: [{ leftOperand: "dateTime", operator: "lt", rightOperand: deadline }],
            },
          ],
        });
      if (authority === "prohibition")
        Object.assign(h.state.mandate as object, {
          prohibitions: [
            {
              type: "prohibition",
              action: `${AGENT}SendMessage`,
              constraints: [{ leftOperand: "dateTime", operator: "gteq", rightOperand: deadline }],
            },
          ],
        });
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

  it.each([
    "resume-expired",
    "halt-active",
    "revoke-active",
  ])("%s after the dispatch recheck prevents calling the binding", async (change) => {
    const h = harness();
    const e = await h.enqueue();
    const deadline = new Date(Date.parse(NOW) + 1000).toISOString();
    if (change === "resume-expired")
      h.statements.push(control("Halt", 0), control("Resume", 1, { expires: deadline }));
    else
      h.statements.push(
        control(change === "halt-active" ? "Halt" : "RevokeMandate", 0, {
          createdAt: deadline,
          target: h.state.mandate?.id,
        }),
      );
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

describe("final temporal transitions", () => {
  it.each([
    "with-approval-permission",
    "with-approval-prohibition",
    "duty",
    "obligation",
  ])("credential snapshots include temporal %s constraints", async (surface) => {
    const h = harness();
    const e = await h.enqueue();
    h.confirm(e);
    const boundary = new Date(Date.parse(NOW) + 1000).toISOString();
    const constraint = { leftOperand: "dateTime", operator: "lt", rightOperand: boundary };
    const permission = { type: "permission", action: `${AGENT}SendMessage` };
    const duty = { action: "inform", constraints: [constraint] };
    if (surface === "with-approval-permission") {
      h.needsApproval();
      Object.assign(h.state.mandate?.withApproval as object, {
        permissions: [{ ...permission, constraints: [constraint] }],
      });
    }
    if (surface === "with-approval-prohibition")
      Object.assign(h.state.mandate?.withApproval as object, {
        prohibitions: [
          {
            ...permission,
            type: "prohibition",
            constraints: [{ ...constraint, operator: "gteq" }],
          },
        ],
      });
    if (surface === "duty")
      Object.assign(h.state.mandate?.autonomous as object, {
        permissions: [{ ...permission, duties: [duty, { action: "inform" }] }],
      });
    if (surface === "obligation")
      Object.assign(h.state.mandate?.autonomous as object, {
        obligations: [duty, { action: "inform" }],
      });
    let credential = false;
    const write = h.proposals.writeDisposition;
    vi.spyOn(h.proposals, "writeDisposition").mockImplementation(async (id, result) => {
      await write(id, result);
      if (credential && result.status === "ready") h.state.at = boundary;
    });
    const provider = vi.fn();
    vi.mocked(h.binding.send.transmit).mockImplementation(async (_wire, io) => {
      credential = true;
      await io.tokens.send(io.account);
      provider();
      return { outcome: "accepted", providerRef: "must-not-send" };
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "uncertain" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("past policy boundaries and unrelated constraints do not expire a fresh evaluation", async () => {
    const h = harness();
    const e = await h.enqueue();
    Object.assign(h.state.mandate?.autonomous as object, {
      permissions: [
        {
          type: "permission",
          action: `${AGENT}SendMessage`,
          constraints: [
            { leftOperand: "purpose", operator: "eq", rightOperand: e.proposal.intent.purpose },
            {
              leftOperand: "dateTime",
              operator: "gt",
              rightOperand: "2026-10-31T11:00:00.000Z",
            },
          ],
        },
      ],
    });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
  });

  for (const stage of ["binding", "credential"] as const) {
    it.each([
      ["lt", "permission", 1000, 0],
      ["lteq", "permission", 0, 1],
      ["eq", "permission", 0, 1],
      ["neq", "permission", 1000, 0],
      ["gt", "prohibition", 1000, 1],
      ["gteq", "prohibition", 1000, 0],
      ["isAnyOf", "permission", 0, 1],
      ["isNoneOf", "permission", 1000, 0],
      ["isAllOf", "permission", 0, 1],
    ] as const)(`${stage} recheck expires across %s %s boundary`, async (operator, type, offset, after) => {
      const h = harness();
      const e = await h.enqueue();
      const boundary = new Date(Date.parse(NOW) + offset).toISOString();
      const rule = {
        type,
        action: `${AGENT}SendMessage`,
        constraints: [
          {
            leftOperand: "dateTime",
            operator,
            rightOperand: operator.startsWith("is") ? [boundary] : boundary,
          },
        ],
      };
      Object.assign(h.state.mandate?.autonomous as object, {
        [type === "permission" ? "permissions" : "prohibitions"]: [rule],
      });
      const exclusive = h.transmissions.exclusive;
      let credential = false;
      let scheduled = false;
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
            queueMicrotask(() =>
              queueMicrotask(() => {
                h.state.at = new Date(Date.parse(boundary) + after).toISOString();
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
      expect(scheduled).toBe(true);
      expect(provider).not.toHaveBeenCalled();
      expect(h.binding.send.transmit).toHaveBeenCalledTimes(stage === "binding" ? 0 : 1);
      expect(h.options.tokens.send).toHaveBeenCalledTimes(stage === "binding" ? 0 : 1);
    });
  }
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
