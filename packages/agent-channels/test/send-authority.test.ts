// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { parseEmail } from "../../agentic-legacy-bridge/src/email/parse.js";
import { createDirectSend } from "../src/direct/send.js";
import { createDiscordSend } from "../src/discord/send.js";
import { ProviderRejectedError } from "../src/errors.js";
import { createGmailSend } from "../src/gmail/send.js";
import { createGraphMailSend } from "../src/graph-mail/send.js";
import { createMastodonSend } from "../src/mastodon/send.js";
import { createMatrixSend } from "../src/matrix/send.js";
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
  it.each(stages)(`${binding} refuses HALT during %s with zero send requests`, async (stage) => {
    let halted = false;
    const assertAuthority = vi.fn(() => {
      if (halted) throw new ProviderRejectedError("HALT invalidated executor authority");
    });
    const tokens = new RecordingTokenProvider();
    const sendGrant = vi.spyOn(tokens, "send").mockImplementation(async () => {
      if (stage === "credentials") halted = true;
      return { access: "send", accessToken: "synthetic-send" };
    });
    const read = vi.spyOn(tokens, "read").mockRejectedValue(new Error("no read authority"));
    const verifyApproval = vi.fn(async () => {
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
    const proposal = signed();
    const recipient = message.to?.actor as string;
    const common = {
      account,
      tokens,
      verify: verifyMessage,
      verifyApproval,
      now: () => at,
      transport: fake.options,
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
    await expect(
      send.transmit(wire, { account, tokens: { send: sendGrant }, assertAuthority, dryRun: false }),
    ).rejects.toBeInstanceOf(ProviderRejectedError);
    expect(halted).toBe(true);
    expect(assertAuthority).toHaveBeenCalled();
    expect(fake.requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(fake.transport).toHaveBeenCalledTimes(
      binding === "matrix" && stage !== "credentials" ? 1 : 0,
    );
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
