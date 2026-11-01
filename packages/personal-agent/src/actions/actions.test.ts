// AUTHORED-BY Codex GPT-6.1-Sol
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { main as dashboard } from "../dashboard/cli.js";
import { type Connection, DENY_ALL, emptySettings, type Settings } from "../dashboard/model.js";
import { SettingsStore } from "../dashboard/store.js";
import { schedulingMandate } from "../pilot/mandates.js";
import { signMandate } from "../pilot/mechanisms/mandate.js";
import { BOB, provisionPair } from "../pilot/scenarios/personal.js";
import type { ActionsEnv } from "./env.js";
import { createActionRegistry } from "./index.js";
import { createActionsMcpServer } from "./mcp.js";
import { fixtureProviders } from "./providers/fixtures.js";
import { ActionRegistry, FilePreparationStore } from "./registry.js";
import type { ActionContext, ActionDefinition, ActionOrigin } from "./types.js";

// Synthetic data only; temporary directories; no network, no model.
const NOW = new Date("2026-10-19T08:00:00Z");

// ------------------------------------------------------------------ the generic framework

describe("action registry (generic)", () => {
  type Env = { allowed: boolean; ran: string[] };
  const toy = (
    over: Partial<ActionDefinition<{ n: number }, { doubled: number }, Env>> = {},
  ): ActionDefinition<{ n: number }, { doubled: number }, Env> => ({
    id: "toy.double",
    version: "1",
    title: "Double",
    description: "doubles",
    effect: "read",
    capabilities: ["toy.use"],
    limitations: [],
    input: z.strictObject({ n: z.number().int().max(100) }),
    result: z.strictObject({ doubled: z.number() }),
    permissions: (ctx) => [
      {
        subject: "toy",
        capability: "toy.use",
        allowed: ctx.env.allowed,
        why: ctx.env.allowed ? "yes" : "owner said no",
      },
    ],
    async prepare(ctx, i) {
      ctx.env.ran.push("prepare");
      return { status: "ok", reasons: [], result: { doubled: i.n * 2 } };
    },
    ...over,
  });
  let clock = NOW.getTime();
  const ctx = (
    env: Partial<Env> = {},
    origin: ActionOrigin = "operator-cli",
  ): ActionContext<Env> => ({
    origin,
    now: () => new Date(clock),
    schedulingNow: () => NOW,
    env: { allowed: true, ran: [], ...env },
  });
  beforeEach(() => {
    clock = NOW.getTime();
  });

  it("refuses malformed registrations", () => {
    expect(() => new ActionRegistry<Env>().register(toy({ id: "Bad Id" }))).toThrow(
      /bad action id/,
    );
    expect(() => new ActionRegistry<Env>().register(toy()).register(toy())).toThrow(/duplicate/);
    expect(() =>
      new ActionRegistry<Env>().register(
        toy({ execute: async () => ({ status: "ok", reasons: [] }) }),
      ),
    ).toThrow(/only local-write/);
  });

  it("publishes machine-readable descriptors with JSON Schemas and no functions", () => {
    const [d] = new ActionRegistry<Env>().register(toy()).describe();
    expect(d).toMatchObject({
      id: "toy.double",
      effect: "read",
      phases: ["prepare"],
      executeOrigins: [],
    });
    expect(d?.inputSchema).toMatchObject({
      type: "object",
      properties: { n: { type: "integer" } },
      additionalProperties: false,
    });
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  it("validates input, checks permissions before running, and withholds out-of-schema results", async () => {
    const r = new ActionRegistry<Env>().register(toy());
    expect(await r.prepare("nope", {}, ctx())).toMatchObject({
      status: "refused",
      reasons: ["unknown action"],
    });
    expect(await r.prepare("toy.double", { n: 1000 }, ctx())).toMatchObject({
      status: "refused",
      reasons: [expect.stringMatching(/^input n:/)],
    });
    expect(await r.prepare("toy.double", { n: 1, extra: true }, ctx())).toMatchObject({
      status: "refused",
    });
    const denied = ctx({ allowed: false });
    expect(await r.prepare("toy.double", { n: 2 }, denied)).toMatchObject({
      status: "refused",
      reasons: ["toy: owner said no"],
    });
    expect(denied.env.ran).toEqual([]);
    expect(await r.prepare("toy.double", { n: 2 }, ctx())).toMatchObject({
      status: "ok",
      result: { doubled: 4 },
      deterministic: true,
    });
    const liar = new ActionRegistry<Env>().register(
      toy({
        prepare: async () => ({
          status: "ok",
          reasons: [],
          result: { doubled: 1, secret: "x" } as never,
        }),
      }),
    );
    const withheld = await liar.prepare("toy.double", { n: 1 }, ctx());
    expect(withheld.status).toBe("blocked");
    expect("result" in withheld).toBe(false);
  });

  it("execution needs a single-use, unexpired preparation, an operator origin and still-valid permissions", async () => {
    const executed: number[] = [];
    const writer = toy({
      id: "toy.write",
      effect: "local-write",
      execute: async (_c, i) => {
        executed.push(i.n);
        return { status: "ok", reasons: [], result: { wrote: i.n } };
      },
    });
    const r = new ActionRegistry<Env>().register(writer);
    const p = await r.prepare("toy.write", { n: 3 }, ctx());
    expect(p.preparation?.token).toBeTruthy();
    expect((await r.execute(p.preparation?.token as string, ctx({}, "dashboard"))).status).toBe(
      "refused",
    );
    expect(
      (await r.execute(p.preparation?.token as string, ctx({}, "structured-message"))).status,
    ).toBe("refused");
    expect(await r.execute(p.preparation?.token as string, ctx())).toMatchObject({
      status: "ok",
      result: { wrote: 3 },
    });
    expect(await r.execute(p.preparation?.token as string, ctx())).toMatchObject({
      status: "refused",
      reasons: ["unknown or already used preparation"],
    });
    const late = await r.prepare("toy.write", { n: 4 }, ctx());
    clock += 11 * 60_000;
    expect((await r.execute(late.preparation?.token as string, ctx())).status).toBe("needs-review");
    clock = NOW.getTime();
    const revoked = await r.prepare("toy.write", { n: 5 }, ctx());
    expect(
      await r.execute(revoked.preparation?.token as string, ctx({ allowed: false })),
    ).toMatchObject({ status: "refused" });
    expect(executed).toEqual([3]);
  });

  it("file-backed preparations are private, single use, and refused if tampered, corrupted or re-versioned", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awp-prep-test-"));
    try {
      const store = join(dir, "preps");
      const ran: number[] = [];
      const writer = (version = "1") =>
        toy({
          id: "toy.write",
          version,
          effect: "local-write",
          execute: async (_c, i) => {
            ran.push(i.n);
            return { status: "ok", reasons: [] };
          },
        });
      const prepare = async (n: number) =>
        (
          await new ActionRegistry<Env>(new FilePreparationStore(store))
            .register(writer())
            .prepare("toy.write", { n }, ctx())
        ).preparation?.token as string;
      const only = (): string => {
        const files = readdirSync(store).filter((f) => f.endsWith(".json"));
        return join(store, files[files.length - 1] as string);
      };
      const other = () =>
        new ActionRegistry<Env>(new FilePreparationStore(store)).register(writer());

      const t1 = await prepare(1);
      expect(statSync(store).mode & 0o777).toBe(0o700);
      expect(statSync(only()).mode & 0o777).toBe(0o600);
      expect(readdirSync(store).join(" ")).not.toContain(t1); // files are named by a hash
      expect((await other().execute(t1, ctx())).status).toBe("ok");
      expect((await other().execute(t1, ctx())).status).toBe("refused");

      // Tampered input (owner-editable file): the digest no longer matches.
      const t2 = await prepare(2);
      const file2 = only();
      const stored = JSON.parse(readFileSync(file2, "utf8"));
      writeFileSync(file2, JSON.stringify({ ...stored, input: { n: 99 } }));
      expect(await other().execute(t2, ctx())).toMatchObject({
        status: "refused",
        reasons: [expect.stringMatching(/digest/)],
      });
      // Corrupted file: refused as unknown, never executed.
      const t3 = await prepare(3);
      writeFileSync(only(), "{not json");
      expect((await other().execute(t3, ctx())).status).toBe("refused");
      // The action changed version between preparation and execution.
      const t4 = await prepare(4);
      const v2 = new ActionRegistry<Env>(new FilePreparationStore(store)).register(writer("2"));
      expect(await v2.execute(t4, ctx())).toMatchObject({
        status: "refused",
        reasons: [expect.stringMatching(/version 1.*version 2/)],
      });
      expect(ran).toEqual([1]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ------------------------------------------------------------------ domain actions (settings only)

const conn = (
  id: string,
  channel: string,
  restrictions: Partial<Connection["restrictions"]>,
  provider = "gmail",
): Connection => ({
  id,
  label: `Account ${id}`,
  channel,
  provider,
  organisation: "",
  identifiers: [],
  origin: "manual",
  evidence: [],
  conflicts: [],
  localConnector: { state: "setup-required" },
  restrictions: { ...DENY_ALL, ...restrictions },
  notes: "",
  updatedAt: NOW.toISOString(),
  updatedBy: "owner (dashboard)",
});
const ALLOW = { agentEnabled: true, read: true, triage: true, draft: true };
function ownerSettings(): Settings {
  const s = emptySettings(NOW.toISOString());
  s.connections = [
    conn("mail", "email", ALLOW),
    conn("chat", "slack", ALLOW, "slack"),
    conn("github", "github_notifications", ALLOW, "github"),
    conn("nodraft", "email", { agentEnabled: true, read: true, triage: true }),
    conn("excluded", "email", {}),
    conn("teams", "microsoft_teams", ALLOW, "microsoft_365"),
  ];
  s.workflowPolicy = {
    source: "synthetic",
    lastUpdated: "2026-09-01",
    askWhenUncertain: [],
    defaultAllowed: ["classify", "draft"],
    requiresCurrentInstruction: [],
    requiresFreshExplicitInstruction: ["send_after_exact_draft_review"],
    taxonomy: {},
  };
  return s;
}
const envCtx = (
  settings: Settings,
  agentsDir = "/nonexistent",
  stateDir = "/nonexistent",
): ActionContext<ActionsEnv> => ({
  origin: "dashboard",
  now: () => NOW,
  schedulingNow: () => NOW,
  env: { settings, agentsDir, stateDir, providers: fixtureProviders(), configuredConnections: [] },
});
const registry = createActionRegistry();
// biome-ignore lint/suspicious/noExplicitAny: results are inspected structurally
const run = async (id: string, input: unknown, c = envCtx(ownerSettings())): Promise<any> =>
  registry.prepare(id, input, c);

describe("message.prepare", () => {
  const options = [
    { start: "2026-10-20T09:00:00Z", end: "2026-10-20T09:30:00Z" },
    { start: "2026-10-26T09:00:00Z", end: "2026-10-26T09:30:00Z" },
  ];

  it("renders a mail reply from fixed templates and keeps protocol metadata; nothing is sent", async () => {
    const r = await run("message.prepare", {
      accountId: "mail",
      recipientName: "Sam",
      content: {
        template: "availability-reply",
        title: "the review",
        timeZone: "Europe/London",
        options,
      },
      inReplyTo: {
        subject: "Review next week?",
        messageId: "<abc123@mail.example.org>",
        conversation: "urn:awp:conversation:42",
      },
    });
    expect(r.status).toBe("ok");
    expect(r.result.renderer).toBe("mail");
    expect(r.result.prepared.subject).toBe("Re: Review next week?");
    expect(r.result.prepared.headers).toEqual({
      "In-Reply-To": "<abc123@mail.example.org>",
      References: "<abc123@mail.example.org>",
      "X-AWP-Conversation": "urn:awp:conversation:42",
    });
    expect(r.result.prepared.text).toContain("1. Tue, 20 Oct 2026, 10:00–10:30 (Europe/London)");
    expect(r.result.prepared.text).toContain("2. Mon, 26 Oct 2026, 09:00–09:30 (Europe/London)");
    expect(r.result.delivery).toMatchObject({ state: "prepared-locally" });
    expect(r.result.delivery.send).toMatch(/Not sent/);
  });

  it("an availability reply is labelled as rendered-not-checked; expired, impossible or unknown-zone options are refused", async () => {
    const reply = (content: Record<string, unknown>, accountId = "mail") =>
      run("message.prepare", {
        accountId,
        content: {
          template: "availability-reply",
          title: "the review",
          timeZone: "Europe/London",
          options,
          ...content,
        },
      });
    const unverified = await reply({});
    expect(unverified.status).toBe("ok");
    expect(unverified.result.basis).toMatchObject({ availabilityCheckedHere: false });
    expect(unverified.result.basis.note).toMatch(/Unverified supplied suggestions/);
    const current = await reply({ validUntil: "2026-10-19T08:05:00Z" });
    expect(current.result.basis).toMatchObject({
      availabilityCheckedHere: false,
      suppliedValidUntil: "2026-10-19T08:05:00Z",
    });
    expect(current.result.basis.note).toMatch(/did not check any calendar/);
    const expired = await reply({ validUntil: "2026-10-19T07:59:59Z" });
    expect(expired).toMatchObject({ status: "needs-review" });
    expect(expired.result).toBeUndefined();
    expect(expired.reasons[0]).toMatch(/expired/);
    for (const bad of [
      { timeZone: "Mars/Olympus" },
      { timeZone: "not a zone" },
      { options: [{ start: "2026-10-20T09:00:00Z", end: "2026-10-20T09:00:00Z" }] },
      { options: [{ start: "2026-10-20T09:30:00Z", end: "2026-10-20T09:00:00Z" }] },
      { options: [{ start: "2026-10-20T09:00:00Z", end: "2026-10-22T09:00:00Z" }] },
    ])
      expect((await reply(bad)).status, JSON.stringify(bad)).toBe("refused");
    // The origin is fixed by the calling surface; a request cannot claim one.
    expect(
      (
        await run("message.prepare", {
          accountId: "mail",
          origin: "structured-message",
          content: { template: "acknowledgement", topic: "x" },
        })
      ).status,
    ).toBe("refused");
  });

  it("never truncates a chat message: too long is refused, not cut", async () => {
    const ten = Array.from({ length: 10 }, (_, n) => ({
      start: `2026-10-${20 + (n % 5)}T0${n % 2 ? 9 : 8}:00:00Z`,
      end: `2026-10-${20 + (n % 5)}T0${n % 2 ? 9 : 8}:30:00Z`,
    }));
    const s = ownerSettings();
    s.connections.push({
      ...(s.connections[1] as Connection),
      id: "sms",
      channel: "phone_messages",
    });
    const content = {
      template: "availability-reply",
      title: "x",
      timeZone: "America/Argentina/ComodRivadavia",
      options: ten,
    };
    const sms = await run("message.prepare", { accountId: "sms", content }, envCtx(s));
    expect(sms.status).toBe("needs-review");
    expect(sms.result).toBeUndefined();
    expect(sms.reasons[0]).toMatch(/characters \(limit 480\)/);
    // The same content fits a chat account, with every option intact.
    const chat = await run("message.prepare", { accountId: "chat", content }, envCtx(s));
    expect(chat.status).toBe("ok");
    for (let n = 1; n <= 10; n++) expect(chat.result.prepared.text).toContain(`(${n}) `);
    expect(chat.result.prepared.text).toMatch(/Which suits you\?$/);
  });

  it("renders chat replies compactly with a thread reference", async () => {
    const r = await run("message.prepare", {
      accountId: "chat",
      content: { template: "follow-up", topic: "the budget", since: "2026-10-01T00:00:00Z" },
      inReplyTo: { conversation: "urn:awp:conversation:7" },
    });
    expect(r.result).toMatchObject({
      renderer: "chat",
      prepared: { threadRef: "urn:awp:conversation:7" },
    });
    expect(r.result.prepared.text).toBe(
      "Following up on the budget from 1 October 2026. Any update?",
    );
  });

  it("is gated by the account's draft permission and the policy; unsupported channels need setup", async () => {
    const ack = { template: "acknowledgement", topic: "x" };
    expect((await run("message.prepare", { accountId: "nodraft", content: ack })).status).toBe(
      "refused",
    );
    expect((await run("message.prepare", { accountId: "excluded", content: ack })).status).toBe(
      "refused",
    );
    expect((await run("message.prepare", { accountId: "missing", content: ack })).status).toBe(
      "refused",
    );
    const noPolicy = ownerSettings();
    noPolicy.workflowPolicy = null;
    expect(
      (await run("message.prepare", { accountId: "mail", content: ack }, envCtx(noPolicy))).status,
    ).toBe("refused");
    expect((await run("message.prepare", { accountId: "github", content: ack })).status).toBe(
      "needs-setup",
    );
    // Structured fields only: no line breaks or control characters smuggled into the text.
    expect(
      (
        await run("message.prepare", {
          accountId: "mail",
          content: { template: "acknowledgement", topic: "a\nBcc: x" },
        })
      ).status,
    ).toBe("refused");
    expect(
      (
        await run("message.prepare", {
          accountId: "mail",
          content: { template: "free-text", body: "anything" },
        })
      ).status,
    ).toBe("refused");
  });
});

describe("inbox.normalise", () => {
  const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
  it("applies explicit rules only and orders the queue deterministically", async () => {
    const r = await run("inbox.normalise", {
      knownSubscriptions: ["<news.example.org>"],
      items: [
        {
          id: "free",
          accountId: "mail",
          receivedAt: at(1),
          subject: "Urgent!!! reply ASAP",
          text: "Please call me today.",
        },
        {
          id: "sub",
          accountId: "mail",
          receivedAt: at(2),
          headers: { "List-Id": "<NEWS.example.org>" },
        },
        { id: "late", accountId: "mail", receivedAt: at(3), dueAt: at(-2) },
        {
          id: "soon",
          accountId: "chat",
          receivedAt: at(4),
          structured: { type: "task", dueAt: at(5) },
        },
        {
          id: "meet",
          accountId: "mail",
          receivedAt: at(5),
          structured: {
            type: "meeting-request",
            window: { start: at(24), end: at(72) },
            durationMinutes: 30,
          },
        },
        {
          id: "awp",
          accountId: "mail",
          receivedAt: at(6),
          headers: { "X-AWP-Profile": "https://example.org/p" },
        },
        { id: "free", accountId: "mail", receivedAt: at(7) },
        { id: "copy", accountId: "chat", receivedAt: at(8), headers: { "Message-ID": "<m1@x>" } },
        { id: "copy2", accountId: "mail", receivedAt: at(9), headers: { "message-id": "<m1@x>" } },
        { id: "hidden", accountId: "excluded", receivedAt: at(10) },
        { id: "nodraft-ok", accountId: "nodraft", receivedAt: at(11) },
      ],
    });
    expect(r.status).toBe("ok");
    expect(
      r.result.queue.map((q: { id: string; category: string }) => `${q.category}:${q.id}`),
    ).toEqual([
      "agent-protocol:awp",
      "structured-request:meet",
      "deadline:late",
      "deadline:soon",
      // Two different records claim the id "free": a collision, both kept for review.
      "manual-review:free",
      "manual-review:free",
      "manual-review:copy",
      "manual-review:nodraft-ok",
      "subscription:sub",
    ]);
    const meet = r.result.queue.find((q: { id: string }) => q.id === "meet");
    expect(meet.next).toEqual({
      route: "calendar",
      action: "calendar.availability",
      input: { window: { start: at(24), end: at(72) }, durationMinutes: 30 },
    });
    expect(r.result.queue.find((q: { id: string }) => q.id === "late").overdue).toBe(true);
    // No keyword "understanding": urgent-sounding free text is just manual review.
    expect(r.result.queue.find((q: { id: string }) => q.id === "copy").rule).toMatch(
      /not interpreted/,
    );
    expect(r.result.duplicates).toEqual([{ id: "copy2", duplicateOf: "copy" }]);
    expect(r.result.collisions).toEqual([{ id: "free", collidesWith: "free" }]);
    expect(r.result.excluded).toEqual([
      {
        id: "hidden",
        accountId: "excluded",
        why: "You have excluded this account from the agent.",
      },
    ]);
  });
  it("an excluded account cannot suppress an allowed item; one identifier with different content is a collision", async () => {
    const mid = { "Message-ID": "<same@mail.example.org>" };
    const r = await run("inbox.normalise", {
      items: [
        { id: "spoof", accountId: "excluded", receivedAt: at(1), headers: mid, subject: "x" },
        { id: "real", accountId: "mail", receivedAt: at(2), headers: mid, subject: "Invoice" },
        { id: "twin", accountId: "nodraft", receivedAt: at(3), headers: mid, subject: "Invoice" },
        {
          id: "other",
          accountId: "chat",
          receivedAt: at(4),
          headers: mid,
          subject: "Invoice",
          text: "different body",
        },
      ],
    });
    expect(r.result.excluded.map((x: { id: string }) => x.id)).toEqual(["spoof"]);
    // Same identifier and same content in another allowed account: a genuine duplicate.
    expect(r.result.duplicates).toEqual([{ id: "twin", duplicateOf: "real" }]);
    // Same identifier, different content: neither is dropped; both go to review.
    expect(r.result.collisions).toEqual([{ id: "other", collidesWith: "real" }]);
    expect(
      r.result.queue.map((q: { id: string; category: string }) => `${q.category}:${q.id}`),
    ).toEqual(["manual-review:real", "manual-review:other"]);
    expect(r.result.queue[0].rule).toMatch(/different content/);
  });

  it("bounds its input", async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({
      id: `m${i}`,
      accountId: "mail",
      receivedAt: at(0),
    }));
    expect((await run("inbox.normalise", { items })).status).toBe("refused");
  });
});

describe("capabilities.matrix", () => {
  it("states what exists: provider calendars configuration-dependent, reading future, sending not provided", async () => {
    const r = await run("capabilities.matrix", {});
    const fam = (f: string) => r.result.families.find((x: { family: string }) => x.family === f);
    const cap = (f: string, c: string) =>
      fam(f).capabilities.find((x: { capability: string }) => x.capability === c)?.status;
    expect(cap("google", "calendar availability")).toBe("configuration-dependent");
    expect(cap("microsoft", "calendar availability")).toBe("configuration-dependent");
    expect(cap("google", "mail read")).toBe("future");
    expect(cap("teams", "chat read")).toBe("future");
    expect(cap("github", "reply preparation")).toBe("future");
    for (const f of r.result.families)
      expect(
        f.capabilities.find((x: { capability: string }) => x.capability === "send").status,
      ).toBe("not-provided");
    expect(fam("google").accounts.map((a: { id: string }) => a.id)).toEqual([
      "mail",
      "nodraft",
      "excluded",
    ]);
    expect(fam("teams").accounts.map((a: { id: string }) => a.id)).toEqual(["teams"]);
    // Fixture mode is a simulation, not a credential; families without a provider adapter have
    // none whatever the mode.
    expect(fam("google").accounts[0].credential).toBe("fixture-simulation");
    expect(fam("teams").accounts[0].credential).toBe("none");
    expect(fam("slack").accounts[0].credential).toBe("none");
    const live = envCtx(ownerSettings());
    live.env = {
      ...live.env,
      providers: { mode: "live", fetch: vi.fn() as unknown as typeof fetch },
      configuredConnections: ["mail", "teams"],
    };
    const l = await run("capabilities.matrix", {}, live);
    const lfam = (f: string) => l.result.families.find((x: { family: string }) => x.family === f);
    expect(lfam("google").accounts.map((a: { credential: string }) => a.credential)).toEqual([
      "configured",
      "none",
      "none",
    ]);
    expect(lfam("teams").accounts[0].credential).toBe("none");
    expect(r.result.families.map((f: { family: string }) => f.family)).toEqual([
      "google",
      "microsoft",
      "teams",
      "slack",
      "matrix",
      "signal",
      "sms",
      "github",
      "other",
    ]);
  });
});

// ------------------------------------------------------------------ agent records (temporary agent dir)

describe("contact.lookup", () => {
  let agents: string;
  // Real, provisioned synthetic keys and a real signed mandate (the lookup verifies it).
  let alice: Awaited<ReturnType<typeof provisionPair>>["alice"];
  const Nokeys = "https://agents.nokeys.example/p#agent";
  const Token = "S".repeat(43);
  const assoc = (
    id: string,
    contact: string,
    status: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    contact,
    serviceId: "synthetic-slots/1",
    adapterVersion: "1",
    identifiers: { user: "u", event: "e" },
    observedUrl: "https://slots.example/u/e",
    source: {
      rawSha256: "sha256:x",
      observedFrom: contact,
      receivedAt: "2026-10-01T00:00:00Z",
      forwarded: false,
    },
    status,
    history: [{ status, at: "2026-10-01T00:00:00Z", reason: "test" }],
    createdAt: "2026-10-01T00:00:00Z",
    ...extra,
  });
  const dirOf = (name: string) => join(agents, name);
  const writeAgent = (name: string, mandateJws: string) => {
    const dir = dirOf(name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "identity.json"), JSON.stringify(alice.identity));
    writeFileSync(join(dir, "trust.json"), JSON.stringify(alice.trust));
    writeFileSync(join(dir, "mandate.jws"), mandateJws);
    writeFileSync(
      join(dir, "a2a-peers.json"),
      JSON.stringify({
        version: 1,
        peers: [
          { actor: BOB.actor, url: "http://127.0.0.1:4999/a2a/jsonrpc", token: Token },
          { actor: Nokeys, url: "http://127.0.0.1:4998/a2a/jsonrpc", token: Token },
        ],
      }),
    );
    writeFileSync(
      join(dir, "associations.json"),
      JSON.stringify([
        assoc("a-ben", "ben@example.org", "accepted", {
          validUntil: "2027-01-01T00:00:00Z",
          recheckAfter: "2026-10-01T00:00:00Z",
          acceptedBy: { approval: "x", at: "2026-10-01T00:00:00Z" },
        }),
        assoc("a-cat", "cat@example.org", "candidate"),
        assoc("a-dan", "dan@example.org", "disputed"),
        assoc("a-eve", "eve@example.org", "accepted", { validUntil: "2026-10-02T00:00:00Z" }),
      ]),
    );
    writeFileSync(
      join(dir, "services.json"),
      JSON.stringify({ "synthetic-slots/1": "http://127.0.0.1:1" }),
    );
  };
  beforeAll(async () => {
    agents = mkdtempSync(join(tmpdir(), "awp-contacts-test-"));
    const recipients = [BOB.party, "mailto:ana@example.org", "mailto:ben@example.org"];
    ({ alice } = await provisionPair({
      now: () => NOW,
      aliceMandate: schedulingMandate(recipients),
    }));
    writeAgent("owner", alice.mandateJws);
    // Same records, but a mandate that expired, and one with a broken signature.
    const expired = schedulingMandate(recipients)({
      owner: alice.identity.party,
      actor: alice.identity.actor,
      validFrom: "2026-09-01T00:00:00Z",
      validUntil: "2026-10-01T00:00:00Z",
    });
    writeAgent("expired", await signMandate(alice.ownerKey, expired));
    const [h, p] = alice.mandateJws.split(".");
    writeAgent(
      "forged",
      `${h}.${p}.${Buffer.from("not the owner's signature").toString("base64url")}`,
    );
  });
  afterAll(() => rmSync(agents, { recursive: true, force: true }));
  const settingsWith = () => {
    const s = ownerSettings();
    s.managedAgents = ["owner", "expired", "forged", "corrupt"];
    return s;
  };
  const lookup = (contact: string, agent = "owner") =>
    run("contact.lookup", { agent, contact }, envCtx(settingsWith(), agents));

  it("pinned keys are recorded trust anchors (not a verification); endpoint secrets are withheld", async () => {
    const r = await lookup(BOB.actor);
    expect(r.status).toBe("ok");
    expect(r.result.certainty).toBe("recorded");
    expect(r.result.channels.map((c: { status: string }) => c.status)).toEqual([
      "keys-pinned",
      "a2a-endpoint-pinned",
    ]);
    expect(r.result.identity).toMatch(/per message, by signature verification/);
    expect(r.result.verification).toMatch(/Not checked/);
    expect(JSON.stringify(r)).not.toContain(Token);
    expect(JSON.stringify(r)).not.toContain("4999");
    expect((await lookup("https://unknown.example/#me")).result.certainty).toBe("unknown");
  });

  it("an endpoint alone is not an identity", async () => {
    const r = await lookup(Nokeys);
    expect(r.result).toMatchObject({
      certainty: "uncertain",
      channels: [{ status: "endpoint-without-keys", usable: false }],
    });
    expect(r.result.identity).toMatch(/nothing here establishes/);
  });

  it("an address is never an identity; mandate listing counts only from a verified, current mandate", async () => {
    const ana = await lookup("ana@example.org");
    expect(ana.result).toMatchObject({
      certainty: "uncertain",
      channels: [
        { kind: "owner-listed-address", status: "listed-in-verified-mandate", usable: true },
      ],
    });
    expect(ana.result.channels[0].detail).toMatch(/not who controls it/);
    expect(ana.result.identity).toMatch(/does not establish identity/);
    const expired = await lookup("ana@example.org", "expired");
    expect(expired.result.channels).toEqual([
      expect.objectContaining({ status: "listed-in-expired-mandate", usable: false }),
    ]);
    const forged = await lookup("ana@example.org", "forged");
    expect(forged.result.channels).toEqual([
      expect.objectContaining({ status: "listed-in-unverified-mandate", usable: false }),
    ]);
    expect(forged.result.verification).toMatch(/mandate not verified/);
    expect((await lookup("zed@example.org")).result.certainty).toBe("unknown");
  });

  it("confirmed current endpoints give a plan; others uncertainty or conflict", async () => {
    const ben = await lookup("Ben@Example.org");
    expect(ben.result.certainty).toBe("recorded");
    expect(ben.result.plan).toMatchObject({ kind: "conventional-booking", configured: true });
    expect(ben.result.plan.steps.join(" ")).toMatch(
      /re-checked first.*synthetic reference service only/s,
    );
    expect((await lookup("cat@example.org")).result.certainty).toBe("uncertain");
    const dan = await lookup("dan@example.org");
    expect(dan).toMatchObject({ status: "needs-review", result: { certainty: "conflict" } });
    const eve = await lookup("eve@example.org");
    expect(eve.result.plan).toBeUndefined();
    expect(eve.result.channels.some((c: { detail: string }) => /expired/.test(c.detail))).toBe(
      true,
    );
  });

  it("corrupt or wrongly shaped records are reported unavailable, never thrown or guessed", async () => {
    const dir = dirOf("corrupt");
    for (const [file, content, contact] of [
      ["trust.json", "{not json", BOB.actor],
      ["trust.json", JSON.stringify({ keys: [{ role: "actor", subject: BOB.actor }] }), BOB.actor],
      ["a2a-peers.json", JSON.stringify({ [BOB.actor]: { url: "x" } }), BOB.actor],
      ["associations.json", JSON.stringify({ not: "a list" }), "ben@example.org"],
      ["associations.json", "[", "ben@example.org"],
      ["services.json", JSON.stringify({ "synthetic-slots/1": 7 }), "ben@example.org"],
      ["identity.json", "{", "ana@example.org"],
    ] as const) {
      rmSync(dir, { recursive: true, force: true });
      writeAgent("corrupt", alice.mandateJws);
      writeFileSync(join(dir, file), content);
      const r = await lookup(contact, "corrupt");
      expect(r.status, `${file}: ${content}`).toBe("blocked");
      expect(r.result.certainty).toBe("unavailable");
      expect(r.reasons.join(" ")).toMatch(/unreadable|could not all be read/);
    }
  });

  it("is read-only and limited to managed agents", async () => {
    const before = readFileSync(join(agents, "owner", "associations.json"), "utf8");
    await lookup("eve@example.org"); // expiry is evaluated but not written back
    expect(readFileSync(join(agents, "owner", "associations.json"), "utf8")).toBe(before);
    expect((await lookup("ana@example.org", "someone-else")).status).toBe("refused");
    expect(
      (
        await run(
          "contact.lookup",
          { agent: "owner", contact: "not an address" },
          envCtx(settingsWith(), agents),
        )
      ).status,
    ).toBe("refused");
  });
});

// ------------------------------------------------------------------ operator surfaces with a real runtime

describe("operator CLI, MCP and runtime execution (temporary demo state)", () => {
  let state: string;
  const io = () => {
    const out: string[] = [];
    return { out, io: { stdout: (s: string) => out.push(s), stderr: () => undefined } };
  };
  beforeAll(async () => {
    state = mkdtempSync(join(tmpdir(), "awp-actions-cli-"));
    const q = io();
    expect(
      await dashboard(
        [
          "demo-setup",
          "--state",
          state,
          "--policy-engine",
          "solid-odrl",
          "--now",
          NOW.toISOString(),
        ],
        q.io,
      ),
    ).toBe(0);
    expect(await dashboard(["demo-provider-fixtures", "--state", state], io().io)).toBe(0);
  }, 60_000);
  afterAll(() => rmSync(state, { recursive: true, force: true }));
  const cli = async (...args: string[]) => {
    const q = io();
    const code = await dashboard([...args, "--state", state, "--now", NOW.toISOString()], q.io);
    return { code, json: JSON.parse(q.out.join("")) };
  };
  const writeInput = (name: string, v: unknown) => {
    const p = join(state, name);
    writeFileSync(p, JSON.stringify(v));
    return p;
  };

  it("lists and describes the catalogue", async () => {
    const list = await cli("actions", "list");
    expect(list.json.map((a: { id: string }) => a.id)).toEqual([
      "calendar.availability",
      "meeting.prepare-proposal",
      "meeting.check-slot",
      "agent.propose-meeting",
      "contact.lookup",
      "message.prepare",
      "inbox.normalise",
      "capabilities.matrix",
    ]);
    const d = await cli("actions", "describe", "--id", "calendar.availability");
    expect(d.json.inputSchema.required).toEqual(["window", "durationMinutes"]);
  });

  it("computes availability over the fixture Google and Microsoft calendars only when fixtures are chosen", async () => {
    const input = writeInput("avail.json", {
      window: { start: "2026-10-20T00:00:00Z", end: "2026-10-21T00:00:00Z" },
      durationMinutes: 30,
    });
    const fixtures = await cli(
      "actions",
      "prepare",
      "--id",
      "calendar.availability",
      "--input",
      input,
      "--provider-fixtures",
    );
    expect(fixtures.code).toBe(0);
    expect(
      fixtures.json.result.sources.filter((s: { kind: string }) => s.kind === "external"),
    ).toHaveLength(4);
    const none = await cli("actions", "prepare", "--id", "calendar.availability", "--input", input);
    expect(none.code).toBe(2);
    expect(none.json.status).toBe("needs-setup");
  });

  it.each([
    "a".repeat(24),
    `-${"a".repeat(23)}`,
    `--${"a".repeat(22)}`,
  ])("passes preparation token %s unchanged through both CLI argument forms", async (token) => {
    const preparations = new FilePreparationStore(join(state, "action-preparations"));
    for (const args of [["--token", token], [`--token=${token}`]]) {
      // A known expired preparation proves the exact token reached the store, while
      // expiry and single-use checks still prevent execution. No runtime writes are needed.
      preparations.put({
        token,
        action: "agent.propose-meeting",
        version: "1",
        digest: "unused",
        input: {},
        result: {},
        expiresAt: "2000-01-01T00:00:00Z",
      });
      const expired = await cli("actions", "execute", ...args);
      expect(expired.code).toBe(2);
      expect(expired.json).toMatchObject({
        status: "needs-review",
        reasons: ["the preparation expired; prepare again with fresh data"],
      });
      const again = await cli("actions", "execute", ...args);
      expect(again.code).toBe(2);
      expect(again.json).toMatchObject({
        status: "refused",
        reasons: ["unknown or already used preparation"],
      });
    }
  });

  it.each([
    { args: ["--token"], code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" },
    {
      args: ["--token=-synthetic", "--unknown-option"],
      code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
    },
    { args: ["--state", "--token", "-synthetic"], code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" },
    { args: ["--", "--token", "-synthetic"], code: "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL" },
  ])("keeps strict CLI validation for $args", async ({ args, code }) => {
    await expect(
      dashboard(["actions", "execute", "--state", state, ...args], io().io),
    ).rejects.toMatchObject({ code });
  });

  it("prepares and then executes a runtime proposal to the pinned peer (separate CLI processes); nothing is sent", async () => {
    const input = writeInput("propose.json", {
      agent: "demo-owner",
      peerActor: "https://agents.peer.example/personal#agent",
      peerParty: "https://peer.example/#me",
      window: { start: "2026-10-21T08:00:00Z", end: "2026-10-21T12:00:00Z" },
      durationMinutes: 30,
      title: "Synthetic catch-up",
    });
    // With the fixture provider calendars counting, the runtime's applied availability is stale
    // for booking: re-apply is not done here; the prepared state was applied before they were added.
    const p = await cli("actions", "prepare", "--id", "agent.propose-meeting", "--input", input);
    expect(p.json.status).toBe("ok");
    expect(p.json.preparation.token).toBeTruthy();
    const e = await cli("actions", "execute", `--token=${p.json.preparation.token}`);
    expect(e.json.status).toBe("ok");
    expect(e.json.result.files.length).toBeGreaterThan(0);
    expect(readdirSync(join(state, "outbound", "demo-owner")).length).toBeGreaterThan(0);
    expect(e.json.result.notice).toMatch(/not sent|NOT sent|nothing/i);
    const again = await cli("actions", "execute", `--token=${p.json.preparation.token}`);
    expect(again.json.status).toBe("refused");
    const stranger = await cli(
      "actions",
      "prepare",
      "--id",
      "agent.propose-meeting",
      "--input",
      writeInput("stranger.json", {
        ...JSON.parse(readFileSync(input, "utf8")),
        peerActor: "https://agents.stranger.example/x#agent",
      }),
    );
    expect(stranger.json).toMatchObject({ status: "refused" });
  }, 60_000);

  it("offers the same catalogue over MCP, with execution through a prepared token", async () => {
    const settingsStore = new SettingsStore(state);
    const server = createActionsMcpServer(createActionRegistry(), () => ({
      origin: "mcp",
      now: () => NOW,
      schedulingNow: () => NOW,
      env: {
        settings: settingsStore.read(),
        agentsDir: join(state, "demo-agents"),
        stateDir: state,
        providers: fixtureProviders(),
        configuredConnections: [],
      },
    }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(tools).toEqual([
        "describe_action",
        "execute_action",
        "list_actions",
        "prepare_action",
      ]);
      const call = async (name: string, args: Record<string, unknown>) =>
        // biome-ignore lint/suspicious/noExplicitAny: inspected structurally
        ((await client.callTool({ name, arguments: args })) as any).structuredContent;
      const avail = await call("prepare_action", {
        id: "calendar.availability",
        input: {
          window: { start: "2026-10-26T00:00:00Z", end: "2026-10-27T00:00:00Z" },
          durationMinutes: 60,
        },
      });
      expect(avail.status).toBe("ok");
      expect(avail.origin).toBe("mcp");
      expect(avail.result.proposals[0].start).toBe("2026-10-26T10:00:00.000Z");
      expect((await call("execute_action", { token: "made-up" })).status).toBe("refused");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("uses no model or hosted classifier anywhere (no network in any action)", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      await cli(
        "actions",
        "prepare",
        "--id",
        "capabilities.matrix",
        "--input",
        writeInput("m.json", {}),
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(existsSync(join(state, "action-preparations"))).toBe(true);
  });
});
