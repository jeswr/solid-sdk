// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  type AutomationRule,
  DEMO_START,
  describeMandate,
  ruleMandate,
  ruleTools,
  runAutomation,
  scriptedModel,
  validateRule,
  wants,
} from "../src/index.js";
import {
  AUTOMATION_AGENT,
  AUTOMATION_EXAMPLES,
  AUTOMATION_PURPOSE,
  BOOKING_LINK,
  closestExample,
  createAppsWorld,
  SAMPLE_EMAILS,
} from "../src/world/index.js";

const example = (id: string) => {
  const ex = AUTOMATION_EXAMPLES.find((e) => e.rule.id === id);
  if (!ex) throw new Error(id);
  return ex;
};
const email = (id: string) => {
  const m = SAMPLE_EMAILS.find((x) => x.id === id);
  if (!m) throw new Error(id);
  return m;
};

function setup() {
  const world = createAppsWorld();
  let now = DEMO_START;
  const env = world.env(() => now);
  return { world, env, tick: () => (now += 60_000) };
}

async function run(id: string, emailId: string) {
  const { world, env } = setup();
  const ex = example(id);
  const event = world.receive(email(emailId));
  const out = await runAutomation(ex.rule, event, env, {
    ...(ex.script && { model: scriptedModel("Stand-in", ex.script(event)) }),
  });
  return { world, out };
}

