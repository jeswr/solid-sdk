// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import type { OdrlPolicy } from "../src/gate.js";
import {
  createSandbox,
  createWorldSandbox,
  DEMO_START,
  DecisionRecord,
  type JudgeModel,
  type ToolSpec,
} from "../src/index.js";
import { runCode } from "../src/runners/code.js";
import {
  AGENT_ID,
  ANDREW_DELEGATION,
  createWorld,
  DEFAULT_SETTINGS,
  PURPOSE,
  scenario,
  staffOnlyPolicy,
  supportMandate,
} from "../src/world/index.js";

const care = scenario("injected-refund");

describe("the gate", () => {
  it("hides tools no rule allows, and refuses them if called anyway", async () => {
    const { sandbox } = createWorldSandbox(care);
    const names = sandbox.tools().map((t) => t.name);
    expect(names).toContain("db_query");
    expect(names).not.toContain("db_delete_rows");
    expect(names).not.toContain("marketing_send_campaign");
    const hidden = sandbox.catalogue().find((e) => e.tool.name === "marketing_send_campaign");
    expect(hidden?.reason).toMatch(/^Hidden: no rule/);
    const r = await sandbox.call({
      tool: "marketing_send_campaign",
      args: { segment: "all", message: "Sale!" },
    });
    expect(r.status).toBe("stopped");
  });

  it("off and llm modes offer every tool", () => {
    const { sandbox } = createWorldSandbox(care, { mode: "off" });
    expect(sandbox.tools()).toHaveLength(sandbox.catalogue().length);
    sandbox.setMode("policy");
    expect(sandbox.mode()).toBe("policy");
    expect(sandbox.tools().length).toBeLessThan(sandbox.catalogue().length);
  });

  it("refuses unknown tools and invalid arguments, and records both", async () => {
    const { sandbox } = createWorldSandbox(care);
    expect((await sandbox.call({ tool: "rm_rf", args: {} })).status).toBe("stopped");
    const bad = await sandbox.call({
      tool: "payments_refund",
      args: { customer: "c-1003", amount: -5 },
    });
    expect(bad.status === "stopped" && bad.message).toMatch(
      /not valid: the amount must be positive/,
    );
    expect((await sandbox.decide({ tool: "rm_rf", args: {} })).outcome).toBe("stop");
    expect((await sandbox.decide({ tool: "crm_get_customer", args: {} })).outcome).toBe("stop");
    expect(sandbox.record.entries().map((e) => e.result)).toEqual(["stopped", "stopped"]);
  });

  it("decide() previews without running or recording", async () => {
    const { sandbox, world } = createWorldSandbox(care);
    const d = await sandbox.decide({
      tool: "payments_refund",
      args: { customer: "c-1003", amount: 40 },
    });
    expect(d.outcome).toBe("permit");
    expect(world.state.refunds).toHaveLength(0);
    expect(sandbox.record.entries()).toHaveLength(0);
  });

  it("approval: a held call runs only after a person approves, and is re-checked", async () => {
    const { sandbox, world } = createWorldSandbox(care);
    const held = await sandbox.call({
      tool: "payments_refund",
      args: { customer: "c-1003", amount: 250 },
    });
    expect(held.status).toBe("held");
    expect(world.state.refunds).toHaveLength(0);
    expect(sandbox.held()).toHaveLength(1);
    const id = held.status === "held" ? held.approval : "";
    const ran = await sandbox.approve(id, "Priya Shah");
    expect(ran.status).toBe("done");
    expect(world.state.refunds).toEqual([expect.objectContaining({ amount: 250 })]);
    const last = sandbox.record.entries().at(-1);
    expect(last).toMatchObject({ result: "approved", settles: held.entry });
    expect(last?.decision.steps[0]).toMatchObject({
      step: "approval",
      explanation: "Approved by Priya Shah.",
    });
    await expect(sandbox.approve(id, "x")).rejects.toThrow(/No held call/);
  });

  it("approval cannot override a stop that arose while the call waited", async () => {
    const { sandbox } = createWorldSandbox(scenario("partner-data"));
    const args = { to: ["ollie.grant@northwind-logistics.example"], subject: "s", body: "b" };
    const first = await sandbox.call({ tool: "email_send", args });
    const second = await sandbox.call({ tool: "email_send", args });
    expect([first.status, second.status]).toEqual(["held", "held"]);
    expect(
      (await sandbox.approve(first.status === "held" ? first.approval : "", "Priya")).status,
    ).toBe("done");
    const late = await sandbox.approve(second.status === "held" ? second.approval : "", "Priya");
    expect(late.status === "stopped" && late.message).toMatch(
      /now refused: Contact any one person/,
    );
  });

  it("decline records the refusal against the held entry", async () => {
    const { sandbox, world } = createWorldSandbox(care);
    const held = await sandbox.call({
      tool: "payments_refund",
      args: { customer: "c-1003", amount: 900 },
    });
    const id = held.status === "held" ? held.approval : "";
    expect(sandbox.decline(id, "Tom").status).toBe("stopped");
    expect(world.state.refunds).toHaveLength(0);
    expect(sandbox.record.entries().at(-1)).toMatchObject({
      result: "declined",
      settles: held.entry,
    });
    expect(() => sandbox.decline(id, "Tom")).toThrow(/No held call/);
  });

  it("grants apply at once and revocation applies at once", async () => {
    const { sandbox, world } = createWorldSandbox(scenario("acting-for-andrew"));
    const call = {
      tool: "email_send",
      args: { to: ["ollie.grant@northwind-logistics.example"], subject: "s", body: "b" },
    };
    expect((await sandbox.decide(call)).outcome).toBe("review");
    world.setGrants([ANDREW_DELEGATION]);
    expect((await sandbox.decide(call)).outcome).toBe("permit");
    world.setGrants([]);
    expect((await sandbox.decide(call)).outcome).toBe("review");
  });

  it("settings change the rules (closed world and open world)", async () => {
    const world = createWorld();
    world.setSettings({
      ...world.settings(),
      hrAccess: false,
      customerEmailsNeedApproval: true,
      analyticsAccess: false,
    });
    const make = (unlisted: "stop" | "review") =>
      createSandbox({
        tools: world.tools,
        rules: world.rules,
        directory: world.directory,
        agent: AGENT_ID,
        purpose: PURPOSE.customerCare,
        unlisted,
        clock: () => Date.parse("2026-11-04T09:00:00Z"),
      });
    const closed = make("stop");
    expect(closed.tools().map((t) => t.name)).not.toContain("hr_get_absence");
    expect(
      (await closed.decide({ tool: "hr_get_absence", args: { employee: "Sam" } })).outcome,
    ).toBe("stop");
    expect(
      (await closed.decide({ tool: "email_send_reminder", args: { customer: "c-1001" } })).outcome,
    ).toBe("review");
    const open = make("review");
    expect(open.catalogue().find((e) => e.tool.name === "hr_get_absence")?.reason).toMatch(
      /goes to a person/,
    );
    expect((await open.decide({ tool: "hr_get_absence", args: { employee: "Sam" } })).outcome).toBe(
      "review",
    );
  });

  it("an expired or foreign mandate refuses everything", async () => {
    const world = createWorld();
    const expired = { ...supportMandate(), validUntil: "2026-11-02T00:00:00.000Z" };
    const sandbox = createSandbox({
      tools: world.tools,
      rules: () => ({ mandate: expired, currency: "GBP" }),
      directory: world.directory,
      agent: AGENT_ID,
      purpose: PURPOSE.customerCare,
      clock: () => Date.parse("2026-11-04T09:00:00Z"),
    });
    const d = await sandbox.decide({ tool: "tickets_list", args: {} });
    expect(d.outcome).toBe("stop");
    expect(d.summary).toMatch(/mandate expired/);
    const other = createSandbox({
      tools: world.tools,
      rules: world.rules,
      directory: world.directory,
      agent: "https://evil.example/#bot",
      purpose: PURPOSE.customerCare,
      clock: () => Date.parse("2026-11-04T09:00:00Z"),
    });
    expect((await other.decide({ tool: "tickets_list", args: {} })).summary).toMatch(/wrong agent/);
  });

  it("a failing tool is recorded as failed", async () => {
    const { sandbox } = createWorldSandbox(care);
    const r = await sandbox.call({ tool: "tickets_read", args: { ticket: "T-999" } });
    expect(r.status === "failed" && r.message).toMatch(/no such ticket/);
    expect(sandbox.record.entries()[0]?.result).toBe("failed");
  });

  it("the record detects tampering", async () => {
    const { sandbox } = createWorldSandbox(care);
    await sandbox.call({ tool: "tickets_list", args: {} });
    await sandbox.call({ tool: "payments_refund", args: { customer: "c-1003", amount: 40 } });
    const entries = sandbox.record.entries();
    expect(DecisionRecord.verify(entries)).toBeUndefined();
    const forged = entries.map((e, i) => (i === 0 ? { ...e, result: "stopped" as const } : e));
    expect(DecisionRecord.verify(forged)).toBe(0);
    const seen: number[] = [];
    const stop = sandbox.record.subscribe((e) => seen.push(e.seq));
    await sandbox.call({ tool: "tickets_list", args: {} });
    stop();
    await sandbox.call({ tool: "tickets_list", args: {} });
    expect(seen).toEqual([2]);
  });
});

