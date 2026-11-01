// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalJson } from "@jeswr/agent-model";
import { expect, expectTypeOf, it, vi } from "vitest";
import { createInMemoryDirectBinding } from "../../agent-channels/src/testing.js";
import { options, signed } from "../../agent-channels/test/fixtures/signed.js";
import { createExecutor } from "../src/index.js";
import type { ExecutorOptions, OutboxEntry } from "../src/types.js";
import { harness, NOW, seal } from "./helpers.js";

it("registers a channel send half with only the trusted validation adapter", async () => {
  const h = harness("direct");
  const original = await h.enqueue();
  const config = { ...options(), now: () => Date.parse(NOW) };
  const channel = createInMemoryDirectBinding(config);
  const renderable = signed(original.renderable.message);
  const wire = await channel.send.render(renderable, channel.carriage);
  const entry: OutboxEntry = { ...original, renderable, wire, wireDigest: wire.digest };
  seal(entry);
  h.entries.set(entry.proposal.id, entry);

  // This trusted fixture authorizes exactly these action terms and destination.
  const authorized = canonicalJson({ intent: entry.proposal.intent, account: entry.account });
  const transmit = vi.spyOn(channel.send, "transmit");
  const bindings: ExecutorOptions["bindings"] = {
    direct: {
      id: channel.id,
      carriage: channel.carriage,
      send: {
        ...channel.send,
        async validate(candidate, context) {
          if (canonicalJson({ intent: context.intent, account: context.account }) !== authorized)
            return { ok: false, reason: "terms-digest-mismatch" };
          return channel.send.validate(candidate, context.renderable);
        },
      },
    },
  };
  expectTypeOf<
    keyof Parameters<typeof channel.send.transmit>[1]["tokens"]
  >().toEqualTypeOf<"send">();

  const executor = createExecutor({ ...h.options, bindings });
  expect(await executor.transmit(entry.proposal.id)).toMatchObject({ status: "sent" });
  expect(transmit).toHaveBeenCalledTimes(1);
  const io = transmit.mock.calls[0]?.[1];
  expect(Object.keys(io?.tokens ?? {})).toEqual(["send"]);
  expect(h.options.tokens.send).toHaveBeenCalledExactlyOnceWith(entry.account);
  expect(config.tokens.calls).toEqual([]);
  expect(await channel.send.lookup?.(wire)).toEqual({
    outcome: "found",
    providerRef: `direct:${wire.digest}`,
  });
  expect(await executor.transmit(entry.proposal.id)).toMatchObject({ status: "duplicate" });
  expect(transmit).toHaveBeenCalledTimes(1);
});
