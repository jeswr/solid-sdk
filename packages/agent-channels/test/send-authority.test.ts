// AUTHORED-BY Codex GPT-6
import { createGuardedFetch } from "@jeswr/guarded-fetch";
import { expect, it, vi } from "vitest";
import { parseEmail } from "../../agentic-legacy-bridge/src/email/parse.js";
import { createDirectSend } from "../src/direct/send.js";
import { createDiscordSend } from "../src/discord/send.js";
import { ChannelParseError, ProviderRejectedError, SendNotDispatchedError } from "../src/errors.js";
import { createGmailSend } from "../src/gmail/send.js";
import { createGraphMailSend } from "../src/graph-mail/send.js";
import { createMastodonSend } from "../src/mastodon/send.js";
import { createMatrixSend } from "../src/matrix/send.js";
import type { OriginFetchOptions } from "../src/origins.js";
import {
  DIRECT,
  DISCORD_FOOTER,
  EMAIL_MIME,
  MASTODON_FOOTER,
  MATRIX_CONTENT,
} from "../src/profiles.js";
import { RecordingTokenProvider } from "../src/testing.js";
import { fixtureTransport, homeserver, roomId, userId } from "./fixtures/matrix.js";
import { account, at, message, signed, verifyMessage } from "./fixtures/signed.js";

