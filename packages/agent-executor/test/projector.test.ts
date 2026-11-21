// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import * as execution from "../src/index.js";
import { harness } from "./helpers.js";

it("projects the gate's message and preview and binds the wire and account to approval", async () => {
  const h = harness();
  const { proposal, renderable } = await h.enqueue();
  const account = { id: "mailbox" };
  const sign = vi.fn(async () => ({ ok: true as const, renderable, preview: "Released terms" }));
  const project = execution.createOutboxProjector({
    bindings: h.options.bindings,
    accounts: { gmail: account },
    sign,
  });
  const entry = await project(proposal);
  expect(sign).toHaveBeenCalledWith(proposal);
  expect(entry).toMatchObject({
    account,
    renderable,
    wireDigest: entry.wire.digest,
    proposal: {
      renderedPreview: "Released terms",
      intent: { termsDigest: execution.proposalTermsDigest(entry) },
    },
  });
  expect(entry.proposal).not.toBe(proposal);
});

it("propagates a gate refusal before rendering", async () => {
  const h = harness();
  const { proposal } = await h.enqueue();
  const binding = h.options.bindings.gmail;
  if (!binding) throw new Error("Missing fixture binding");
  vi.mocked(binding.send.render).mockClear();
  const project = execution.createOutboxProjector({
    bindings: h.options.bindings,
    accounts: { gmail: { id: "mailbox" } },
    sign: async () => ({ ok: false, reason: "ask-principal" }),
  });
  const result = project(proposal);
  await expect(result).rejects.toBeInstanceOf(execution.ProposalRefusedError);
  await expect(result).rejects.toMatchObject({ reason: "ask-principal" });
  expect(binding.send.render).not.toHaveBeenCalled();
});

it.each(["binding", "account"] as const)("refuses a missing %s before signing", async (missing) => {
  const h = harness();
  const { proposal } = await h.enqueue();
  const sign = vi.fn();
  const project = execution.createOutboxProjector({
    bindings: missing === "binding" ? {} : h.options.bindings,
    accounts: missing === "account" ? {} : { gmail: { id: "mailbox" } },
    sign,
  });
  await expect(project(proposal)).rejects.toMatchObject({ reason: "unsupported-binding" });
  expect(sign).not.toHaveBeenCalled();
});
