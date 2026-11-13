// AUTHORED-BY Codex GPT-6.1-Sol
import { createEmailRenderer } from "@jeswr/agent-channels/email-mime/send";
import { expect, it, vi } from "vitest";
import { parseMime } from "../../agent-channels/src/email/mime.js";
import { EMAIL_MIME } from "../../agent-channels/src/profiles.js";
import { signed, verifyMessage } from "../../agent-channels/test/fixtures/signed.js";
import { createExecutor } from "../src/index.js";
import type { LookupResult, SendResult } from "../src/types.js";
import { harness, NOW, seal } from "./helpers.js";

it.each([
  "matching",
  "one-character",
  "html",
  "empty",
  "throwing",
])("checks the approved %s email preview before mandate, approvals, credentials or transport", async (kind) => {
  const h = harness();
  const entry = await h.enqueue();
  const message = { ...entry.renderable.message, to: { actor: "urn:recipient" } };
  const renderable = signed(message);
  const send = createEmailRenderer({
    from: "sender@example.test",
    recipients: new Map([["urn:recipient", "recipient@example.test"]]),
    verify: verifyMessage,
    now: () => Date.parse(NOW),
  });
  const wire = await send.render(renderable, EMAIL_MIME);
  Object.assign(entry, { wire, wireDigest: wire.digest, renderable });
  const expected = await send.preview(wire);
  const tree = parseMime(wire.bytes);
  if (!tree.ok) throw new Error("Expected rendered MIME");
  const html = tree.root.children?.[0]?.children?.[1]?.text;
  if (typeof html !== "string") throw new Error("Expected HTML part");
  entry.proposal.renderedPreview =
    kind === "one-character"
      ? `${expected.slice(0, -1)}!`
      : kind === "html"
        ? html
        : kind === "empty"
          ? ""
          : expected;
  seal(entry);
  h.needsApproval();
  h.confirm(entry);
  const preview = vi.fn(
    kind === "throwing"
      ? async () => {
          throw new Error("private parser detail");
        }
      : send.preview,
  );
  const binding = {
    ...h.binding,
    carriage: EMAIL_MIME,
    send: {
      ...h.binding.send,
      render: send.render,
      preview,
      validate: (wire: typeof entry.wire, context: { renderable: typeof renderable }) =>
        send.validate(wire, context.renderable),
    },
  };
  const approval = vi.spyOn(h.options.approvals, "findVerified");
  const executor = createExecutor({ ...h.options, bindings: { gmail: binding } });
  const result = await executor.transmit(entry.proposal.id);
  if (kind === "matching") {
    expect(result).toMatchObject({ status: "sent" });
    expect(h.binding.send.transmit).toHaveBeenCalledOnce();
    expect(h.options.tokens.send).toHaveBeenCalledOnce();
  } else {
    expect(result).toEqual({ status: "refused", reason: "preview-mismatch" });
    expect(h.dispositions.get(entry.proposal.id)).toEqual(result);
    expect(h.binding.send.transmit).not.toHaveBeenCalled();
    expect(h.options.tokens.send).not.toHaveBeenCalled();
    expect(h.options.mandates.load).not.toHaveBeenCalled();
    expect(approval).not.toHaveBeenCalled();
    expect(h.records.size).toBe(0);
    expect(h.settlements.size).toBe(0);
    expect(h.auditRecords).toEqual([
      {
        type: "tamper-suspected",
        proposal: entry.proposal.id,
        at: NOW,
        outcome: "preview-mismatch",
      },
      { type: "decision", proposal: entry.proposal.id, at: NOW, outcome: "preview-mismatch" },
    ]);
    expect(JSON.stringify(h.auditRecords)).not.toContain("private parser detail");
  }
});

it.each(["halt", "wire"])("preserves the %s gate before preview parsing", async (stage) => {
  const h = harness();
  const entry = await h.enqueue();
  vi.mocked(h.binding.send.preview).mockClear();
  if (stage === "halt") h.state.haltFile = true;
  else vi.mocked(h.binding.send.validate).mockResolvedValue({ ok: false, reason: "malformed" });
  expect(await h.executor.transmit(entry.proposal.id)).toEqual({
    status: "refused",
    reason: stage === "halt" ? "halted" : "wire-mismatch",
  });
  expect(h.binding.send.preview).not.toHaveBeenCalled();
});

it.each([
  "retry",
  "final-absence",
  "a2a-resend",
])("rechecks the preview before a %s without consuming a new attempt", async (kind) => {
  const h = harness(kind === "a2a-resend" ? "a2a" : "gmail");
  const entry = await h.enqueue();
  const send = vi.mocked(h.binding.send.transmit);
  if (kind === "retry") send.mockResolvedValueOnce({ outcome: "rejected", detail: "refused" });
  else send.mockRejectedValueOnce(new Error("ambiguous send"));
  Object.assign(
    h.binding.send,
    kind === "final-absence"
      ? {
          finalAbsence: true,
          lookup: vi.fn(async (): Promise<LookupResult> => ({ outcome: "absent" })),
        }
      : kind === "a2a-resend"
        ? { idempotentResend: true }
        : {},
  );
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({
    status: kind === "retry" ? "not-sent" : "uncertain",
  });
  const previous = structuredClone(h.records.get(entry.proposal.id));
  send.mockClear();
  vi.mocked(h.options.tokens.send).mockClear();
  vi.mocked(h.options.mandates.load).mockClear();
  vi.mocked(h.binding.send.preview).mockClear().mockResolvedValue("changed parser projection");
  expect(await h.executor.transmit(entry.proposal.id)).toEqual({
    status: "refused",
    reason: "preview-mismatch",
  });
  expect(h.binding.send.preview).toHaveBeenCalledExactlyOnceWith(entry.wire);
  expect(send).not.toHaveBeenCalled();
  expect(h.options.tokens.send).not.toHaveBeenCalled();
  expect(h.options.mandates.load).not.toHaveBeenCalled();
  expect(h.records.get(entry.proposal.id)).toEqual(previous);
  // The same approved wire can still pass a fresh parse and use the existing retry rules.
  vi.mocked(h.binding.send.preview).mockImplementation(async (wire) => wire.bytes);
  send.mockResolvedValue({ outcome: "accepted", providerRef: "test:retry" } satisfies SendResult);
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({ status: "sent" });
  expect(send).toHaveBeenCalledOnce();
  expect(h.records.get(entry.proposal.id)?.attempts).toBe(2);
});

it("rechecks after a lookup await and before retry dispatch", async () => {
  const h = harness();
  const entry = await h.enqueue();
  h.prior(entry);
  Object.assign(h.binding.send, {
    finalAbsence: true,
    lookup: async () => {
      vi.mocked(h.binding.send.preview).mockResolvedValue("changed while looking up");
      return { outcome: "absent" };
    },
  });
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({ status: "not-sent" });
  expect(h.auditRecords).toContainEqual(
    expect.objectContaining({ type: "tamper-suspected", outcome: "preview-mismatch" }),
  );
  expect(h.binding.send.transmit).not.toHaveBeenCalled();
  expect(h.options.tokens.send).not.toHaveBeenCalled();
});
