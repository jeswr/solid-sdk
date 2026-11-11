// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalJson, digestBytes } from "@jeswr/agent-model";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { readFileSync } from "fs";
import { expect, it, vi } from "vitest";
import { decodeEnvelope } from "../src/envelope.js";
import { ChannelParseError, ProviderRejectedError, SendNotDispatchedError } from "../src/errors.js";
import { createGraphTeamsSend } from "../src/graph-teams/send.js";
import { AGENT_FOOTER, TEAMS_CARD } from "../src/profiles.js";
import { RecordingTokenProvider } from "../src/testing.js";
import type { TransmissionIo, Wire } from "../src/types.js";
import { fixtureTransport } from "./fixtures/graph.js";
import { account, at, message, signed, verifyMessage } from "./fixtures/signed.js";
import { chat, item, reader } from "./fixtures/teams.js";

function sender(replies: unknown[] = [], extra: Record<string, unknown> = {}) {
  const fake = fixtureTransport(replies);
  const tokens = new RecordingTokenProvider();
  const verifyApproval = vi.fn(async () => true);
  const config = {
    account,
    recipients: new Map([[message.to?.actor as string, chat]]),
    verify: verifyMessage,
    verifyApproval,
    now: () => at,
    transport: fake.options,
    ...extra,
  };
  return {
    ...fake,
    config,
    tokens,
    verifyApproval,
    send: createGraphTeamsSend(config),
    io: { account, tokens, assertAuthority: vi.fn(), dryRun: false },
  };
}
interface Plan {
  chat: string;
  account: string;
  request: { body: { content: string }; attachments: Array<{ content: string }>; extra?: string };
}
function changed(wire: Wire, update: (value: Plan) => void): Wire {
  const plan = JSON.parse(wire.bytes);
  update(plan);
  const bytes = canonicalJson(plan);
  return { ...wire, bytes, digest: digestBytes(bytes) };
}

it("renders a golden plain body and hidden card envelope, then decodes the same envelope on ingest", async () => {
  const s = sender([{ id: "accepted-id" }]);
  const proposal = signed();
  const wire = await s.send.render(proposal, TEAMS_CARD);
  expect(await s.send.validate(wire, proposal)).toEqual({ ok: true });
  const plan = JSON.parse(wire.bytes);
  const card = JSON.parse(plan.request.attachments[0].content);
  expect(card.data.envelope["agent:compactJws"]).toBe(proposal.compactJws);
  card.data.envelope["agent:compactJws"] = "<signed-fixture>";
  const normalized = {
    ...plan.request,
    attachments: [{ ...plan.request.attachments[0], content: canonicalJson(card) }],
  };
  expect(normalized).toEqual(
    JSON.parse(readFileSync(new URL("fixtures/teams-card.json", import.meta.url), "utf8")),
  );
  expect(wire.digest).toBe(digestBytes(wire.bytes));
  for (const dryRun of [undefined, true])
    expect(await s.send.transmit(wire, { ...s.io, dryRun })).toEqual({
      outcome: "rejected",
      detail: "dry-run",
    });
  expect(s.tokens.calls).toEqual([]);
  expect(s.verifyApproval).not.toHaveBeenCalled();
  expect(await s.send.transmit(wire, s.io)).toEqual({
    outcome: "accepted",
    providerRef: "accepted-id",
  });
  expect(s.tokens.calls.map((call) => call.access)).toEqual(["send"]);
  expect(s.verifyApproval).toHaveBeenCalledWith(wire, account);
  expect(s.io.assertAuthority).toHaveBeenCalledOnce();
  expect(s.requests[0]?.url.href).toBe(
    `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chat)}/messages`,
  );
  expect(s.requests[0]?.method).toBe("POST");
  expect(s.requests[0]?.headers.get("content-type")).toBe("application/json");
  expect(JSON.parse(s.requests[0]?.body as string)).toEqual(plan.request);
  expect(plan.request.body.contentType).toBe("text");
  expect(plan.request.body.content).toContain(AGENT_FOOTER);
  const inbound = reader([]).binding.ingest.parse(item(plan.request));
  expect(decodeEnvelope(inbound.jsonLdBlocks?.[0] as string).compactJws).toBe(proposal.compactJws);
  expect(inbound.warnings).toContain("signature-unverified");
  expect(s.send).not.toHaveProperty("lookup");
  expect(s.send).not.toHaveProperty("finalAbsence");
});

