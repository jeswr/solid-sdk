// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { ChannelParseError, ProviderRejectedError, SendNotDispatchedError } from "../src/errors.js";
import { sendAttempt } from "../src/provider/attempt.js";

it.each([
  new ChannelParseError("invalid local wire"),
  new Error("local failure"),
  undefined,
])("identifies local non-delivery and preserves the original cause (%s)", async (cause) => {
  await expect(
    sendAttempt(async () => {
      throw cause;
    }),
  ).rejects.toMatchObject({
    constructor: SendNotDispatchedError,
    cause,
  });
});

it.each([false, true])("preserves definitive provider refusals, dispatched=%s", async (issued) => {
  const refusal = new ProviderRejectedError("provider refusal");
  await expect(
    sendAttempt(async (dispatched) => {
      if (issued) dispatched();
      throw refusal;
    }),
  ).rejects.toBe(refusal);
});

it("does not relabel a provider response parse failure as non-delivery", async () => {
  const failure = new ChannelParseError("invalid provider response");
  await expect(
    sendAttempt(async (dispatched) => {
      dispatched();
      throw failure;
    }),
  ).rejects.toBe(failure);
});
