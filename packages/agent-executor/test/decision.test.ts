// AUTHORED-BY Codex GPT-6.1-Sol
import { AGENT } from "@jeswr/agent-mandate";
import { canonicalJson, digestOf } from "@jeswr/agent-model";
import { describe, expect, it, vi } from "vitest";
import { createExecutor, proposalApprovalTerms, proposalTermsDigest } from "../src/index.js";
import { control, harness, NOW, seal, UNTIL } from "./helpers.js";

it("hashes body-free approval terms while binding every private proposal field", async () => {
  const h = harness();
  const entry = await h.enqueue();
  const terms = proposalApprovalTerms(entry);
  const approved = proposalTermsDigest(entry);
  expect(digestOf(terms)).toBe(approved);
  expect(terms.messageDigest).toBe(entry.wireDigest);
  expect(canonicalJson(terms)).not.toContain(entry.proposal.renderedPreview);
  expect(canonicalJson(terms)).not.toContain(entry.renderable.compactJws);
  for (const mutate of [
    (e: typeof entry) => {
      e.proposal.intent.parameters = { changed: true };
    },
    (e: typeof entry) => {
      e.proposal.renderedPreview += " changed";
    },
    (e: typeof entry) => {
      e.proposal.validUntil = NOW;
    },
    (e: typeof entry) => {
      Object.assign(e.renderable, { compactJws: "changed.signed.carrier" });
    },
    (e: typeof entry) => {
      Object.assign(e.renderable.message, { id: "urn:message:changed" });
    },
    (e: typeof entry) => {
      Object.assign(e.account, { id: "changed" });
    },
    (e: typeof entry) => {
      Object.assign(e, { wireDigest: digestOf("changed") });
    },
    (e: typeof entry) => {
      Object.assign(e.wire, { mediaType: "text/plain" });
    },
  ]) {
    const changed = structuredClone(entry);
    mutate(changed);
    expect(proposalTermsDigest(changed)).not.toBe(approved);
  }
  entry.proposal.intent.termsDigest = "excluded self-reference";
  expect(proposalTermsDigest(entry)).toBe(approved);
});