it("binds reviewed bytes to the configured account, pinned recipient, both human copies and envelope", async () => {
  const s = sender();
  const proposal = signed();
  const wire = await s.send.render(proposal, TEAMS_CARD);
  const transforms: Array<(p: Plan) => void> = [
    (p) => {
      p.chat = "other";
    },
    (p) => {
      p.account = "other";
    },
    (p) => {
      p.request.body.content = "private changed";
    },
    (p) => {
      const attachment = p.request.attachments[0] as { content: string };
      const card = JSON.parse(attachment.content);
      card.body[0].text = "private changed";
      attachment.content = canonicalJson(card);
    },
    (p) => {
      p.request.extra = "private";
    },
    (p) => {
      p.request.attachments = [];
    },
  ];
  for (const change of transforms) {
    const tampered = changed(wire, change);
    expect(await s.send.validate(tampered, proposal)).toEqual({
      ok: false,
      reason: "terms-digest-mismatch",
    });
    await expect(s.send.transmit(tampered, s.io)).rejects.toBeInstanceOf(SendNotDispatchedError);
  }
  for (const bad of [
    { ...wire, digest: "changed" },
    { ...wire, mediaType: "text/html" },
    { ...wire, extra: true },
    { ...wire, bytes: 1 },
    { ...wire, bytes: "x".repeat(65537) },
  ]) {
    expect(await s.send.validate(bad as never, proposal)).toEqual({
      ok: false,
      reason: "malformed",
    });
    await expect(s.send.transmit(bad as never, s.io)).rejects.toThrow("invalid Teams wire");
  }
  await expect(s.send.transmit(wire, { ...s.io, account: { id: "other" } })).rejects.toBeInstanceOf(
    ProviderRejectedError,
  );
  expect(s.tokens.calls).toEqual([]);
  expect(s.requests).toEqual([]);
});

it("verifies signatures and signed payload equality before rendering or transmitting", async () => {
  const proposal = signed();
  const s = sender();
  const wire = await s.send.render(proposal, TEAMS_CARD);
  for (const verify of [async () => null, async () => ({ ...message, id: "urn:other" })]) {
    const bad = sender([], { verify });
    await expect(bad.send.render(proposal, TEAMS_CARD)).rejects.toThrow("signed payload differs");
    await expect(bad.send.transmit(wire, bad.io)).rejects.toBeInstanceOf(SendNotDispatchedError);
  }
  await expect(
    s.send.render({ ...proposal, message: { ...message, id: "urn:changed" } }, TEAMS_CARD),
  ).rejects.toThrow("signed payload differs");
  await expect(s.send.render({ ...proposal, compactJws: "private" }, TEAMS_CARD)).rejects.toThrow(
    ChannelParseError,
  );
  const refusal = new ChannelParseError("signature refused");
  const bad = sender([], {
    verify: async () => {
      throw refusal;
    },
  });
  await expect(bad.send.transmit(wire, bad.io)).rejects.toMatchObject({
    name: "SendNotDispatchedError",
    cause: refusal,
  });
  await expect(s.send.render(proposal, { ...TEAMS_CARD, maxBytes: 1 })).rejects.toThrow(
    "unsupported Teams carriage",
  );
});

it("refuses missing recipients, malformed configuration, control-bearing summaries and oversized complete wires", async () => {
  const s = sender([], { recipients: new Map() });
  await expect(s.send.render(signed(), TEAMS_CARD)).rejects.toThrow("no pinned Teams recipient");
  const { to, ...noTo } = message;
  expect(to).toBeDefined();
  await expect(s.send.render(signed(noTo), TEAMS_CARD)).rejects.toThrow();
  for (const config of [
    { account: { id: "" } },
    { recipients: new Map([["actor", "%bad"]]) },
    { footer: "\n" },
  ])
    expect(() => sender([], config)).toThrow();
  const control = signed({ ...message, conversation: "urn:with:\u202econtrol" });
  await expect(sender().send.render(control, TEAMS_CARD)).rejects.toThrow("contains controls");
  const large = signed({
    ...message,
    kind: "description",
    body: { description: { a: "x".repeat(16000), b: "x".repeat(16000), c: "x".repeat(16000) } },
  });
  // Repeated card/body copies, the JSON-LD carrier and nested JSON encoding all count.
  await expect(sender().send.render(large, TEAMS_CARD)).rejects.toThrow("wire exceeds byte cap");
});