describe("automation rules", () => {
  it("every built-in example is a valid rule", () => {
    const { env } = setup();
    for (const ex of AUTOMATION_EXAMPLES) expect(validateRule(ex.rule, env)).toEqual([]);
  });

  it("validation catches unknown tools, missing recipients and bad limits", () => {
    const { env } = setup();
    const base = example("meeting-replies").rule;
    const bad: AutomationRule = {
      ...base,
      title: " ",
      trigger: { kind: "schedule", every: "day" },
      runner: { kind: "code", source: " " },
      policy: {
        purpose: "https://example.org/whatever",
        allow: [
          { tool: "rm_rf" },
          { tool: "gmail_send" },
          { tool: "jira_search", to: "anyone" },
          { tool: "gmail_reply", to: "sender" },
          { tool: "gmail_reply", to: "sender" },
          { tool: "slack_post", to: [] },
        ],
        sendsPerDay: 0,
      },
    };
    const problems = validateRule(bad, env).join("\n");
    for (const p of [
      /no title/,
      /not one of the organisation's purposes/,
      /no tool called "rm_rf"/,
      /"gmail_send" sends messages/,
      /"jira_search" does not send/,
      /listed twice/,
      /names its recipients wrongly/,
      /not started by an email/,
      /whole number/,
      /code is empty/,
    ])
      expect(problems).toMatch(p);
    expect(
      validateRule(
        {
          ...base,
          runner: { kind: "llm", instructions: "" },
          trigger: { kind: "email", match: "" },
          policy: { ...base.policy, allow: [] },
        },
        env,
      ).join("\n"),
    ).toMatch(
      /instructions are empty[\s\S]*may not use any tool|may not use any tool[\s\S]*instructions are empty/,
    );
  });

  it("the rule's policy reads as plain English and binds the sender", () => {
    const { env, world } = setup();
    const rule = example("meeting-replies").rule;
    const event = world.receive(email("m-201"));
    const m = ruleMandate(rule, env, {
      agent: AUTOMATION_AGENT,
      event,
      at: "2026-11-04T09:00:00.000Z",
    });
    expect(m.autonomous.permissions?.[0]?.constraints).toContainEqual({
      leftOperand: "recipient",
      operator: "isAnyOf",
      rightOperand: ["mailto:nadia.price@example.org"],
    });
    expect(describeMandate(m, world.directory).onItsOwn.join(" ")).toMatch(/nadia\.price/);
    expect(ruleTools(rule, env.tools).map((t) => t.name)).toEqual(["gmail_reply"]);
  });

  it("meeting replies: a meeting request gets the link; other mail is left alone", async () => {
    const { world, out } = await run("meeting-replies", "m-201");
    expect(out.ran).toBe(true);
    expect(world.state.sent).toEqual([
      expect.objectContaining({
        to: "nadia.price@example.org",
        body: expect.stringContaining(BOOKING_LINK),
      }),
    ]);
    expect(out.events.map((e) => e.kind)).toEqual(["say", "call", "say", "end"]);
    const skipped = await run("meeting-replies", "m-205");
    expect(skipped.out.ran).toBe(false);
    expect(skipped.world.state.sent).toHaveLength(0);
    expect(wants(example("meeting-replies").rule, { kind: "manual" })).toBe(false);
  });

  it("meeting replies: an email asking it to write to everyone still only gets one reply", async () => {
    const { world } = await run("meeting-replies", "m-206");
    expect(world.state.sent.map((s) => s.to)).toEqual(["nadia.price@example.org"]);
  });

  it("support to Jira: opens the issue, notes the record and replies", async () => {
    const { world, out } = await run("support-to-jira", "m-202");
    expect(world.state.issues.at(-1)).toMatchObject({ key: "SUP-101", status: "open" });
    expect(world.state.notes).toEqual([
      { contact: "jon.baker@example.com", note: expect.any(String) },
    ]);
    expect(world.state.sent.map((s) => s.to)).toEqual(["jon.baker@example.com"]);
    expect(out.events.at(-1)).toMatchObject({ kind: "end", reason: "done" });
  });

  it("support to Jira: a planted request to email a journalist is stopped twice over", async () => {
    const { world, out } = await run("support-to-jira", "m-203");
    const attempt = out.events.find((e) => e.kind === "call" && e.call.tool === "gmail_send");
    expect(attempt?.kind === "call" && attempt.result.status).toBe("stopped");
    const entry = out.sandbox.record.entries().find((e) => e.tool === "gmail_send");
    const reasons =
      entry?.decision.steps.filter((s) => s.outcome === "stop").map((s) => s.explanation) ?? [];
    expect(
      reasons.some((r) => r.startsWith('Automation rule "Turn support emails into Jira issues"')),
    ).toBe(true);
    expect(entry?.decision.steps.some((s) => s.step === "data-send" && s.outcome === "stop")).toBe(
      true,
    );
    expect(world.state.sent.map((s) => s.to)).toEqual(["jon.baker@example.com"]);
  });

  it("lead follow-up: the lead is added and the reply waits for approval", async () => {
    const { world, out } = await run("lead-follow-up", "m-204");
    expect(world.state.contacts.at(-1)).toMatchObject({
      email: "ella.morgan@example.net",
      kind: "lead",
    });
    expect(world.state.sent).toHaveLength(0);
    const held = out.sandbox.held();
    expect(held).toHaveLength(1);
    expect((await out.sandbox.approve(held[0]?.id ?? "", "Priya Shah")).status).toBe("done");
    expect(world.state.sent.map((s) => s.to)).toEqual(["ella.morgan@example.net"]);
  });

  it("weekly digest: posts the open issues to #support", async () => {
    const { world, env } = setup();
    const out = await runAutomation(
      example("weekly-digest").rule,
      { kind: "schedule", at: "2026-11-09T08:00:00Z" },
      env,
    );
    expect(out.events.at(-1)).toMatchObject({ kind: "end", reason: "done" });
    expect(world.state.slack[0]?.message).toMatch(/SUP-97[\s\S]*SUP-98/);
  });

  it("a rule can only narrow the organisation's rules", async () => {
    const { world, env, tick } = setup();
    const wide: AutomationRule = {
      ...example("meeting-replies").rule,
      id: "wide",
      title: "Wide",
      trigger: { kind: "manual" },
      runner: {
        kind: "code",
        source: [
          'for (let i = 0; i < 4; i++) log((await tools.gmail_send({ to: "a@example.org", subject: "s", body: "b" })).status);',
          'log((await tools.slack_post({ message: "hi" })).status);',
        ].join("\n"),
      },
      policy: {
        purpose: AUTOMATION_PURPOSE.communication,
        allow: [{ tool: "gmail_send", to: "anyone" }],
        sendsPerDay: 200,
      },
    };
    expect(validateRule(wide, env)).toEqual([]);
    const out = await runAutomation(wide, { kind: "manual" }, { ...env, clock: () => tick() });
    // The organisation allows three messages a day to one person, whatever the rule says;
    // Slack is not in this rule, so the code box does not even offer it.
    expect(
      out.events.filter((e) => e.kind === "say").map((e) => e.kind === "say" && e.text),
    ).toEqual(["done", "done", "done", "stopped"]);
    expect(out.events.at(-1)).toMatchObject({ kind: "end", reason: "error" });
    expect(world.state.slack).toHaveLength(0);
  });

  it("a model rule with no model connected says so", async () => {
    const { world, env } = setup();
    const event = world.receive(email("m-202"));
    const out = await runAutomation(example("support-to-jira").rule, event, env);
    expect(out.events).toEqual([
      { kind: "end", reason: "error", message: expect.stringMatching(/No model/) },
    ]);
  });

  it("the offline stand-in matches a request to the closest example", () => {
    expect(closestExample("When someone wants a meeting send my calendly")?.rule.id).toBe(
      "meeting-replies",
    );
    expect(closestExample("turn complaints into jira tickets")?.rule.id).toBe("support-to-jira");
    expect(closestExample("water the plants")).toBeUndefined();
  });
});

