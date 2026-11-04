// AUTHORED-BY Codex GPT-6
import { ProviderRejectedError, SendNotDispatchedError } from "@jeswr/agent-channels/provider/send";
import { AGENT } from "@jeswr/agent-mandate";
import { expect, it, vi } from "vitest";
import { createExecutor } from "../src/index.js";
import { providerResult } from "../src/transmission.js";
import type { AccountingMandate, SendResult } from "../src/types.js";
import { deferred, harness } from "./helpers.js";

const references = [
  ["gmail", "18c9f2a0b1234567"],
  ["graph-mail", `<awp-${"a1".repeat(20)}@awp-pilot.invalid>`],
  ["graph-mail", "AAMkAGI2+/AAABBB=="],
  ["graph-mail", `${"A".repeat(2046)}+=`],
  ["mastodon", "112345678901234567"],
  ["matrix", "$uZQqZmbNxKo-zrv_R7NCb+Q/2="],
  ["matrix", "$event:matrix.example:8448"],
  ["matrix", `$${"a".repeat(254)}`],
  ["discord", "1234567890123456789"],
  ["direct", `direct:sha-256:${"a".repeat(64)}`],
  ["testing", "test:1"],
] as const;

it.each(
  references,
)("persists %s acknowledgement %s and reconciles the same lookup shape", async (binding, providerRef) => {
  const h = harness(binding);
  const entry = await h.enqueue();
  vi.mocked(h.binding.send.transmit).mockResolvedValue({ outcome: "accepted", providerRef });
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({ status: "sent" });
  expect(h.records.get(entry.proposal.id)?.providerRef).toBe(providerRef);
  expect(await h.executor.transmit(entry.proposal.id)).toEqual({
    status: "duplicate",
    providerRef,
  });
  // Exercise the recovery path independently of successful-send evidence.
  h.records.clear();
  h.ledger.length = 0;
  h.prior(entry);
  h.binding.send.lookup = vi.fn(async () => ({ outcome: "found" as const, providerRef }));
  expect(await createExecutor(h.options).transmit(entry.proposal.id)).toMatchObject({
    status: "sent",
  });
  expect(h.records.get(entry.proposal.id)?.providerRef).toBe(providerRef);
  expect(h.binding.send.transmit).toHaveBeenCalledOnce();
});

it.each([
  "",
  "bad ref",
  "test:1\n",
  "$event\r",
  "$event\t",
  "$event\0",
  "$event\x1b",
  "$event\x7f",
  "$event\u0085",
  "$event\u2028",
  "$event\u00a0",
  "$évent",
  "a".repeat(2049),
  `$${"a".repeat(255)}`,
  "<other@example.org>",
  `<awp-${"a".repeat(41)}@awp-pilot.invalid>`,
])("refuses unsafe or unsupported provider reference %j on both paths", (providerRef) => {
  expect(providerResult({ outcome: "accepted", providerRef }, false)).toBe("unknown");
  expect(providerResult({ outcome: "found", providerRef }, true)).toBe("unknown");
});

it.each([
  false,
  true,
])("typed refusal releases a new commitment and allows an authorized retry, grant released=%s", async (releaseGrant) => {
  const h = harness("matrix");
  const entry = await h.enqueue("urn:refused", 10);
  h.needsApproval();
  h.confirm(entry);
  h.state.mandate = {
    ...(h.state.mandate as AccountingMandate),
    limits: [
      {
        leftOperand: `${AGENT}spendPerDay`,
        operator: "lteq",
        rightOperand: 10,
        enforcement: "hard",
      },
    ],
  };
  vi.mocked(h.binding.send.transmit).mockImplementationOnce(async (_wire, io) => {
    if (releaseGrant) await io.tokens.send(io.account);
    throw new ProviderRejectedError("PRIVATE_PROVIDER_TEXT");
  });
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({ status: "not-sent" });
  expect(h.records.get(entry.proposal.id)).toMatchObject({ status: "not-sent", attempts: 1 });
  expect([...h.settlements.values()][0]).toMatchObject({ status: "not-sent", final: false });
  expect(JSON.stringify(h.auditRecords)).not.toContain("PRIVATE_PROVIDER_TEXT");
  // A different proposal can use the released budget; then retry still rechecks the cap.
  const next = await h.enqueue("urn:next", 10);
  h.confirm(next);
  expect(await h.executor.transmit(next.proposal.id)).toMatchObject({ status: "sent" });
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({
    reason: "limit:spendPerDay",
  });
  h.state.at = "2026-11-01T12:00:00.000Z";
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({ status: "sent" });
  expect(h.records.get(entry.proposal.id)?.attempts).toBe(2);
});

