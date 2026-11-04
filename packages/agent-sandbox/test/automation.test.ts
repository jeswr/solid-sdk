// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  type AutomationRule,
  type CallLock,
  type Commitment,
  createLock,
  createSandbox,
  DEMO_START,
  describeMandate,
  ruleMandate,
  ruleTools,
  runAutomation,
  scriptedModel,
  senderOf,
  singleAddress,
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

const DEMO_ISO = new Date(DEMO_START).toISOString();

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

describe("review fixes", () => {
  const meeting = () => example("meeting-replies").rule;
  const ask = (id: string, from: string) => ({
    id,
    from,
    fromName: "Someone",
    subject: "Can we meet?",
    body: "Could we meet next week?",
  });

  it("daily limits count across runs, for the rule and for the organisation", async () => {
    const { world, env, tick } = setup();
    const rule: AutomationRule = { ...meeting(), policy: { ...meeting().policy, sendsPerDay: 1 } };
    const at = { ...env, clock: () => tick() };
    await runAutomation(rule, world.receive(ask("x1", "a@example.org")), at);
    await runAutomation(rule, world.receive(ask("x2", "b@example.org")), at);
    expect(world.state.sent.map((s) => s.to)).toEqual(["a@example.org"]);
    // The organisation's three-a-day per person also spans runs and rules.
    const roomy: AutomationRule = {
      ...meeting(),
      id: "roomy",
      policy: { ...meeting().policy, sendsPerDay: 200 },
    };
    for (let i = 0; i < 5; i++)
      await runAutomation(roomy, world.receive(ask(`y${i}`, "c@example.org")), at);
    expect(world.state.sent.filter((s) => s.to === "c@example.org")).toHaveLength(3);
  });

  it("recipients must be one of the vocabulary's forms, or the rule is invalid and cannot run", () => {
    const { env } = setup();
    for (const to of [
      "everyone",
      "Sender",
      null,
      {},
      ["reporter@newsdesk.example"],
      ["mailto:a@b.c, d@e.f"],
    ]) {
      const rule = {
        ...meeting(),
        policy: { ...meeting().policy, allow: [{ tool: "gmail_reply", to }] },
      } as unknown as AutomationRule;
      expect(validateRule(rule, env).join(" ")).toMatch(/recipients wrongly/);
      expect(() =>
        ruleMandate(rule, env, {
          agent: AUTOMATION_AGENT,
          event: { kind: "manual" },
          at: "2026-11-04T09:00:00Z",
        }),
      ).toThrow(/recipients wrongly/);
    }
    const proto = { ...meeting(), policy: { ...meeting().policy, purpose: "constructor" } };
    expect(validateRule(proto, env).join(" ")).toMatch(/not one of the organisation's purposes/);
  });

  it("in AI-judge mode the rule's own policy still binds, whatever the judge says", async () => {
    const { world, env } = setup();
    const ex = example("support-to-jira");
    const event = world.receive(email("m-203"));
    const yes = { name: "yes", complete: async () => '{"outcome":"permit","reason":"fine"}' };
    let prompt = "";
    const judge = {
      name: "yes",
      complete: async (_s: string, p: string) => {
        prompt = p;
        return yes.complete();
      },
    };
    const out = await runAutomation(
      ex.rule,
      event,
      { ...env, mode: "llm", judge },
      {
        ...(ex.script && { model: scriptedModel("Stand-in", ex.script(event)) }),
      },
    );
    expect(world.state.sent.map((s) => s.to)).toEqual(["jon.baker@example.com"]);
    expect(prompt).toMatch(/ALSO apply \(Automation rule/);
    expect(out.sandbox.tools().map((t) => t.name)).not.toContain("slack_post");
  });

  it("a sender must be exactly one address; case does not matter", async () => {
    expect(singleAddress("Nadia.Price@Example.org")).toBe("nadia.price@example.org");
    expect(singleAddress("mailto:a@b.c")).toBe("a@b.c");
    expect(singleAddress("victim@example.org, attacker@evil.example")).toBeUndefined();
    expect(senderOf({ kind: "manual" })).toBeUndefined();
    const { world, env } = setup();
    await runAutomation(meeting(), world.receive(ask("z1", "Nadia.Price@Example.org")), env);
    await runAutomation(
      meeting(),
      world.receive(ask("z2", "victim@example.org, attacker@evil.example")),
      env,
    );
    expect(world.state.sent.map((s) => s.to)).toEqual(["nadia.price@example.org"]);
  });

  it("a narrowing mandate stops what it does not list, even when unlisted calls go to a person", async () => {
    const { world, env } = setup();
    const rule = meeting();
    const narrowing = {
      name: "Rule",
      mandate: ruleMandate(rule, env, {
        agent: AUTOMATION_AGENT,
        event: { kind: "manual" },
        at: "2026-11-04T09:00:00Z",
      }),
    };
    const sandbox = createSandbox({
      tools: env.tools,
      rules: () => ({ ...world.rules(), also: [narrowing] }),
      directory: env.directory,
      agent: AUTOMATION_AGENT,
      purpose: rule.policy.purpose,
      unlisted: "review",
      clock: () => DEMO_START,
    });
    const r = await sandbox.call({ tool: "slack_post", args: { message: "hi" } });
    expect(r.status).toBe("stopped");
    expect(sandbox.catalogue().find((e) => e.tool.name === "slack_post")?.visible).toBe(false);
  });

  it("a rule's tools keep their identity: a neighbour with the same action and system stays out", async () => {
    const { world, env } = setup();
    const event = world.receive(ask("t1", "nadia@example.org"));
    // gmail_send shares gmail_reply's action and system, and the address is the sender's own.
    const model = scriptedModel("Stand-in", [
      {
        text: "",
        calls: [
          {
            id: "a",
            tool: "gmail_send",
            args: { to: "nadia@example.org", subject: "Hi", body: "Book here." },
          },
        ],
      },
      { text: "Done.", calls: [] },
    ]);
    const llm = { ...meeting(), runner: { kind: "llm" as const, instructions: "Reply." } };
    const out = await runAutomation(llm, event, env, { model });
    expect(out.sandbox.tools().map((t) => t.name)).toEqual(["gmail_reply"]);
    const call = out.events.find((e) => e.kind === "call");
    expect(call?.kind === "call" && call.result.status).toBe("stopped");
    expect(world.state.sent).toEqual([]);
    const entry = out.sandbox.catalogue().find((e) => e.tool.name === "gmail_send");
    expect(entry?.reason).toMatch(/Hidden by Automation rule .*does not list/);
    // The same holds when an AI judge decides instead of the policy.
    const judged = await runAutomation(
      llm,
      event,
      { ...env, mode: "llm", judge: { name: "yes", complete: async () => '{"outcome":"permit"}' } },
      { model },
    );
    expect(judged.sandbox.tools().map((t) => t.name)).toEqual(["gmail_reply"]);
    expect(world.state.sent).toEqual([]);
  });

  it("tools that share an action and system must be allowed on the same terms", async () => {
    const { world, env } = setup();
    const mixed: AutomationRule = {
      ...meeting(),
      policy: {
        ...meeting().policy,
        allow: [
          { tool: "gmail_reply", to: "sender" },
          { tool: "gmail_send", to: "staff" },
        ],
      },
    };
    expect(validateRule(mixed, env).join(" ")).toMatch(
      /must have the same recipients and approval/,
    );
    expect(() =>
      ruleMandate(mixed, env, { agent: AUTOMATION_AGENT, event: { kind: "manual" }, at: "x" }),
    ).toThrow(/must have the same recipients and approval/);
    const asked: AutomationRule = {
      ...mixed,
      policy: {
        ...mixed.policy,
        allow: [
          { tool: "gmail_reply", to: "sender" },
          { tool: "gmail_send", to: "sender", approval: true },
        ],
      },
    };
    expect(validateRule(asked, env).join(" ")).toMatch(
      /must have the same recipients and approval/,
    );
    const same: AutomationRule = {
      ...mixed,
      policy: {
        ...mixed.policy,
        allow: [
          { tool: "gmail_reply", to: "sender" },
          { tool: "gmail_send", to: "sender" },
        ],
      },
    };
    expect(validateRule(same, env)).toEqual([]);
    await expect(
      runAutomation(mixed, world.receive(ask("t2", "a@example.org")), env),
    ).rejects.toThrow(/cannot run/);
  });

  it("tools whose actions overlap in one system must be allowed on the same terms", () => {
    const { env } = setup();
    const base = env.tools.find((t) => t.name === "jira_search");
    if (!base) throw new Error("jira_search");
    const tools = [
      { ...base, name: "jira_use", action: "use" },
      { ...base, name: "jira_peek", action: "read" },
    ];
    const rule: AutomationRule = {
      ...meeting(),
      policy: {
        ...meeting().policy,
        allow: [{ tool: "jira_use" }, { tool: "jira_peek", approval: true }],
      },
    };
    expect(validateRule(rule, { ...env, tools }).join(" ")).toMatch(/overlapping things/);
    const agreed = {
      ...rule,
      policy: { ...rule.policy, allow: [{ tool: "jira_use" }, { tool: "jira_peek" }] },
    };
    expect(validateRule(agreed, { ...env, tools })).toEqual([]);
    // Overlap is not transitive: read and modify do not overlap, but use covers both, so use
    // is checked against each of them, not only the first.
    const three = [
      { ...base, name: "jira_peek", action: "read" },
      { ...base, name: "jira_edit", action: "modify" },
      { ...base, name: "jira_use", action: "use" },
    ];
    const chain: AutomationRule = {
      ...rule,
      policy: {
        ...rule.policy,
        allow: [{ tool: "jira_peek" }, { tool: "jira_edit", approval: true }, { tool: "jira_use" }],
      },
    };
    expect(validateRule(chain, { ...env, tools: three })).toEqual([
      '"jira_edit" and "jira_use" do overlapping things in the same system, so they must have the same recipients and approval.',
    ]);
  });

  it("an invalid rule never runs, and a sending tool without recipients never compiles", async () => {
    const { world, env } = setup();
    const open = {
      ...meeting(),
      policy: { ...meeting().policy, allow: [{ tool: "gmail_reply" }] },
    } as AutomationRule;
    await expect(
      runAutomation(open, world.receive(ask("t3", "a@example.org")), env),
    ).rejects.toThrow(/must say who it may send to/);
    expect(() =>
      ruleMandate(open, env, { agent: AUTOMATION_AGENT, event: { kind: "manual" }, at: "x" }),
    ).toThrow(/must say who it may send to/);
    expect(world.state.sent).toEqual([]);
  });

  it("sandboxes that share a history and a lock never both pass a limit", async () => {
    const { world, env } = setup();
    const rule: AutomationRule = { ...meeting(), policy: { ...meeting().policy, sendsPerDay: 1 } };
    const history: Commitment[] = [];
    const commitments: Commitment[] = [];
    const sandboxFor = (id: string, from: string, lock?: CallLock) => {
      const event = world.receive(ask(id, from));
      const narrowing = {
        name: "Rule",
        mandate: ruleMandate(rule, env, { agent: AUTOMATION_AGENT, event, at: DEMO_ISO }),
        tools: ["gmail_reply"],
        history,
      };
      return createSandbox({
        tools: env.tools,
        rules: () => ({ ...world.rules(), also: [narrowing] }),
        directory: env.directory,
        agent: AUTOMATION_AGENT,
        purpose: rule.policy.purpose,
        clock: () => DEMO_START,
        commitments,
        ...(lock && { lock }),
      });
    };
    const reply = (id: string) => ({
      tool: "gmail_reply",
      args: { message: id, body: "Book here." },
    });
    // Without a shared lock, both runs check the limit before either counts its send.
    const a = sandboxFor("q1", "q1@example.org");
    const b = sandboxFor("q2", "q2@example.org");
    const raced = await Promise.all([a.call(reply("q1")), b.call(reply("q2"))]);
    expect(raced.map((r) => r.status)).toEqual(["done", "done"]);
    // With one, the second waits, sees the first send, and stops.
    history.length = 0;
    commitments.length = 0;
    const lock = createLock();
    const c = sandboxFor("q3", "q3@example.org", lock);
    const d = sandboxFor("q4", "q4@example.org", lock);
    const locked = await Promise.all([c.call(reply("q3")), d.call(reply("q4"))]);
    expect(locked.map((r) => r.status)).toEqual(["done", "stopped"]);
  });

  it("every run in the apps world shares one lock", () => {
    const { world } = setup();
    expect(world.env(() => DEMO_START).lock).toBe(world.env(() => DEMO_START).lock);
  });
});
