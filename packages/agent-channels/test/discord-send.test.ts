// AUTHORED-BY Codex GPT-6.1-Sol
import { digestBytes } from "@jeswr/agent-model";
import type { guardedFetch } from "@jeswr/guarded-fetch";
import { expect, it, vi } from "vitest";
import { createDiscordSend, type DiscordSendOptions } from "../src/discord/send.js";
import { createDiscordReader, ORIGINS } from "../src/discord.js";
import { ChannelParseError, ProviderRejectedError } from "../src/errors.js";
import { AGENT_FOOTER, DISCORD_FOOTER } from "../src/profiles.js";
import { InMemoryDiscordGateway, RecordingTokenProvider } from "../src/testing.js";
import type { TokenProvider, Wire } from "../src/types.js";
import { account, at, message, signed, verifyMessage } from "./fixtures/signed.js";

const channel = "100000000000000020";
const ack = { id: "100000000000000040", channel_id: channel };
function sender(replies: unknown[] = [ack], extra: Partial<DiscordSendOptions> = {}) {
  const tokens = new RecordingTokenProvider();
  const proposal = signed();
  const requests: { url: URL; body: string; headers: Headers; method: string | undefined }[] = [];
  const queue = [...replies];
  const transport = vi.fn<typeof guardedFetch>(async (input, init) => {
    requests.push({
      url: new URL(input instanceof Request ? input.url : String(input)),
      body: init?.body ? await new Response(init.body).text() : "",
      headers: new Headers(init?.headers),
      method: init?.method,
    });
    const reply = queue.shift();
    if (reply instanceof Error) throw reply;
    return reply instanceof Response ? reply : Response.json(reply);
  });
  const verifyApproval = vi.fn(async () => true);
  const resolveProposal = vi.fn(async () => proposal);
  const config: DiscordSendOptions = {
    account,
    recipients: new Map([[message.to?.actor as string, channel]]),
    verify: verifyMessage,
    resolveProposal,
    verifyApproval,
    now: () => at,
    transport: {
      createTransport: () => transport,
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 as const }],
    },
    ...extra,
  };
  return {
    tokens,
    proposal,
    requests,
    transport,
    config,
    verifyApproval,
    resolveProposal,
    send: createDiscordSend(config),
  };
}
const edited = (wire: Wire, change: object): Wire => {
  const bytes = JSON.stringify({ ...JSON.parse(wire.bytes), ...change });
  return { ...wire, bytes, digest: digestBytes(bytes) };
};

it("uses the system clock when no clock is injected", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  try {
    const s = sender([], { now: undefined });
    const wire = await s.send.render(s.proposal, DISCORD_FOOTER);
    expect(await s.send.validate(wire, s.proposal)).toEqual({ ok: true });
  } finally {
    clock.mockRestore();
  }
});

it("renders deterministic footer-only JSON with no envelope or allowed mentions, then sends the exact body", async () => {
  const s = sender();
  const wire = await s.send.render(s.proposal, DISCORD_FOOTER);
  expect(wire).toEqual(await s.send.render(s.proposal, DISCORD_FOOTER));
  expect(wire.digest).toBe(digestBytes(wire.bytes));
  expect(wire.mediaType).toBe("application/json");
  const body = JSON.parse(wire.bytes);
  expect(Object.keys(body).sort()).toEqual([
    "allowed_mentions",
    "content",
    "embeds",
    "enforce_nonce",
    "nonce",
  ]);
  expect(body.content).toContain("Request: implementation description");
  expect(body.embeds).toEqual([{ footer: { text: AGENT_FOOTER } }]);
  expect(body.allowed_mentions).toEqual({ parse: [] });
  expect(body.nonce).toHaveLength(25);
  expect(wire.bytes).not.toContain(s.proposal.compactJws);
  expect(wire.bytes).not.toContain("@context");
  expect(await s.send.validate(wire, s.proposal)).toEqual({ ok: true });
  expect(s.tokens.calls).toEqual([]);
  expect(s.requests).toEqual([]);
  expect(await s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false })).toEqual({
    outcome: "accepted",
    providerRef: ack.id,
  });
  expect(s.requests).toHaveLength(1);
  expect(s.requests[0]).toMatchObject({ body: wire.bytes, method: "POST" });
  expect(s.requests[0]?.url.href).toBe(`https://discord.com/api/v10/channels/${channel}/messages`);
  expect(s.requests[0]?.headers.get("authorization")).toMatch(/^Bot /);
  expect(s.requests[0]?.headers.get("content-type")).toBe("application/json");
  expect(s.tokens.calls).toEqual([{ access: "send", account }]);
  expect(s.verifyApproval).toHaveBeenCalledExactlyOnceWith(wire, account);
  expect(s.resolveProposal).toHaveBeenCalledExactlyOnceWith(wire);
  expect(s.send.lookup).toBeUndefined();
  expect(s.send.finalAbsence).toBeUndefined();
});

