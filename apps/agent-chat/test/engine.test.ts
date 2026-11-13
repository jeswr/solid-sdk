// AUTHORED-BY Claude Opus 5.5
import type { ApprovalRequest, PrincipalResponse } from "@jeswr/agent-consent";
import { describe, expect, it } from "vitest";
import { Session } from "../src/engine/session.js";
import type { ChatMessage } from "../src/engine/types.js";

const NOW = new Date("2026-11-13T12:00:00.000Z");

/** Answers each approval with the next scripted answer, recording what was asked. */
function harness(answers: ((r: ApprovalRequest) => PrincipalResponse)[]) {
  const session = new Session({ pace: 0, now: () => NOW });
  const asked: ApprovalRequest[] = [];
  session.engine.subscribe((s) => {
    const req = s.pending?.request;
    if (req && !asked.includes(req)) {
      asked.push(req);
      const answer = answers.shift();
      if (answer) queueMicrotask(() => void session.engine.respond(answer(req)));
    }
  });
  const messages = (): readonly ChatMessage[] => session.engine.getState().chats[0]?.messages ?? [];
  return { session, asked, messages };
}

const once = (r: ApprovalRequest): PrincipalResponse => ({
  type: "approve-once",
  offeredId: r.offered.find((o) => o.type === "approve-once")?.id ?? "?",
});
const setLimit = (r: ApprovalRequest): PrincipalResponse => {
  const o = r.offered.find((x) => x.type === "set-limit");
  if (!o?.draft) throw new Error("no set-limit offered");
  return { type: "set-limit", offeredId: o.id, draft: o.draft };
};

describe("the demo scenarios run through the gates", () => {
  it("(a)-(d): refuses the injected upsell, sets a limit, buys within it, asks over it", async () => {
    const { session, asked, messages } = harness([setLimit, once]);
    await session.send("Find me running sneakers under $25");
    const products = messages().find((m) => m.type === "products");
    expect(products?.type === "products" && products.items.map((p) => p.name)).toEqual([
      "Roadrunner Lite",
      "Dash 2",
      "Tempo",
    ]);

    await session.choose("p:roadrunner", "size 9, grey", "Roadrunner Lite, size 9");
    const blocked = messages().find((m) => m.type === "blocked");
    expect(blocked?.type === "blocked" && blocked.quoted).toContain("protection plan");
    expect(asked[0]?.title).toBe("Buy Roadrunner Lite for $20?");
    expect(asked[0]?.offered.map((o) => o.label)).toEqual([
      "Approve once",
      "Set a spending limit",
      "Not now",
    ]);
    const draft = asked[0]?.offered[1]?.draft;
    expect(draft?.limit.minor).toBe(10_000);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(1);
    expect(session.engine.getState().rules[0]?.used.minor).toBe(2000);

    await session.send("Add a pair of trail socks from the same store");
    expect(asked).toHaveLength(1); // no ask: inside the limit
    const chip = messages()
      .filter((m) => m.type === "limit-chip")
      .at(-1);
    expect(chip?.type === "limit-chip" && chip.used.minor).toBe(3200);

    await session.send("Get the Stride & Co rain jacket too");
    expect(asked[1]?.kind).toBe("limit-exceeded");
    expect(asked[1]?.title).toBe("This goes over your $100 a month at Stride & Co by $17");
    expect(asked[1]?.offered.map((o) => o.label)).toEqual([
      "Just this once",
      "Raise limit",
      "Not now",
    ]);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(3);
    // The one-off is not charged to the budget.
    expect(session.engine.getState().rules[0]?.used.minor).toBe(3200);
    const activity = session.engine.getState().activity;
    expect(activity.some((a) => a.outcome === "stop" && a.filter === "blocked")).toBe(true);
    expect(activity.filter((a) => a.filter === "purchases")).toHaveLength(3);
  });

  it("(e): shares less with the lender, asks for a face check, gets a signed decision in principle", async () => {
    const shareLess = (r: ApprovalRequest): PrincipalResponse => ({
      type: "share-less",
      offeredId: "share-less",
      keep:
        r.action.type === "share" ? r.action.fields.filter((f) => f.required).map((f) => f.id) : [],
    });
    const faceCheck = (r: ApprovalRequest): PrincipalResponse => ({
      type: "step-up-done",
      offeredId: r.offered[0]?.id ?? "?",
      attestation: "face-check",
    });
    const { session, asked, messages } = harness([shareLess, faceCheck]);
    await session.send("Get a mortgage decision in principle");
    expect(messages().some((m) => m.type === "comparison")).toBe(true);
    await session.send("Go with North Bank");
    expect(asked[0]?.kind).toBe("disclosure");
    expect(asked[0]?.title).toBe("Share 3 things with North Bank?");
    expect(asked[0]?.standingWithheldReason).toBe("This kind of sharing needs your OK each time.");
    expect(asked[1]?.kind).toBe("step-up");
    const offer = messages().find((m) => m.type === "offer");
    expect(offer?.type === "offer" && offer.headline).toBe("Decision in principle: up to $285,000");
    const shared = session.engine.getState().activity.find((a) => a.summary.startsWith("Shared"));
    expect(shared?.summary).toBe("Shared income, bank balance with North Bank");
  });

  it("stop cancels a pending approval and refuses further work", async () => {
    const { session, asked, messages } = harness([]);
    await session.send("Find me running sneakers under $25");
    const pending = session.choose("p:dash2", "size 9, navy", "Dash 2");
    await new Promise((r) => setTimeout(r, 20));
    expect(asked[0]?.title).toBe("Buy Dash 2 for $27.49?");
    session.engine.stop();
    await pending;
    expect(session.engine.getState().pending).toBeUndefined();
    expect(messages().some((m) => m.type === "approval" && m.state === "cancelled")).toBe(true);
    await session.send("Add trail socks");
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(0);
  });

  it("an unconfirmed store gets approve-once only", async () => {
    const { session, asked } = harness([() => ({ type: "deny", offeredId: "deny" })]);
    await session.send("Find me running sneakers under $25");
    await session.choose("p:tempo", "size 9, white", "Tempo");
    expect(asked[0]?.kind).toBe("new-recipient");
    expect(asked[0]?.offered.map((o) => o.label)).toEqual(["Allow this time", "Not now"]);
    expect(asked[0]?.standingWithheldReason).toContain("once Fleet Foot Market is confirmed");
  });
});
