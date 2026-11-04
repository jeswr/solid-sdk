// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  createSandbox,
  createWorldSandbox,
  DecisionRecord,
  type JudgeModel,
} from "../src/index.js";
import {
  AGENT_ID,
  ANDREW_DELEGATION,
  createWorld,
  PURPOSE,
  scenario,
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
