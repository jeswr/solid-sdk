// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { control, deferred, harness, NOW } from "./helpers.js";

it("reports verified Halt and local HALT ahead of Resume, with no authority reads while stopped", async () => {
  const h = harness();
  expect(await h.executor.status()).toBe("running");
  h.statements.push(control("Halt", 0));
  expect(await h.executor.status()).toBe("stopped");
  h.statements.push(control("Resume", 1));
  h.options.clock.now = () => new Date(Date.parse(NOW) + 2);
  h.state.haltFile = true;
  vi.mocked(h.options.mandates.load).mockClear();
  expect(await h.executor.status()).toBe("stopped");
  expect(h.options.mandates.load).not.toHaveBeenCalled();
  h.state.haltFile = false;
  expect(await h.executor.status()).toBe("running");
});
it("reports paused for missing, unverifiable, expired, future, wrong-owner/agent or revoked permission", async () => {
  const h = harness();
  const original = h.state.mandate;
  if (!original) throw new Error("Missing fixture permission");
  for (const mandate of [
    undefined,
    { ...original, issuer: "urn:attacker" },
    { ...original, subject: "urn:other-agent" },
    { ...original, validFrom: "invalid" },
    { ...original, validUntil: NOW },
  ]) {
    h.state.mandate = mandate;
    expect(await h.executor.status()).toBe("paused");
  }
  h.state.mandate = original;
  h.statements.push(control("RevokeMandate", 0, { target: "urn:other" }));
  expect(await h.executor.status()).toBe("running");
  h.statements.push(control("RevokeMandate", 0, { target: original.id }));
  expect(await h.executor.status()).toBe("paused");
  vi.mocked(h.options.mandates.load).mockRejectedValueOnce(new Error("unavailable"));
  expect(await h.executor.status()).toBe("paused");
});

it.each([
  "halt",
  "unreadable",
])("refuses %s local state after token release and transport waits without a poll", async (failure) => {
  const h = harness();
  const entry = await h.enqueue();
  const grant = deferred<void>();
  const transport = deferred<void>();
  const effect = vi.fn();
  vi.mocked(h.binding.send.transmit).mockImplementationOnce(async (_wire, io) => {
    await io.tokens.send(io.account);
    grant.resolve();
    await transport.promise;
    io.assertAuthority();
    effect();
    return { outcome: "accepted", providerRef: "test:1" };
  });
  const pending = h.executor.transmit(entry.proposal.id);
  await grant.promise;
  if (failure === "halt") h.state.haltFile = true;
  else
    vi.spyOn(h.controls, "assertNotHalted").mockImplementationOnce(() => {
      throw new Error("unreadable");
    });
  transport.resolve();
  expect(await pending).toMatchObject({ status: "not-sent" });
  expect(effect).not.toHaveBeenCalled();
});