it("round-trips outbound footer discovery through a bot DM event without upgrading authority", async () => {
  const s = sender();
  const wire = await s.send.render(s.proposal, DISCORD_FOOTER);
  const event = {
    op: 0,
    t: "MESSAGE_CREATE",
    d: {
      ...JSON.parse(wire.bytes),
      ...ack,
      author: { id: "100000000000000030", username: "fixture-bot" },
      timestamp: message.createdAt,
    },
  };
  const reader = createDiscordReader({
    tokens: s.tokens,
    gateway: new InMemoryDiscordGateway(new Map()),
  });
  const parsed = reader.ingest.parse({ id: ack.id, raw: JSON.stringify(event) });
  expect(parsed.textBody).toContain(AGENT_FOOTER);
  expect(parsed.jsonLdBlocks).toBeUndefined();
});

it("defaults to dry-run even for invalid input, with no grants, outbox lookup, approval or network", async () => {
  const s = sender();
  for (const dryRun of [undefined, true]) {
    expect(await s.send.transmit({} as Wire, { account, tokens: s.tokens, dryRun })).toEqual({
      outcome: "rejected",
      detail: "dry-run",
    });
  }
  expect(s.tokens.calls).toEqual([]);
  expect(s.resolveProposal).not.toHaveBeenCalled();
  expect(s.verifyApproval).not.toHaveBeenCalled();
  expect(s.requests).toEqual([]);
});

it("pins recipients and configuration, and binds channel changes into the approved nonce", async () => {
  const recipients = new Map([[message.to?.actor as string, channel]]);
  const s = sender([ack], { recipients });
  const wire = await s.send.render(s.proposal, DISCORD_FOOTER);
  recipients.set(message.to?.actor as string, "100000000000000099");
  (s.config as { resolveProposal: unknown }).resolveProposal = () => {
    throw new Error("mutated");
  };
  expect(await s.send.render(s.proposal, DISCORD_FOOTER)).toEqual(wire);
  const other = sender([], { recipients });
  expect(await other.send.render(s.proposal, DISCORD_FOOTER)).not.toEqual(wire);
  const custom = sender([], { footer: "Agent: https://configured.example/card" });
  expect(JSON.parse((await custom.send.render(s.proposal, DISCORD_FOOTER)).bytes).nonce).not.toBe(
    JSON.parse(wire.bytes).nonce,
  );
  await s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false });
  expect(s.requests[0]?.url.pathname).toContain(channel);
});

it("snapshots wire bytes before awaited outbox lookup and does not allow approval to mutate them", async () => {
  let original: Wire;
  const proposal = signed();
  const s = sender([ack], {
    resolveProposal: async (wire) => {
      expect(Object.isFrozen(wire)).toBe(true);
      (original as { bytes: string }).bytes = "mutated";
      return proposal;
    },
    verifyApproval: async (wire) => {
      expect(Object.isFrozen(wire)).toBe(true);
      return true;
    },
  });
  original = await s.send.render(proposal, DISCORD_FOOTER);
  const exact = original.bytes;
  await s.send.transmit(original, { account, tokens: s.tokens, dryRun: false });
  expect(s.requests[0]?.body).toBe(exact);
});

