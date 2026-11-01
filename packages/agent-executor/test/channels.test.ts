// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createGmailSend } from "@jeswr/agent-channels/gmail/send";
import { createGraphMailSend } from "@jeswr/agent-channels/graph-mail/send";
import { createMatrixSend } from "@jeswr/agent-channels/matrix/send";
import { canonicalJson } from "@jeswr/agent-model";
import { expect, expectTypeOf, it, vi } from "vitest";
import { EMAIL_MIME, MATRIX_CONTENT } from "../../agent-channels/src/profiles.js";
import { createInMemoryDirectBinding } from "../../agent-channels/src/testing.js";
import {
  fixtureTransport,
  homeserver,
  roomId,
  userId,
} from "../../agent-channels/test/fixtures/matrix.js";
import { options, signed, verifyMessage } from "../../agent-channels/test/fixtures/signed.js";
import { parseEmail } from "../../agentic-legacy-bridge/src/email/parse.js";
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

it.each([
  "matrix",
  "graph-mail",
  "gmail",
] as const)("settles real %s acknowledgements and definitive refusals", async (bindingId) => {
  for (const accepted of [false, true]) {
    const h = harness(bindingId);
    const original = await h.enqueue();
    const recipient = "urn:recipient:fixture";
    const renderable = signed({ ...original.renderable.message, to: { actor: recipient } });
    const tokens = options().tokens;
    const read = vi.spyOn(tokens, "read").mockRejectedValue(new Error("no read capability"));
    const fake = fixtureTransport(
      bindingId === "matrix"
        ? accepted
          ? [[], { event_id: "$sent+event/with=padding:matrix.example" }]
          : [[{ type: "m.room.encryption", state_key: "", content: {} }]]
        : [
            new Response(
              bindingId === "gmail" && accepted ? JSON.stringify({ id: "18c9f2a0b1234567" }) : null,
              { status: accepted ? (bindingId === "gmail" ? 200 : 202) : 400 },
            ),
          ],
    );
    const common = {
      account: original.account,
      tokens,
      verify: verifyMessage,
      verifyApproval: vi.fn(async () => true),
      now: () => Date.parse(NOW),
      transport: fake.options,
    };
    const send =
      bindingId === "matrix"
        ? createMatrixSend({
            ...common,
            homeserver,
            userId,
            recipients: new Map([[recipient, roomId]]),
          })
        : (bindingId === "gmail" ? createGmailSend : createGraphMailSend)({
            ...common,
            from: "sender@example.test",
            recipients: new Map([[recipient, "recipient@example.test"]]),
            parseEmail,
          });
    const profile = bindingId === "matrix" ? MATRIX_CONTENT : EMAIL_MIME;
    const wire = await send.render(renderable, profile);
    const entry = { ...original, renderable, wire, wireDigest: wire.digest };
    seal(entry);
    h.entries.set(entry.proposal.id, entry);
    const executor = createExecutor({
      ...h.options,
      bindings: {
        [bindingId]: {
          id: bindingId,
          carriage: profile,
          send: {
            ...send,
            validate: (candidate, context) => send.validate(candidate, context.renderable),
          },
        },
      },
    });
    expect(await executor.transmit(entry.proposal.id)).toMatchObject({
      status: accepted ? "sent" : "not-sent",
    });
    expect(read).not.toHaveBeenCalled();
    expect(h.records.get(entry.proposal.id)?.status).toBe(accepted ? "sent" : "not-sent");
    if (accepted) {
      const providerRef = h.records.get(entry.proposal.id)?.providerRef;
      expect(providerRef).toMatch(
        bindingId === "matrix"
          ? /^\$/
          : bindingId === "gmail"
            ? /^[a-z0-9]+$/
            : /^<awp-[a-f0-9]{40}@awp-pilot\.invalid>$/,
      );
      expect(await executor.transmit(entry.proposal.id)).toEqual({
        status: "duplicate",
        providerRef,
      });
    }
  }
});