for (const binding of ["gmail", "graph-mail", "mastodon", "matrix", "discord"] as const) {
  const stages =
    binding === "matrix"
      ? ["approval", "approval-return", "credentials", "room-state"]
      : binding === "discord"
        ? ["approval", "credentials"]
        : ["approval", "approval-return", "credentials"];
  stages.push(
    "dns",
    "inner-dns",
    "expiry-approval",
    "expiry-dns",
    "expiry-inner-dns",
    "approval-error",
    "credentials-error",
    "dns-error",
    "inner-dns-error",
  );
  if (binding === "matrix")
    stages.push("send-dns", "send-inner-dns", "expiry-send-dns", "expiry-send-inner-dns");
  it.each(stages)(`${binding} refuses %s with zero send requests`, async (stage) => {
    let clock = at;
    let halted = false;
    const assertAuthority = vi.fn(() => {
      if (halted) throw new ProviderRejectedError("HALT invalidated executor authority");
    });
    const tokens = new RecordingTokenProvider();
    const sendGrant = vi.spyOn(tokens, "send").mockImplementation(async () => {
      if (stage === "credentials") halted = true;
      if (stage === "credentials-error") throw new Error("credential unavailable");
      return { access: "send", accessToken: "synthetic-send" };
    });
    const read = vi.spyOn(tokens, "read").mockRejectedValue(new Error("no read authority"));
    const verifyApproval = vi.fn(async () => {
      if (stage === "expiry-approval") clock = Date.parse(message.expiresAt);
      if (stage === "approval-error") throw new Error("approval unavailable");
      if (stage.startsWith("approval")) {
        queueMicrotask(() => {
          // Also cover invalidation after verification returns, before beforeRequest resumes.
          if (stage === "approval-return")
            queueMicrotask(() => {
              halted = true;
            });
          else halted = true;
        });
      }
      return true;
    });
    const fake = fixtureTransport([[]]); // Matrix's send-scope room-state preflight only.
    const transport = fake.transport.getMockImplementation();
    if (!transport) throw new Error("missing fixture transport");
    fake.transport.mockImplementation(async (input, init) => {
      const response = await transport(input, init);
      if (stage === "room-state") halted = true;
      return response;
    });
    const preflight = async (layer: "dns" | "inner-dns", call: number) => {
      if (stage === layer || (stage === `send-${layer}` && call === 2)) halted = true;
      if (stage === `expiry-${layer}` || (stage === `expiry-send-${layer}` && call === 2))
        clock = Date.parse(message.expiresAt);
      if (stage === `${layer}-error`) throw new Error("DNS unavailable");
      return [{ address: "1.1.1.1", family: 4 as const }];
    };
    let outerLookups = 0;
    let innerLookups = 0;
    const proposal = signed();
    const recipient = message.to?.actor as string;
    const common = {
      account,
      tokens,
      verify: verifyMessage,
      verifyApproval,
      now: () => clock,
      transport: {
        dnsLookup: () => preflight("dns", ++outerLookups),
        createTransport: (
          options: Parameters<NonNullable<OriginFetchOptions["createTransport"]>>[0],
        ) =>
          createGuardedFetch({
            ...options,
            maxRedirects: 0,
            pinningFetch: fake.transport,
            requireDnsPinning: true,
            dnsLookup: () => preflight("inner-dns", ++innerLookups),
          }),
      },
    };
    const send =
      binding === "matrix"
        ? createMatrixSend({
            ...common,
            homeserver,
            userId,
            recipients: new Map([[recipient, roomId]]),
          })
        : binding === "mastodon"
          ? createMastodonSend({
              ...common,
              recipients: new Map([[recipient, "receiver@remote.example"]]),
            })
          : binding === "discord"
            ? createDiscordSend({
                ...common,
                recipients: new Map([[recipient, "100000000000000020"]]),
                resolveProposal: async () => proposal,
              })
            : (binding === "gmail" ? createGmailSend : createGraphMailSend)({
                ...common,
                from: "sender@example.test",
                recipients: new Map([[recipient, "receiver@example.test"]]),
                parseEmail,
              });
    const carriage =
      binding === "matrix"
        ? MATRIX_CONTENT
        : binding === "mastodon"
          ? MASTODON_FOOTER
          : binding === "discord"
            ? DISCORD_FOOTER
            : EMAIL_MIME;
    const wire = await send.render(proposal, carriage);
    const sending = send.transmit(wire, {
      account,
      tokens: { send: sendGrant },
      assertAuthority,
      dryRun: false,
    });
    const localRefusal = stage.startsWith("expiry-") || stage.endsWith("-error");
    await expect(sending).rejects.toBeInstanceOf(
      localRefusal ? SendNotDispatchedError : ProviderRejectedError,
    );
    if (stage.startsWith("expiry-"))
      await expect(sending).rejects.toMatchObject({ cause: expect.any(ChannelParseError) });
    if (!localRefusal) {
      expect(halted).toBe(true);
      expect(assertAuthority).toHaveBeenCalled();
    }
    expect(fake.requests.filter((request) => request.method !== "GET")).toEqual([]);
    const beforeState = [
      "credentials",
      "credentials-error",
      "dns",
      "inner-dns",
      "dns-error",
      "inner-dns-error",
      "expiry-dns",
      "expiry-inner-dns",
    ].includes(stage);
    expect(fake.transport).toHaveBeenCalledTimes(binding === "matrix" && !beforeState ? 1 : 0);
    expect(read).not.toHaveBeenCalled();
    expect(sendGrant).toHaveBeenCalled();
    if (stage === "approval") expect(verifyApproval).toHaveBeenCalledOnce();
  });
}

it.each([
  "verification",
  "credentials",
])("direct refuses authority invalidation during %s without local delivery", async (stage) => {
  let halted = false;
  const mailbox = { accepted: new Map(), inboxes: new Map() };
  const tokens = new RecordingTokenProvider();
  const send = createDirectSend(mailbox, {
    tokens,
    now: () => at,
    verify: async (jws) => {
      const payload = await verifyMessage(jws);
      if (stage === "verification") halted = true;
      return payload;
    },
  });
  const wire = await send.render(signed(), DIRECT);
  halted = false;
  const grant = vi.spyOn(tokens, "send").mockImplementation(async () => {
    if (stage === "credentials") halted = true;
    return { access: "send", accessToken: "synthetic-send" };
  });
  await expect(
    send.transmit(wire, {
      account,
      tokens: { send: grant },
      dryRun: false,
      assertAuthority() {
        if (halted) throw new ProviderRejectedError("HALT");
      },
    }),
  ).rejects.toBeInstanceOf(ProviderRejectedError);
  expect(mailbox.accepted.size).toBe(0);
  expect(mailbox.inboxes.size).toBe(0);
  expect(await send.lookup?.(wire)).toEqual({ outcome: "absent" });
});