it("refuses account mismatch, missing approval and wrong-scope send grants", async () => {
  const s = sender();
  const wire = await s.send.render(s.proposal, DISCORD_FOOTER);
  await expect(
    s.send.transmit(wire, { account: { id: "other" }, tokens: s.tokens, dryRun: false }),
  ).rejects.toThrow(ProviderRejectedError);
  expect(s.tokens.calls).toEqual([]);
  const badTokens = {
    send: async () => ({ access: "read", accessToken: "fake" }),
  } as unknown as TokenProvider;
  await expect(
    s.send.transmit(wire, { account, tokens: badTokens, dryRun: false }),
  ).rejects.toThrow("wrong-scope");
  for (const verifyApproval of [async () => false, undefined]) {
    const denied = sender([], { verifyApproval } as Partial<DiscordSendOptions>);
    const exact = await denied.send.render(denied.proposal, DISCORD_FOOTER);
    await expect(
      denied.send.transmit(exact, { account, tokens: denied.tokens, dryRun: false }),
    ).rejects.toThrow("owner approval required");
    expect(denied.requests).toEqual([]);
  }
  expect(s.requests).toEqual([]);
});

it.each([
  (wire: Wire) => ({ ...wire, mediaType: "text/plain" }),
  (wire: Wire) => ({ ...wire, digest: "wrong" }),
  (wire: Wire) => ({ ...wire, bytes: 42 }) as unknown as Wire,
  (wire: Wire) => ({ ...wire, extra: "unexpected" }),
  (wire: Wire) => ({ ...wire, bytes: "x".repeat(8193) }),
])("refuses tampered wire fields in validation and transmission", async (change) => {
  const s = sender();
  const wire = change(await s.send.render(s.proposal, DISCORD_FOOTER));
  expect(await s.send.validate(wire, s.proposal)).toEqual({ ok: false, reason: "malformed" });
  await expect(s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false })).rejects.toThrow(
    ChannelParseError,
  );
  expect(s.requests).toEqual([]);
});

it.each([
  { content: "tampered" },
  { embeds: [] },
  { nonce: "other-channel" },
  { allowed_mentions: { parse: ["everyone"] } },
  { extra: { "@context": "https://attacker.example" } },
])("refuses changed body even with its digest recomputed", async (change) => {
  const s = sender();
  const wire = edited(await s.send.render(s.proposal, DISCORD_FOOTER), change);
  expect(await s.send.validate(wire, s.proposal)).toEqual({
    ok: false,
    reason: "terms-digest-mismatch",
  });
  await expect(s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false })).rejects.toThrow(
    "differs from signed proposal",
  );
  expect(s.tokens.calls).toEqual([]);
});

it("requires local signature verification, matching payloads, a pinned recipient and the exact carriage", async () => {
  const s = sender();
  await expect(s.send.render(s.proposal, { ...DISCORD_FOOTER, maxBytes: 99999 })).rejects.toThrow(
    "carriage",
  );
  await expect(
    s.send.render({ ...s.proposal, message: { ...message, id: "urn:changed" } }, DISCORD_FOOTER),
  ).rejects.toThrow("differs");
  const tampered = `${s.proposal.compactJws.slice(0, -5)}aaaaa`;
  await expect(
    s.send.render({ ...s.proposal, compactJws: tampered }, DISCORD_FOOTER),
  ).rejects.toThrow("signature");
  await expect(
    s.send.render({ ...s.proposal, compactJws: "invalid" }, DISCORD_FOOTER),
  ).rejects.toThrow();
  for (const verify of [async () => null, async () => ({ ...message, id: "urn:changed" })]) {
    await expect(sender([], { verify }).send.render(s.proposal, DISCORD_FOOTER)).rejects.toThrow(
      "differs",
    );
  }
  const unpinned = signed({ ...message, to: { actor: "https://other.example/agent" } });
  await expect(s.send.render(unpinned, DISCORD_FOOTER)).rejects.toThrow("pinned");
  const { to: _to, ...noRecipient } = message;
  await expect(s.send.render(signed(noRecipient), DISCORD_FOOTER)).rejects.toThrow("pinned");
});