it.each([
  "ProviderRejectedError",
  "SendNotDispatchedError",
])("does not recognize %s by name or release an ambiguous commitment", async (name) => {
  const h = harness();
  const entry = await h.enqueue("urn:ambiguous", 10);
  vi.mocked(h.binding.send.transmit).mockRejectedValue(
    Object.assign(new Error("HTTP 500 PRIVATE_PROVIDER_TEXT"), { name }),
  );
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({ status: "uncertain" });
  expect(h.records.get(entry.proposal.id)).toMatchObject({
    status: "uncertain",
    amount: { value: 10 },
  });
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({ status: "uncertain" });
  expect(h.binding.send.transmit).toHaveBeenCalledOnce();
  expect(JSON.stringify(h.auditRecords)).not.toContain("PRIVATE_PROVIDER_TEXT");
  h.state.mandate = {
    ...(h.state.mandate as AccountingMandate),
    limits: [
      {
        leftOperand: `${AGENT}spendPerDay`,
        operator: "lteq",
        rightOperand: 10,
        enforcement: "hard",
      },
    ],
  };
  const next = await h.enqueue("urn:next", 1);
  expect(await h.executor.transmit(next.proposal.id)).toMatchObject({
    reason: "limit:spendPerDay",
  });
  expect(h.binding.send.transmit).toHaveBeenCalledOnce();
});

it.each([
  false,
  true,
])("local pre-dispatch refusal preserves prior uncertainty, resend=%s", async (resend) => {
  const h = harness(resend ? "a2a" : "discord");
  const entry = await h.enqueue("urn:local-refusal", 10);
  if (resend) {
    h.prior(entry);
    Object.assign(h.binding.send, { idempotentResend: true });
  }
  vi.mocked(h.binding.send.transmit).mockImplementation(async (_wire, io) => {
    await io.tokens.send(io.account);
    throw new SendNotDispatchedError(new Error("PRIVATE_LOCAL_TEXT"));
  });
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({
    status: resend ? "uncertain" : "not-sent",
  });
  expect(h.records.get(entry.proposal.id)?.status).toBe(resend ? "uncertain" : "not-sent");
  expect(JSON.stringify(h.auditRecords)).not.toContain("PRIVATE_LOCAL_TEXT");
});

it("recognizes typed refusal subclasses while retaining the three-attempt bound", async () => {
  class SetupRefused extends ProviderRejectedError {}
  const h = harness();
  const entry = await h.enqueue();
  vi.mocked(h.binding.send.transmit).mockRejectedValue(new SetupRefused("PRIVATE_PROVIDER_TEXT"));
  for (let attempt = 1; attempt <= 3; attempt++) {
    expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({ status: "not-sent" });
    expect(h.records.get(entry.proposal.id)?.attempts).toBe(attempt);
    expect([...h.settlements.values()][0]).toMatchObject({ final: attempt === 3 });
  }
  expect(await h.executor.transmit(entry.proposal.id)).toMatchObject({ reason: "attempt-limit" });
  expect(h.binding.send.transmit).toHaveBeenCalledTimes(3);
});

it("late typed refusal cannot downgrade concurrent positive delivery evidence", async () => {
  vi.useFakeTimers();
  try {
    const h = harness("matrix");
    const entry = await h.enqueue();
    const pending = deferred<SendResult>();
    vi.mocked(h.binding.send.transmit).mockReturnValue(pending.promise);
    const executor = createExecutor({ ...h.options, timeoutMs: 10 });
    const sending = executor.transmit(entry.proposal.id);
    await vi.advanceTimersByTimeAsync(10);
    expect(await sending).toMatchObject({ status: "uncertain" });
    const record = h.records.get(entry.proposal.id);
    h.records.set(entry.proposal.id, {
      ...(record as NonNullable<typeof record>),
      status: "sent",
      providerRef: "$delivered",
    });
    pending.reject(new ProviderRejectedError("PRIVATE_PROVIDER_TEXT"));
    await executor.drain();
    expect(h.records.get(entry.proposal.id)).toMatchObject({
      status: "sent",
      providerRef: "$delivered",
    });
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  false,
  true,
])("late typed refusal settles only its own attempt, A2A resend=%s", async (resend) => {
  vi.useFakeTimers();
  try {
    const h = harness(resend ? "a2a" : "matrix");
    const entry = await h.enqueue("urn:late-refusal", 10);
    if (resend) {
      h.prior(entry);
      Object.assign(h.binding.send, { idempotentResend: true });
    }
    const pending = deferred<SendResult>();
    vi.mocked(h.binding.send.transmit).mockReturnValue(pending.promise);
    const executor = createExecutor({ ...h.options, timeoutMs: 10 });
    const sending = executor.transmit(entry.proposal.id);
    await vi.advanceTimersByTimeAsync(10);
    expect(await sending).toMatchObject({ status: "uncertain" });
    pending.reject(new ProviderRejectedError("PRIVATE_PROVIDER_TEXT"));
    await executor.drain();
    expect(h.records.get(entry.proposal.id)?.status).toBe(resend ? "uncertain" : "not-sent");
  } finally {
    vi.useRealTimers();
  }
});
