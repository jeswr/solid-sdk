// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { outcomeOf } from "../src/index.js";
import {
  createMortgageWorld,
  MORTGAGE_STORY,
  type MortgageStep,
  runMortgageStep,
} from "../src/world/index.js";

const playAll = async () => {
  const world = createMortgageWorld();
  const outcomes: { step: MortgageStep; outcome: string; message?: string }[] = [];
  for (const step of MORTGAGE_STORY.steps) {
    const { result } = await runMortgageStep(world, step);
    outcomes.push({
      step,
      outcome: outcomeOf(result),
      ...("message" in result && { message: result.message }),
    });
  }
  return { world, outcomes };
};

describe("the mortgage story", () => {
  it("every step gets the outcome the story expects", async () => {
    const { outcomes } = await playAll();
    for (const o of outcomes)
      if (o.step.kind === "call")
        expect([o.step.call.tool, o.outcome]).toEqual([o.step.call.tool, o.step.expect]);
      else expect([o.step.by, o.outcome]).toEqual([o.step.by, "permit"]);
  });

  it("Alex's rules travel with the data: the insurer gets nothing and the health record stays put", async () => {
    const { world, outcomes } = await playAll();
    expect(world.state.partnerShares).toEqual([]);
    expect(world.state.received).toEqual(["income", "identity", "transactions"]);
    const partner = outcomes.find(
      (o) => o.step.kind === "call" && o.step.call.tool === "partner_share",
    );
    expect(partner?.message).toMatch(/Homecover/);
    expect(partner?.message).toMatch(/Alex/);
    const health = outcomes.find(
      (o) => o.step.kind === "call" && o.step.call.args.record === "health",
    );
    expect(health?.outcome).toBe("stop");
  });

  it("offers are made and accepted only after a person on each side says yes", async () => {
    const { world } = await playAll();
    expect(world.state.offers).toEqual([{ amount: 310000, rate: 4.1, years: 25, accepted: true }]);
    expect(world.sandboxes.personal.obligations().length).toBeGreaterThan(0);
  });

  it("each agent sees only its own tools, and the rest are not offered", async () => {
    const world = createMortgageWorld();
    expect(world.sandboxes.assistant.tools().map((t) => t.name)).not.toContain("offer_issue");
    const r = await world.sandboxes.assistant.call({
      tool: "offer_issue",
      args: { amount: 1, rate: 1, years: 1 },
    });
    expect(r.status).toBe("stopped");
    const signed = await world.sandboxes.underwriter.call({
      tool: "offer_issue",
      args: { amount: 1, rate: 1, years: 1 },
    });
    expect(signed.status).toBe("held");
  });

  it("an approval with nothing waiting is an error", async () => {
    const world = createMortgageWorld();
    await expect(
      runMortgageStep(world, { kind: "approve", agent: "personal", by: "Alex", why: "" }),
    ).rejects.toThrow(/nothing waiting/);
  });

  it("documents that do not exist are refused", async () => {
    const world = createMortgageWorld();
    const r = await world.sandboxes.personal.call({
      tool: "lender_send",
      args: { documents: ["payslip-forged"] },
    });
    expect(r.status).toBe("stopped");
  });
});