it("checks freshness before and after awaited credentials and approval", async () => {
  for (const atTime of [NaN, Date.parse(message.createdAt) - 1, Date.parse(message.expiresAt)]) {
    const s = sender([], { now: () => atTime });
    const wire = await s.send.render(s.proposal, DISCORD_FOOTER);
    expect(await s.send.validate(wire, s.proposal)).toEqual({ ok: false, reason: "malformed" });
    await expect(
      s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false }),
    ).rejects.toThrow("expired or not yet valid");
    expect(s.tokens.calls).toEqual([]);
  }
  for (const expireDuring of ["credentials", "approval"]) {
    let clock = at;
    const s = sender([], {
      now: () => clock,
      verifyApproval: async () => {
        if (expireDuring === "approval") clock = Infinity;
        return true;
      },
    });
    const wire = await s.send.render(s.proposal, DISCORD_FOOTER);
    const tokens: TokenProvider = {
      read: async () => {
        throw new Error("read forbidden");
      },
      send: async () => {
        if (expireDuring === "credentials") clock = Infinity;
        return { access: "send", accessToken: "fake-send" };
      },
    };
    await expect(s.send.transmit(wire, { account, tokens, dryRun: false })).rejects.toThrow(
      "expired or not yet valid",
    );
    expect(s.requests).toEqual([]);
  }
});

it("enforces content, footer and local byte bounds", async () => {
  const s = sender();
  const huge = signed({
    ...message,
    kind: "propose",
    body: {
      operation: { id: "urn:operation", version: "1" },
      termsDigest: "test",
      round: 1,
      terms: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`term${i}`, "a".repeat(150)]),
      ),
    },
  });
  await expect(s.send.render(huge, DISCORD_FOOTER)).rejects.toThrow("content exceeds");
  await expect(
    s.send.render(signed({ ...message, id: "urn:example:\u202e" }), DISCORD_FOOTER),
  ).rejects.toThrow("controls");
  for (const footer of [
    "no URL",
    "http://example.test/card",
    "https://user:pass@example.test/card",
    "https://:pass@example.test/card",
    "\nhttps://example.test",
    "x".repeat(2049),
  ])
    expect(() => sender([], { footer })).toThrow();
  const footer = `https://configured.example/card ${"漢".repeat(2000)}`;
  const limited = sender([], { footer });
  await expect(
    limited.send.render(
      signed({
        ...message,
        id: `urn:${"漢".repeat(500)}`,
        conversation: `urn:${"漢".repeat(500)}`,
        inReplyTo: `urn:${"漢".repeat(500)}`,
      }),
      DISCORD_FOOTER,
    ),
  ).rejects.toThrow("local byte cap");
  expect(() =>
    sender([], { recipients: new Map([[message.to?.actor as string, "../escape"]]) }),
  ).toThrow("snowflake");
  const custom = sender([], { footer: "Agent: https://configured.example/card" });
  expect(
    JSON.parse((await custom.send.render(custom.proposal, DISCORD_FOOTER)).bytes).embeds[0].footer
      .text,
  ).toBe("Agent: https://configured.example/card");
});

it.each([
  400, 401, 403, 404, 405, 413, 429,
])("treats HTTP %s as refusal without retry", async (status) => {
  const s = sender([new Response(null, { status })]);
  const wire = await s.send.render(s.proposal, DISCORD_FOOTER);
  await expect(s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false })).rejects.toThrow(
    ProviderRejectedError,
  );
  expect(s.requests).toHaveLength(1);
});

it.each([
  new Response(null, { status: 500 }),
  new Error("private upstream details"),
  { id: "invalid", channel_id: channel },
  { ...ack, channel_id: "elsewhere" },
  new Response("invalid JSON"),
  new Response(null, { status: 204 }),
])("preserves uncertainty for failed or malformed acknowledgements", async (reply) => {
  const s = sender([reply]);
  const wire = await s.send.render(s.proposal, DISCORD_FOOTER);
  const error = await s.send
    .transmit(wire, { account, tokens: s.tokens, dryRun: false })
    .catch((e: Error) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(ProviderRejectedError);
  expect(String(error)).not.toContain("private upstream details");
  expect(s.requests).toHaveLength(1);
});

it("refuses redirects and cannot widen REST origins through the exported set", async () => {
  (ORIGINS as Set<string>).add("https://attacker.example");
  const s = sender([
    new Response(null, { status: 307, headers: { location: "https://attacker.example/steal" } }),
  ]);
  const wire = await s.send.render(s.proposal, DISCORD_FOOTER);
  await expect(s.send.transmit(wire, { account, tokens: s.tokens, dryRun: false })).rejects.toThrow(
    "transport failed or refused redirect",
  );
  expect(s.requests).toHaveLength(1);
  expect(s.requests[0]?.url.origin).toBe("https://discord.com");
  (ORIGINS as Set<string>).delete("https://attacker.example");
});