describe("DESIGN §4.1 ordered enforcement", () => {
  it("step 1: local halt runs before reading proposal or mandate", async () => {
    const h = harness();
    h.state.haltFile = true;
    const get = vi.spyOn(h.proposals, "get");
    expect(await h.executor.transmit("urn:missing")).toEqual({
      status: "refused",
      reason: "halted",
    });
    expect(get).not.toHaveBeenCalled();
    expect(h.options.mandates.load).not.toHaveBeenCalled();
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it.each([
    "haltFileExists",
    "listVerified",
  ] as const)("step 1: %s failure halts", async (method) => {
    const h = harness();
    vi.spyOn(h.controls, method).mockRejectedValue(new Error("unavailable"));
    expect(await h.executor.transmit("urn:missing")).toMatchObject({
      status: "refused",
      reason: "halted",
    });
  });
  it.each([
    "present",
    "unreadable",
  ])("step 1: local HALT becoming %s during the control read halts before proposal reads", async (change) => {
    const h = harness();
    const list = h.controls.listVerified;
    vi.spyOn(h.controls, "listVerified").mockImplementationOnce(async (owner) => {
      const result = await list(owner);
      if (change === "present") h.state.haltFile = true;
      else vi.spyOn(h.controls, "haltFileExists").mockRejectedValue(new Error("HALT unreadable"));
      return result;
    });
    const get = vi.spyOn(h.proposals, "get");
    expect(await h.executor.transmit("urn:missing")).toEqual({
      status: "refused",
      reason: "halted",
    });
    expect(get).not.toHaveBeenCalled();
    expect(h.options.mandates.load).not.toHaveBeenCalled();
    expect(h.options.tokens.send).not.toHaveBeenCalled();
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it("step 1: invalid clock fails closed", async () => {
    const h = harness();
    h.state.at = "invalid";
    await expect(h.executor.transmit("urn:missing")).rejects.toThrow();
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it("step 2: unknown proposal refuses", async () => {
    const h = harness();
    expect(await h.executor.transmit("urn:missing")).toMatchObject({ reason: "unknown-proposal" });
  });
  it.each([
    "wire",
    "digest",
    "mediaType",
    "terms",
    "id",
    "renderedDigest",
    "binding",
    "validation",
    "renderError",
    "hostile",
    "schema",
  ])("step 2: %s tampering emits tamper-suspected", async (change) => {
    const h = harness();
    const e = await h.enqueue();
    if (change === "wire") (e.wire as { bytes: string }).bytes = "altered";
    if (change === "digest") (e.wire as { digest: string }).digest = "forged";
    if (change === "mediaType") (e.wire as { mediaType: string }).mediaType = "text/plain";
    if (change === "terms") e.proposal.intent.amount.value = 999;
    if (change === "id") e.proposal.id = "urn:other";
    if (change === "renderedDigest")
      vi.mocked(h.binding.send.render).mockResolvedValue({ ...e.wire, digest: "forged" });
    if (change === "binding") Object.assign(h.options.bindings, { gmail: undefined });
    if (change === "validation")
      vi.mocked(h.binding.send.validate).mockResolvedValue({ ok: false, reason: "malformed" });
    if (change === "renderError")
      vi.mocked(h.binding.send.render).mockRejectedValue(new Error("invalid carrier"));
    if (change === "hostile")
      Object.defineProperty(e, "account", {
        enumerable: true,
        get() {
          throw new Error("getter must not run");
        },
      });
    if (change === "schema") e.proposal.intent.amount.value = -1;
    expect(await h.executor.transmit("urn:proposal:1")).toEqual({
      status: "refused",
      reason: "wire-mismatch",
    });
    expect(h.auditRecords).toContainEqual(expect.objectContaining({ type: "tamper-suspected" }));
    expect(h.options.mandates.load).not.toHaveBeenCalled();
  });
  it("step 2: mismatched registered binding id refuses", async () => {
    const h = harness();
    await h.enqueue();
    Object.assign(h.binding, { id: "other" });
    expect(await h.executor.transmit("urn:proposal:1")).toMatchObject({ reason: "wire-mismatch" });
  });
  it.each([
    ["unchanged", undefined],
    ["action", `${AGENT}Pay`],
    ["target", "urn:other-target"],
    ["binding", "direct"],
    ["recipientHash", "sha256:other-recipient"],
    ["amount", { value: 0, currency: "GBP" }],
    ["amount", { value: 100, currency: "EUR" }],
    ["purpose", "urn:other-purpose"],
    ["operation", "urn:other-operation"],
    ["operationVersion", "2"],
    ["parameters", { changed: true }],
    ["conversation", "urn:other-conversation"],
    ["account", { id: "urn:other-account" }],
  ] as const)("step 2: trusted validation binds %s to the carrier before policy", async (field, value) => {
    const h = harness();
    const e = await h.enqueue("urn:proposal:1", 100);
    const { termsDigest: _digest, ...signedIntent } = structuredClone(e.proposal.intent);
    if (e.renderable.message.kind !== "invoke") throw new Error("Expected synthetic invoke");
    // Synthetic signed-carrier payload: validation derives its action terms from the wire.
    Object.assign(e.renderable.message.body, {
      input: { intent: signedIntent, account: structuredClone(e.account) },
    });
    const wire = await h.binding.send.render(e.renderable, h.binding.carriage);
    Object.assign(e, { wire, wireDigest: wire.digest });
    vi.mocked(h.binding.send.validate).mockImplementation(async (wire, context) => {
      const { termsDigest: _digest, ...intent } = context.intent;
      const carrier = JSON.parse(wire.bytes);
      return canonicalJson(carrier.message.body.input) ===
        canonicalJson({ intent, account: context.account }) &&
        canonicalJson(carrier) === canonicalJson(context.renderable)
        ? { ok: true }
        : { ok: false, reason: "action-mismatch" };
    });
    if (field === "binding")
      Object.assign(h.options.bindings, { [value]: { ...h.binding, id: value } });
    if (field === "account") Object.assign(e.account, value);
    else if (field !== "unchanged") Object.assign(e.proposal.intent, { [field]: value });
    // An Actor can recompute the terms digest, but cannot change the signed carrier.
    seal(e);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject(
      field === "unchanged" ? { status: "sent" } : { status: "refused", reason: "wire-mismatch" },
    );
    expect(h.binding.send.validate).toHaveBeenCalledWith(e.wire, {
      renderable: e.renderable,
      intent: e.proposal.intent,
      account: e.account,
    });
    if (field !== "unchanged") {
      expect(h.options.mandates.load).not.toHaveBeenCalled();
      expect(h.binding.send.transmit).not.toHaveBeenCalled();
      expect(h.options.tokens.send).not.toHaveBeenCalled();
      expect(h.records.size).toBe(0);
      expect(h.auditRecords).toContainEqual(expect.objectContaining({ type: "tamper-suspected" }));
    }
  });
  it("step 3: expiry runs before mandate", async () => {
    const h = harness();
    const e = await h.enqueue();
    e.proposal.validUntil = "2026-10-30T00:00:00Z";
    seal(e);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ reason: "expired" });
    expect(h.options.mandates.load).not.toHaveBeenCalled();
  });
  it("step 3: expiry boundary is inclusive", async () => {
    const h = harness();
    const e = await h.enqueue();
    e.proposal.validUntil = NOW;
    seal(e);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
  });
  it.each([
    "absent",
    "throw",
    "wrong-owner",
    "wrong-agent",
    "expired",
    "future",
  ])("step 4: %s mandate refuses all", async (change) => {
    const h = harness();
    const e = await h.enqueue();
    if (change === "absent") h.state.mandate = undefined;
    if (change === "throw")
      vi.mocked(h.options.mandates.load).mockRejectedValue(new Error("revoked"));
    if (change === "wrong-owner")
      Object.assign(h.state.mandate as object, { issuer: "urn:attacker" });
    if (change === "wrong-agent")
      Object.assign(h.state.mandate as object, { subject: "urn:attacker" });
    if (change === "expired") Object.assign(h.state.mandate as object, { validUntil: NOW });
    if (change === "future") Object.assign(h.state.mandate as object, { validFrom: UNTIL });
    h.confirm(e);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({
      status: "refused",
      reason: "mandate-invalid",
    });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it("step 4: prohibition wins over an approval", async () => {
    const h = harness();
    const e = await h.enqueue();
    Object.assign(h.state.mandate as object, {
      prohibitions: [{ type: "prohibition", action: `${AGENT}SendMessage` }],
    });
    h.confirm(e);
    expect(await h.executor.transmit(e.proposal.id)).toEqual({
      status: "prohibited",
      reason: "prohibition",
    });
  });
  it.each([
    "withApproval",
    "indeterminate",
    "engine-error",
    "no-match",
  ])("step 5: %s queues without verified approval", async (effect) => {
    const h = harness();
    const e = await h.enqueue();
    h.needsApproval();
    if (effect === "indeterminate")
      Object.assign(h.options, {
        policy: { id: "test", evaluate: () => ({ effect: "indeterminate" }) },
      });
    if (effect === "engine-error")
      Object.assign(h.options, {
        policy: {
          id: "test",
          evaluate: () => {
            throw new Error("engine unavailable");
          },
        },
      });
    if (effect === "withApproval")
      Object.assign(h.state.mandate as object, {
        withApproval: {
          id: "urn:approval",
          permissions: [{ type: "permission", action: `${AGENT}SendMessage` }],
        },
      });
    expect(await h.executor.transmit(e.proposal.id)).toEqual({
      status: "awaiting-approval",
      reason: "approval-required",
    });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it.each([
    "unverified",
    "wrong-proposal",
    "wrong-terms",
    "expired",
    "invalid-decision",
  ])("step 5: %s approval cannot authorize", async (change) => {
    const h = harness();
    const e = await h.enqueue();
    h.needsApproval();
    h.confirm(e);
    const a = h.approvals[0] as NonNullable<(typeof h.approvals)[0]>;
    if (change === "unverified")
      vi.spyOn(h.approvalStore, "findVerified").mockRejectedValue(new Error("bad proof"));
    if (change === "wrong-proposal") Object.assign(a, { approves: "urn:other" });
    if (change === "wrong-terms") Object.assign(a, { termsDigest: "stale" });
    if (change === "expired") Object.assign(a, { expires: NOW });
    if (change === "invalid-decision") Object.assign(a, { decision: "other" });
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "awaiting-approval" });
  });
  it("step 5: changed terms cannot reuse approval, even after re-rendering", async () => {
    const h = harness();
    const e = await h.enqueue();
    h.needsApproval();
    h.confirm(e);
    e.proposal.intent.parameters = { changed: true };
    seal(e);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "awaiting-approval" });
    h.confirm(e);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
    expect(h.records.get(e.proposal.id)?.underApproval).toBe("urn:approval:1");
  });
  it.each([
    "autonomous",
    "confirm-required",
  ])("step 5: a verified deny overrides %s", async (policy) => {
    const h = harness();
    const e = await h.enqueue();
    if (policy === "confirm-required") h.needsApproval();
    h.confirm(e);
    h.confirm(e, "deny");
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({
      status: "refused",
      reason: "approval-denied",
    });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
    expect(h.options.tokens.send).not.toHaveBeenCalled();
    expect(h.records.size).toBe(0);
  });
  it.each([
    ["wrong-proposal", { approves: "urn:other-proposal" }],
    ["wrong-terms", { termsDigest: "stale" }],
    ["expired", { expires: NOW }],
    ["invalid-decision", { decision: "other" }],
  ])("step 5: %s denial cannot block autonomous permission", async (_change, patch) => {
    const h = harness();
    const e = await h.enqueue();
    h.confirm(e, "deny");
    Object.assign(h.approvals[0] as object, patch);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
    expect(h.records.get(e.proposal.id)?.underApproval).toBeUndefined();
  });
  it.each([
    "autonomous",
    "confirm-required",
  ])("step 5: %s waits when verified denials cannot be read", async (policy) => {
    const h = harness();
    const e = await h.enqueue();
    if (policy === "confirm-required") h.needsApproval();
    vi.spyOn(h.approvalStore, "findVerified").mockRejectedValueOnce(new Error("unavailable"));
    expect(await h.executor.transmit(e.proposal.id)).toEqual({
      status: "awaiting-approval",
      reason: "approval-unavailable",
    });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
    expect(h.options.tokens.send).not.toHaveBeenCalled();
    expect(h.records.size).toBe(0);
    if (policy === "confirm-required") h.confirm(e);
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
  });
  it("step 9: a new denial blocks queued autonomous work on re-evaluation", async () => {
    const h = harness();
    const a = await h.enqueue();
    const b = await h.enqueue("urn:proposal:2");
    h.confirm(a, "deny");
    expect(await h.executor.onControlOrMandateChange()).toEqual({
      [a.proposal.id]: { status: "refused", reason: "approval-denied" },
      [b.proposal.id]: { status: "ready", reason: "re-evaluated" },
    });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it("step 8: writes system outcome and conversation settlement with no body in audit", async () => {
    const h = harness();
    const e = await h.enqueue();
    e.proposal.state = "sent";
    expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
    expect(h.records.get(e.proposal.id)).toMatchObject({ status: "sent", attempts: 1 });
    expect([...h.settlements.values()][0]).toMatchObject({
      type: "transmission-settled",
      conversation: e.proposal.intent.conversation,
      proposal: e.proposal.id,
      status: "sent",
      final: true,
    });
    expect(JSON.stringify(h.auditRecords)).not.toContain(e.proposal.renderedPreview);
    expect(JSON.stringify(h.auditRecords)).not.toContain("synthetic-send-only");
  });
  it("defaults to dry-run and never acquires send credentials", async () => {
    const h = harness();
    const e = await h.enqueue();
    const { dryRun: _dryRun, ...options } = h.options;
    const executor = createExecutor(options);
    for (let runs = 0; runs < 4; runs++)
      expect(await executor.transmit(e.proposal.id)).toEqual({
        status: "ready",
        reason: "dry-run",
      });
    expect(h.options.tokens.send).not.toHaveBeenCalled();
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
    expect(h.records.size).toBe(0);
    expect(h.ledger).toEqual([]);
    expect(h.settlements.size).toBe(0);
    expect(await h.proposals.queued()).toEqual([e.proposal.id]);
    expect(await h.executor.runOutboxOnce()).toEqual({
      [e.proposal.id]: { status: "sent", reason: "sent" },
    });
    expect(h.records.get(e.proposal.id)?.attempts).toBe(1);
  });
  it.each([
    "attempting",
    "uncertain",
    "not-sent",
  ] as const)("explicit dry-run leaves existing %s history and recovery untouched", async (status) => {
    const h = harness();
    const e = await h.enqueue();
    const prior = h.prior(e, status, 3);
    h.binding.send.lookup = vi.fn(async () => ({
      outcome: "found" as const,
      providerRef: "lookup:1",
    }));
    expect(await createExecutor({ ...h.options, dryRun: true }).transmit(e.proposal.id)).toEqual({
      status: "ready",
      reason: "dry-run",
    });
    expect(h.records.get(e.proposal.id)).toEqual(prior);
    expect(h.binding.send.lookup).not.toHaveBeenCalled();
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
    expect(h.options.tokens.send).not.toHaveBeenCalled();
  });
  it("step 9: control and mandate changes re-evaluate EVERY queued item", async () => {
    const h = harness();
    const a = await h.enqueue();
    const b = await h.enqueue("urn:proposal:2");
    h.needsApproval();
    expect(
      Object.values(await h.executor.runOutboxOnce()).every(
        (r) => r.status === "awaiting-approval",
      ),
    ).toBe(true);
    h.state.mandate = undefined;
    expect(await h.executor.onControlOrMandateChange()).toEqual({
      [a.proposal.id]: { status: "refused", reason: "mandate-invalid" },
      [b.proposal.id]: { status: "refused", reason: "mandate-invalid" },
    });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
  it("step 9: signed revocation refuses a queued approved proposal", async () => {
    const h = harness();
    const e = await h.enqueue();
    h.needsApproval();
    await h.executor.runOutboxOnce();
    h.confirm(e);
    h.statements.push(control("RevokeMandate", 0, { target: h.state.mandate?.id }));
    expect((await h.executor.runOutboxOnce())[e.proposal.id]).toMatchObject({
      reason: "mandate-invalid",
    });
  });
  it("step 9: re-evaluation can mark ready without sending", async () => {
    const h = harness();
    await h.enqueue();
    expect(await h.executor.onControlOrMandateChange()).toMatchObject({
      "urn:proposal:1": { status: "ready" },
    });
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
  });
});

it("only unexpired verified owner controls may halt or resume; timestamp ties halt", async () => {
  const h = harness();
  const e = await h.enqueue();
  h.statements.push(
    control("Halt", 0, { expires: NOW }),
    control("Halt", 0, { attributedTo: "urn:attacker" }),
    control("Halt", 0, { createdAt: UNTIL }),
  );
  expect(await h.executor.onControlOrMandateChange()).toMatchObject({
    [e.proposal.id]: { status: "ready" },
  });
  h.statements.push(control("Halt", 0), control("Resume", 0));
  expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ reason: "halted" });
  h.statements.push(control("Resume", 1));
  expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "sent" });
});

it("property: for all 4^4 halt/resume/file control sequences no send begins while halted", async () => {
  for (let sequence = 0; sequence < 256; sequence++) {
    const h = harness();
    let halted = false;
    let local = false;
    let bits = sequence;
    for (let index = 0; index < 4; index++) {
      const action = bits % 4;
      bits = Math.floor(bits / 4);
      if (action === 0) {
        h.statements.push(control("Halt", index));
        halted = true;
      }
      if (action === 1) {
        h.statements.push(control("Resume", index));
        halted = false;
      }
      if (action === 2) local = true;
      if (action === 3) local = false;
      h.state.haltFile = local;
      const entry = await h.enqueue(`urn:proposal:${index}`);
      const before = vi.mocked(h.binding.send.transmit).mock.calls.length;
      await h.executor.transmit(entry.proposal.id);
      expect(vi.mocked(h.binding.send.transmit).mock.calls.length - before).toBe(
        halted || local ? 0 : 1,
      );
    }
  }
  // 256 exhaustive sequences each verify signed controls; CI runners take over 5 s.
}, 30_000);

it("a changed wire media type invalidates an earlier approval even with identical bytes", async () => {
  const h = harness();
  const e = await h.enqueue();
  h.needsApproval();
  h.confirm(e);
  Object.assign(e.wire, { mediaType: "application/ld+json" });
  vi.mocked(h.binding.send.render).mockResolvedValue(e.wire);
  seal(e);
  expect(await h.executor.transmit(e.proposal.id)).toMatchObject({ status: "awaiting-approval" });
});