describe("the mortgage tools refuse bad input", () => {
  it("sends need documents, records must exist, and offers must exist", async () => {
    const world = createMortgageWorld();
    const p = world.sandboxes.personal;
    expect((await p.call({ tool: "lender_send", args: { documents: [] } })).status).toBe("stopped");
    expect((await p.call({ tool: "lender_send", args: {} })).status).toBe("stopped");
    const a = world.sandboxes.assistant;
    expect((await a.call({ tool: "request_documents", args: { documents: ["x"] } })).status).toBe(
      "stopped",
    );
    expect((await p.call({ tool: "pod_read", args: { record: "diary" } })).status).toBe("failed");
    // No offer yet: nothing to accept.
    expect((await p.call({ tool: "offer_accept", args: {} })).status).toBe("stopped");
  });

  it("an approval accepts exactly the offer it was asked about, not a newer one", async () => {
    const world = createMortgageWorld();
    const u = world.sandboxes.underwriter;
    const first = await u.call({
      tool: "offer_issue",
      args: { amount: 310000, rate: 4.1, years: 25 },
    });
    if (first.status !== "held") throw new Error("expected held");
    await u.approve(first.approval, "Ruth");
    const accept = await world.sandboxes.personal.call({ tool: "offer_accept", args: {} });
    if (accept.status !== "held") throw new Error("expected held");
    const worse = await u.call({
      tool: "offer_issue",
      args: { amount: 310000, rate: 9.9, years: 40 },
    });
    if (worse.status !== "held") throw new Error("expected held");
    await u.approve(worse.approval, "Ruth");
    const out = await world.sandboxes.personal.approve(accept.approval, "Alex");
    expect(out.status).toBe("stopped");
    expect(world.state.offers.map((o) => o.accepted)).toEqual([false, false]);
  });

  it("a fresh assistant session still cannot pass Alex's data to the insurer", async () => {
    const world = createMortgageWorld();
    await runMortgageStep(world, MORTGAGE_STORY.steps[0] as MortgageStep);
    await runMortgageStep(world, MORTGAGE_STORY.steps[2] as MortgageStep);
    const r = await world.sandboxes.assistant.call({
      tool: "partner_share",
      args: { note: "Alex earns £5,200 a month." },
    });
    expect(r.status).toBe("stopped");
    expect(world.state.partnerShares).toEqual([]);
  });

  it("an offer that changed under the approval is not accepted", async () => {
    const world = createMortgageWorld();
    const u = world.sandboxes.underwriter;
    const first = await u.call({ tool: "offer_issue", args: { amount: 1, rate: 1, years: 1 } });
    if (first.status !== "held") throw new Error("expected held");
    await u.approve(first.approval, "Ruth");
    const accept = await world.sandboxes.personal.call({ tool: "offer_accept", args: {} });
    if (accept.status !== "held") throw new Error("expected held");
    const offer = world.state.offers[0];
    if (offer) offer.rate = 2;
    expect((await world.sandboxes.personal.approve(accept.approval, "Alex")).status).toBe(
      "stopped",
    );
  });

  it("an offer with bad numbers is refused, and a step reports its decision", async () => {
    const world = createMortgageWorld();
    const out = await runMortgageStep(world, {
      kind: "call",
      agent: "underwriter",
      thought: "",
      call: { tool: "offer_issue", args: { amount: "lots", rate: 1, years: 1 } },
      expect: "stop",
      why: "",
    });
    expect(out.decision?.outcome).toBe("stop");
    expect(world.sandboxes.underwriter.held()).toEqual([]);
    expect(world.state.offers).toEqual([]);
  });

  it("messages between agents carry no free text, and records travel with their labels", async () => {
    const world = createMortgageWorld();
    for (const step of MORTGAGE_STORY.steps.slice(0, 11)) await runMortgageStep(world, step);
    const [application, request, , referral] = world.state.messages;
    expect(application?.kind).toBe("application");
    expect(application?.text).toBe(
      "Alex's agent sent: Alex's payslips, Aug to Oct 2026, Alex's passport.",
    );
    expect(request).toMatchObject({ kind: "request", items: [], wanted: ["transactions"] });
    // Each enclosed record keeps the owner's policy it was sent under.
    for (const item of application?.items ?? [])
      expect(JSON.stringify(item.label.policy)).toMatch(/purposes\/mortgage/);
    expect(referral?.kind).toBe("referral");
    expect(referral?.items.map((i) => i.label.id)).toEqual([
      expect.stringMatching(/records\/income$/),
      expect.stringMatching(/records\/identity$/),
      expect.stringMatching(/records\/transactions$/),
    ]);
    // Underwriting reads only what was referred to it, and its sandbox now holds those labels.
    const read = world.sandboxes.underwriter.labels().map((l) => l.id);
    expect(read).toHaveLength(3);
  });

  it("an agent only takes in records sent to it", async () => {
    const world = createMortgageWorld();
    await runMortgageStep(world, MORTGAGE_STORY.steps[2] as MortgageStep);
    const u = await world.sandboxes.underwriter.call({ tool: "application_read", args: {} });
    expect(u.status === "done" && u.content).toEqual({ records: [], withheld: 0 });
    await world.sandboxes.assistant.call({ tool: "application_read", args: {} });
    expect(world.sandboxes.assistant.labels()).toHaveLength(2);
  });

  it("an offer is issued on the terms that were approved, which must make sense", async () => {
    const world = createMortgageWorld();
    const u = world.sandboxes.underwriter;
    const args = { amount: 310000, rate: 4.1, years: 25 };
    const held = await u.call({ tool: "offer_issue", args });
    if (held.status !== "held") throw new Error("expected held");
    // Terms changed after the approval was asked for: the approval does not carry over.
    args.rate = 0.1;
    expect((await u.approve(held.approval, "Ruth")).status).toBe("stopped");
    expect(world.state.offers).toEqual([]);
    const again = await u.call({
      tool: "offer_issue",
      args: { amount: 310000, rate: 4.1, years: 25 },
    });
    if (again.status !== "held") throw new Error("expected held");
    expect((await u.approve(again.approval, "Ruth")).status).toBe("done");
    expect(world.state.offers).toEqual([{ amount: 310000, rate: 4.1, years: 25, accepted: false }]);
    for (const bad of [
      { amount: -1, rate: 4, years: 25 },
      { amount: 1.5, rate: 4, years: 25 },
      { amount: 1, rate: 0, years: 25 },
      { amount: 1, rate: 4, years: 99 },
      { amount: "1", rate: 4, years: 25 },
    ])
      expect((await u.call({ tool: "offer_issue", args: bad })).status).toBe("stopped");
  });
});