describe("model-judged modes", () => {
  const judge = (answer: string | Error): JudgeModel => ({
    name: "Test judge",
    complete: async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });

  it("llm mode follows the judge, and shows what the rules would have done", async () => {
    const { sandbox } = createWorldSandbox(care, {
      mode: "llm",
      judge: judge('Sure: {"outcome": "permit", "reason": "looks fine"}'),
    });
    const d = await sandbox.decide({
      tool: "payments_refund",
      args: { customer: "c-1003", amount: 5000, toAccount: "GB00FAKE" },
    });
    expect(d).toMatchObject({
      outcome: "permit",
      shadow: "stop",
      summary: "Test judge judged: looks fine",
    });
  });

  it("llm mode falls back to a person when the judge is missing or unreadable", async () => {
    const call = { tool: "tickets_list", args: {} };
    for (const j of [
      undefined,
      judge("no json here"),
      judge(new Error("network")),
      judge('{"outcome": "maybe"}'),
    ]) {
      const { sandbox } = createWorldSandbox(care, { mode: "llm", ...(j && { judge: j }) });
      expect((await sandbox.decide(call)).outcome).toBe("review");
    }
  });

  it("llm mode approval runs the held call", async () => {
    const { sandbox } = createWorldSandbox(care, {
      mode: "llm",
      judge: judge('{"outcome": "review", "reason": "check"}'),
    });
    const held = await sandbox.call({ tool: "tickets_list", args: {} });
    expect(
      (await sandbox.approve(held.status === "held" ? held.approval : "", "Priya")).status,
    ).toBe("done");
  });

  it("hybrid mode ignores purposes outside the list and unreadable answers", async () => {
    const call = {
      tool: "email_send",
      args: { to: ["maria.lopez@example.org"], subject: "s", body: "Big sale!" },
    };
    for (const j of [
      judge('{"purpose": "https://evil.example/purpose"}'),
      judge("garbage"),
      judge(new Error("x")),
    ]) {
      const { sandbox } = createWorldSandbox(scenario("friendly-upsell"), {
        mode: "hybrid",
        judge: j,
      });
      const d = await sandbox.decide(call);
      expect(d.outcome).toBe("permit");
      expect(d.steps.some((s) => s.step === "judge")).toBe(false);
    }
  });
});