it("defaults to dry-run and snapshots recipient pins and configured policy", async () => {
  const recipients = new Map([[message.to?.actor as string, chat]]);
  const s = sender([], { recipients, footer: "https://example.test/agent" });
  recipients.set(message.to?.actor as string, "other");
  const wire = await s.send.render(signed(), TEAMS_CARD);
  expect(JSON.parse(wire.bytes).chat).toBe(chat);
  expect(JSON.parse(wire.bytes).request.body.content).toContain("https://example.test/agent");
  expect(await s.send.transmit(wire, { ...s.io, dryRun: undefined })).toEqual({
    outcome: "rejected",
    detail: "dry-run",
  });
  expect(s.requests).toEqual([]);
  expect(s.tokens.calls).toEqual([]);
});

it("requires a send grant and strict owner approval without releasing read credentials", async () => {
  const s = sender();
  const wire = await s.send.render(signed(), TEAMS_CARD);
  for (const verifyApproval of [undefined, async () => false, async () => "yes"]) {
    const denied = sender([], { verifyApproval });
    await expect(denied.send.transmit(wire, denied.io)).rejects.toBeInstanceOf(
      ProviderRejectedError,
    );
    expect(denied.requests).toEqual([]);
  }
  const wrong = {
    read: vi.fn(),
    send: vi.fn(async () => ({ access: "read", accessToken: "private" })),
  };
  await expect(s.send.transmit(wire, { ...s.io, tokens: wrong as never })).rejects.toThrow(
    "wrong-scope",
  );
  expect(wrong.read).not.toHaveBeenCalled();
  expect(s.requests).toEqual([]);
});

it.each([
  "initial",
  "token",
  "approval",
  "DNS",
  "authority",
])("rechecks validity and executor authority after %s awaits before dispatch", async (stage) => {
  let clock = at;
  const end = Date.parse(message.expiresAt);
  const s = sender([], { now: () => clock });
  const wire = await s.send.render(signed(), TEAMS_CARD);
  const failure = new Error("authority changed");
  let io: TransmissionIo = s.io;
  let send = s.send;
  if (stage === "initial") clock = end;
  if (stage === "token")
    io = {
      ...io,
      tokens: {
        send: async () => {
          clock = end;
          return { access: "send", accessToken: "private" };
        },
      } as never,
    };
  if (stage === "approval")
    send = sender([], {
      now: () => clock,
      verifyApproval: async () => {
        clock = end;
        return true;
      },
    }).send;
  if (stage === "DNS")
    send = sender([], {
      now: () => clock,
      transport: {
        ...s.config.transport,
        dnsLookup: async () => {
          clock = end;
          return [{ address: "1.1.1.1", family: 4 }];
        },
      },
    }).send;
  if (stage === "authority")
    io = {
      ...io,
      assertAuthority: () => {
        throw failure;
      },
    };
  await expect(send.transmit(wire, io)).rejects.toBeInstanceOf(SendNotDispatchedError);
  expect(s.requests).toEqual([]);
});

it("rejects nonfinite clocks, future or expired proposals and exercises the default clock", async () => {
  const s = sender();
  const proposal = signed();
  const wire = await s.send.render(proposal, TEAMS_CARD);
  for (const now of [() => NaN, () => at - 7200000, () => at + 7200000, undefined]) {
    const clocked = sender([], { now });
    expect(await clocked.send.validate(wire, proposal)).toEqual({ ok: false, reason: "malformed" });
  }
});

it("preserves provider rejections, gives ambiguous outcomes their uncertain meaning and never retries POST", async () => {
  for (const status of [400, 401, 403, 404, 405, 413, 429, 500, 503]) {
    const s = sender([
      new Response("private body with envelope and token", {
        status,
        headers: { "retry-after": "0" },
      }),
    ]);
    const wire = await s.send.render(signed(), TEAMS_CARD);
    const call = s.send.transmit(wire, s.io);
    if (status < 500) await expect(call).rejects.toBeInstanceOf(ProviderRejectedError);
    else await expect(call).rejects.toThrow(`Teams send uncertain: HTTP ${status}`);
    expect(s.requests).toHaveLength(1);
  }
  for (const response of [
    {},
    { id: "%private" },
    new Response("private json"),
    new Error("private transport body"),
  ]) {
    const s = sender([response]);
    const wire = await s.send.render(signed(), TEAMS_CARD);
    const call = s.send.transmit(wire, s.io);
    await expect(call).rejects.not.toBeInstanceOf(SendNotDispatchedError);
    await expect(call).rejects.not.toThrow("private");
    expect(s.requests).toHaveLength(1);
  }
});