describe("the simulated apps", () => {
  const tool = (world: ReturnType<typeof createAppsWorld>, name: string) => {
    const t = world.tools.find((x) => x.name === name);
    if (!t) throw new Error(name);
    return t;
  };

  it("each tool checks its arguments and behaves like the app it stands in for", async () => {
    const world = createAppsWorld();
    const search = await tool(world, "gmail_search").run({ query: "meet" }, {});
    expect(search.items?.map((i) => i.label.title)).toEqual(["Email from Nadia Price"]);
    expect((await tool(world, "gmail_search").run({}, {})).items).toHaveLength(
      SAMPLE_EMAILS.length,
    );
    expect(() => tool(world, "gmail_reply").context?.({ message: "m-999", body: "x" })).toThrow(
      /no email/,
    );
    expect(() => tool(world, "gmail_reply").context?.({ message: "m-201", body: " " })).toThrow(
      /non-empty/,
    );
    expect(
      tool(world, "gmail_reply").context?.({ message: "m-205", body: "x" }),
    ).not.toHaveProperty("region");
    expect(() =>
      tool(world, "gmail_send").context?.({ to: "nope", subject: "s", body: "b" }),
    ).toThrow(/not an email address/);
    expect(
      await tool(world, "gmail_send").run({ to: "a@example.org", subject: "s", body: "b" }, {}),
    ).toEqual({
      content: "Sent.",
    });
    expect(await tool(world, "hubspot_find_contact").run({ email: "who@example.org" }, {})).toEqual(
      {
        content: "No contact with the address who@example.org.",
      },
    );
    const create = tool(world, "hubspot_create_contact");
    expect(create.context?.({ name: "A", email: "a@example.org" })).toEqual({});
    expect(await create.run({ name: "A", email: "a@example.org" }, {})).toEqual({
      content: "Added A as a lead.",
    });
    expect(await create.run({ name: "A", email: "A@example.org" }, {})).toEqual({
      content: "Already in HubSpot.",
    });
    const lead = await tool(world, "hubspot_find_contact").run({ email: "a@example.org" }, {});
    expect(lead.items?.[0]?.label.category).toBe("Lead record");
    const note = tool(world, "hubspot_add_note");
    expect(note.context?.({ email: "a@example.org", note: "n" })).toEqual({});
    expect(() => note.run({ email: "b@example.org", note: "n" }, {})).toThrow(/no contact/);
    expect(tool(world, "hubspot_find_contact").context?.({ email: "a@example.org" })).toEqual({});
    expect(await tool(world, "jira_search").run({ status: "closed" }, {})).toEqual({ items: [] });
    expect(tool(world, "slack_post").context?.({ message: "m" })).toMatchObject({
      recipients: [expect.any(String)],
    });
    expect(world.receive(email("m-201"))).toMatchObject({ kind: "email" });
    expect(world.state.inbox).toHaveLength(SAMPLE_EMAILS.length);
    world.receive({ id: "m-900", from: "x@example.org", fromName: "X", subject: "s", body: "b" });
    expect(world.state.inbox).toHaveLength(SAMPLE_EMAILS.length + 1);
  });

  it("the stand-in scripts cover non-email events", () => {
    for (const ex of AUTOMATION_EXAMPLES) expect(ex.script?.({ kind: "manual" }) ?? []).toEqual([]);
  });
});