describe("MCP lockdown settings", () => {
  it("a locked system hides every tool on it; a locked action hides the tools that perform it", async () => {
    const { sandbox, world } = createWorldSandbox(scenario("production-database"));
    expect(sandbox.tools().map((t) => t.name)).toContain("db_query");
    world.setSettings({
      ...world.settings(),
      lockedSystems: [
        "https://harbourfinch.example/systems/production-db",
        "https://harbourfinch.example/systems/email",
      ],
    });
    const names = sandbox.tools().map((t) => t.name);
    expect(names.filter((n) => n.startsWith("db_") || n.startsWith("email_"))).toEqual([]);
    expect((await sandbox.call({ tool: "db_query", args: { sql: "SELECT 1" } })).status).toBe(
      "stopped",
    );
    world.setSettings({
      ...world.settings(),
      lockedSystems: [],
      lockedActions: [
        {
          system: "https://harbourfinch.example/systems/payments",
          action: "https://jeswr.org/ns/agent#Transfer",
        },
      ],
    });
    expect(sandbox.catalogue().find((e) => e.tool.name === "payments_refund")?.visible).toBe(false);
    expect(sandbox.tools().map((t) => t.name)).toContain("db_query");
  });
});

describe("review fixes", () => {
  const judge = (answer: string): JudgeModel => ({
    name: "Test judge",
    complete: async () => answer,
  });
  const staff = [
    "priya.shah",
    "tom.reid",
    "dana.okafor",
    "lee.chen",
    "andrew.hill",
    "sam.patel",
    "privacy",
  ];

  it("calls made together are decided one at a time, so limits hold", async () => {
    const { sandbox, world } = createWorldSandbox(care);
    const sends = staff.map((local) =>
      sandbox.call({
        tool: "email_send",
        args: { to: [`${local}@harbourfinch.example`], subject: "s", body: "hello" },
      }),
    );
    const results = await Promise.all(sends);
    expect(results.filter((r) => r.status === "done")).toHaveLength(5);
    expect(world.state.outbox).toHaveLength(5);
    expect(DecisionRecord.verify(sandbox.record.entries())).toBeUndefined();
  });

  it("the code box cap counts calls when they start", async () => {
    const { sandbox, world } = createWorldSandbox(care);
    const run = await runCode(
      sandbox,
      `const r = await Promise.all(${JSON.stringify(staff)}.map((n) =>
         tools.email_send({ to: [n + "@harbourfinch.example"], subject: "s", body: "hi" })));
       log(r.map((x) => x.status).join(","), typeof __call, typeof globalThis.__call);`,
      { maxCalls: 3 },
    );
    expect(world.state.outbox).toHaveLength(3);
    expect(sandbox.record.entries()).toHaveLength(3);
    expect(run.logs[0]).toBe("done,done,done,refused,refused,refused,refused undefined undefined");
  });

  it("hybrid: the model's purpose can only make the answer stricter", async () => {
    const call = {
      tool: "email_send",
      args: { to: ["maria.lopez@example.org"], subject: "s", body: "About your order" },
    };
    const story = scenario("production-database");
    const policy = await createWorldSandbox(story).sandbox.decide(call);
    for (const answer of [
      `{"purpose": "${PURPOSE.customerCare}"}`,
      '{"purpose": "constructor"}',
      '{"purpose": "toString"}',
    ]) {
      const { sandbox } = createWorldSandbox(story, { mode: "hybrid", judge: judge(answer) });
      expect((await sandbox.decide(call)).outcome).toBe(policy.outcome);
    }
    expect(policy.outcome).not.toBe("permit");
  });

  it("a recipient named twice counts once and gets one copy", async () => {
    const { sandbox, world } = createWorldSandbox(care);
    const r = await sandbox.call({
      tool: "email_send",
      args: {
        to: ["priya.shah@harbourfinch.example", "PRIYA.SHAH@harbourfinch.example"],
        subject: "s",
        body: "hello",
      },
    });
    expect(r.status).toBe("done");
    expect(world.state.outbox.at(-1)?.to).toHaveLength(1);
    const again = await sandbox.call({
      tool: "email_send",
      args: { to: ["priya.shah@harbourfinch.example"], subject: "s", body: "again" },
    });
    expect(again.status).toBe("stopped");
  });

  it("absence dates and query results carry staff-only rules onward", async () => {
    const { sandbox } = createWorldSandbox(scenario("sickness-note"));
    await sandbox.call({ tool: "hr_get_absence", args: { employee: "Sam Patel" } });
    const out = await sandbox.call({
      tool: "insights_upload",
      args: { data: "Sam Patel off 20-22 Oct", question: "trend?" },
    });
    expect(out.status).toBe("stopped");
    const db = createWorldSandbox(scenario("production-database")).sandbox;
    await db.call({ tool: "db_query", args: { sql: "SELECT * FROM orders" } });
    expect(db.labels().map((l) => l.title)).toEqual(["Production order data"]);
  });

  it("an outside domain that merely ends like ours is not placed in the UK", async () => {
    const { sandbox } = createWorldSandbox(care);
    const d = await sandbox.decide({
      tool: "email_send",
      args: { to: ["x@evilharbourfinch.example"], subject: "s", body: "hi" },
    });
    expect(d.outcome).not.toBe("permit");
  });
});

describe("ask a person for one action", () => {
  it("moves an action to approval: offered, flagged in the catalogue and over MCP, and held", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMcpProxy } = await import("../src/mcp/proxy.js");
    const { sandbox, world } = createWorldSandbox(care);
    const payments = "https://harbourfinch.example/systems/payments";
    world.setSettings({
      ...world.settings(),
      reviewActions: [{ system: payments, action: "https://jeswr.org/ns/agent#Transfer" }],
    });
    const entry = sandbox.catalogue().find((e) => e.tool.name === "payments_refund");
    expect(entry).toMatchObject({ visible: true, approval: true });
    expect(entry?.reason).toMatch(/^Offered, but each use needs a person's approval/);
    const r = await sandbox.call({
      tool: "payments_refund",
      args: { customer: "c-1003", amount: 20 },
    });
    expect(r.status).toBe("held");
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([createMcpProxy(sandbox).connect(b), client.connect(a)]);
    const listed = await client.listTools();
    expect(listed.tools.find((t) => t.name === "payments_refund")?.description).toMatch(
      /waits for a person's approval/,
    );
    expect(listed.tools.find((t) => t.name === "tickets_list")?.description).not.toMatch(
      /approval/,
    );
    await client.close();
  });
});

describe("merge-gate fixes", () => {
  /** The demo world with some tools swapped, so a test can change what they do mid-session. */
  function worldWith(
    swap: Record<string, (t: ToolSpec) => ToolSpec>,
    story = care,
    extra: Partial<Parameters<typeof createSandbox>[0]> = {},
  ) {
    const world = createWorld(() => DEMO_START);
    world.setSettings({ ...DEFAULT_SETTINGS, ...story.settings });
    const tools = world.tools.map((t) => swap[t.name]?.(t) ?? t);
    const sandbox = createSandbox({
      tools,
      rules: world.rules,
      grants: world.grants,
      directory: world.directory,
      agent: world.agent,
      purpose: story.purpose,
      clock: () => DEMO_START,
      ...extra,
    });
    return { world, sandbox };
  }

  it("an approval is bound to what the call would do when it was held", async () => {
    let account = "GB12HFBK40516211223344";
    const { sandbox, world } = worldWith({
      payments_refund: (t) => ({
        ...t,
        context: (args) => ({ ...t.context?.(args), recipients: [`urn:hf:account:${account}`] }),
      }),
    });
    const held = await sandbox.call({
      tool: "payments_refund",
      args: { customer: "c-1003", amount: 250 },
    });
    expect(held.status).toBe("held");
    account = "GB98HFBK40516299887766";
    const r = await sandbox.approve(held.status === "held" ? held.approval : "", "Priya");
    expect(r.status === "stopped" && r.message).toMatch(/has changed since it was held/);
    expect(world.state.refunds).toHaveLength(0);
    expect(sandbox.record.entries().at(-1)?.decision.steps[0]).toMatchObject({
      step: "approval",
      reason: "approval-stale",
    });
  });

  it("reading a record again under a looser policy does not drop the stricter one", async () => {
    const id = "https://harbourfinch.example/systems/db#orders";
    let policy: OdrlPolicy = staffOnlyPolicy(id);
    const { sandbox } = worldWith({
      db_query: (t) => ({
        ...t,
        run: () => ({
          items: [
            {
              label: { id, title: "Orders", source: t.system, category: "Internal", policy },
              content: "rows",
            },
          ],
        }),
      }),
    });
    const send = {
      tool: "email_send",
      args: { to: ["maria.lopez@example.org"], subject: "s", body: "Your order" },
    };
    expect((await sandbox.decide(send)).outcome).toBe("permit");
    await sandbox.call({ tool: "db_query", args: { sql: "SELECT 1" } });
    expect((await sandbox.decide(send)).outcome).toBe("stop");
    policy = { id: `${id}-open`, permissions: [{ type: "permission", action: "use" }] };
    await sandbox.call({ tool: "db_query", args: { sql: "SELECT 1" } });
    expect(sandbox.labels()).toHaveLength(2);
    expect((await sandbox.decide(send)).outcome).toBe("stop");
  });

  it("asking a person for an action still applies when a delegation grants it", async () => {
    const { sandbox, world } = createWorldSandbox(scenario("acting-for-andrew"));
    world.setGrants([ANDREW_DELEGATION]);
    const call = {
      tool: "email_send",
      args: { to: ["ollie.grant@northwind-logistics.example"], subject: "s", body: "b" },
    };
    expect((await sandbox.decide(call)).outcome).toBe("permit");
    const { target, action } = ANDREW_DELEGATION.rule;
    world.setSettings({
      ...world.settings(),
      reviewActions: [{ system: target ?? "", action }],
    });
    expect((await sandbox.decide(call)).outcome).toBe("review");
  });

  it("a send that fails still counts against the limits", async () => {
    let fail = true;
    const { sandbox, world } = worldWith({
      email_send: (t) => ({
        ...t,
        run: (args, effects) => {
          if (fail) throw new Error("connection reset after sending");
          return t.run(args, effects);
        },
      }),
    });
    const call = {
      tool: "email_send",
      args: { to: ["priya.shah@harbourfinch.example"], subject: "s", body: "hello" },
    };
    expect((await sandbox.call(call)).status).toBe("failed");
    fail = false;
    expect((await sandbox.call(call)).status).toBe("stopped");
    expect(world.state.outbox).toHaveLength(0);
  });

  it("the judge can be replaced mid-session", async () => {
    const { sandbox } = createWorldSandbox(care, { mode: "llm" });
    const call = {
      tool: "email_send",
      args: { to: ["priya.shah@harbourfinch.example"], subject: "s", body: "hello" },
    };
    expect((await sandbox.decide(call)).steps[0]?.reason).toBe("judge:unavailable");
    sandbox.setJudge({
      name: "Later judge",
      complete: async () => '{"outcome": "permit", "reason": "fine"}',
    });
    expect(sandbox.judge()?.name).toBe("Later judge");
    expect((await sandbox.decide(call)).steps[0]?.reason).toBe("judge:Later judge");
  });

  it("what runs is exactly what was decided, even if the systems change while a model decides", async () => {
    let account = "GB12HFBK40516211223344";
    const refund = (t: ToolSpec): ToolSpec => ({
      ...t,
      context: (args) => ({ ...t.context?.(args), recipients: [`urn:hf:account:${account}`] }),
    });
    const switching: JudgeModel = {
      name: "Slow judge",
      complete: async () => {
        account = "GB98HFBK40516299887766";
        return '{"outcome": "permit", "reason": "fine"}';
      },
    };
    const { sandbox, world } = worldWith({ payments_refund: refund }, care, {
      mode: "llm",
      judge: switching,
    });
    const r = await sandbox.call({
      tool: "payments_refund",
      args: { customer: "c-1003", amount: 40 },
    });
    expect(r.status === "stopped" && r.message).toMatch(/changed while it was being decided/);
    expect(world.state.refunds).toHaveLength(0);
    expect(sandbox.record.entries().at(-1)?.decision.steps.at(-1)).toMatchObject({
      step: "dispatch",
      reason: "effects-changed",
    });

    // Unchanged, it runs, and pays the account the gate checked.
    account = "GB12HFBK40516211223344";
    const steady = worldWith({ payments_refund: refund }, care, {
      mode: "llm",
      judge: { name: "Judge", complete: async () => '{"outcome": "permit", "reason": "ok"}' },
    });
    expect(
      (
        await steady.sandbox.call({
          tool: "payments_refund",
          args: { customer: "c-1003", amount: 40 },
        })
      ).status,
    ).toBe("done");
    expect(steady.world.state.refunds).toEqual([
      { customer: "Jon Baker", amount: 40, to: "urn:hf:account:GB12HFBK40516211223344" },
    ]);
  });

  it("policies and effects are kept as frozen copies", async () => {
    const id = "https://harbourfinch.example/systems/db#orders";
    const policy: OdrlPolicy = staffOnlyPolicy(id);
    const amount = { value: 30, currency: "GBP" };
    const { sandbox } = worldWith({
      db_query: (t) => ({
        ...t,
        run: () => ({
          items: [
            {
              label: { id, title: "Orders", source: t.system, category: "Internal", policy },
              content: "rows",
            },
          ],
        }),
      }),
      payments_refund: (t) => ({ ...t, context: (args) => ({ ...t.context?.(args), amount }) }),
    });
    await sandbox.call({ tool: "db_query", args: { sql: "SELECT 1" } });
    (policy.permissions as unknown[]).push({ type: "permission", action: "use" });
    const kept = sandbox.labels()[0];
    expect(kept?.policy.permissions).toHaveLength(2);
    expect(Object.isFrozen(kept?.policy.permissions)).toBe(true);
    const send = {
      tool: "email_send",
      args: { to: ["maria.lopez@example.org"], subject: "s", body: "Your order" },
    };
    expect((await sandbox.decide(send)).outcome).toBe("stop");
    let seen: unknown;
    const spy = worldWith({
      payments_refund: (t) => ({
        ...t,
        context: (args) => ({ ...t.context?.(args), amount }),
        run: (_args, effects) => {
          seen = effects;
          return { content: "ok" };
        },
      }),
    });
    await spy.sandbox.call({ tool: "payments_refund", args: { customer: "c-1003", amount: 30 } });
    expect(Object.isFrozen(seen)).toBe(true);
    expect((seen as { amount: unknown }).amount).not.toBe(amount);
  });
});
