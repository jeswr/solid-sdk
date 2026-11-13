// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import {
  type ApprovalRequest,
  type DeviceKey,
  type PrincipalResponse,
  type SpendRecord,
  signRecord,
  verifyRecord,
} from "@jeswr/agent-consent";
import { describe, expect, it, vi } from "vitest";
import type { SampleTool } from "../src/engine/core.js";
import { Engine, StoppedError } from "../src/engine/engine.js";
import { Parties } from "../src/engine/parties.js";
import { Session } from "../src/engine/session.js";
import type { ChatMessage } from "../src/engine/types.js";
import { PRODUCTS } from "../src/engine/world.js";

const NOW = new Date("2026-11-13T12:00:00.000Z");

/** Answers each approval with the next scripted answer, recording what was asked. */
function harness(answers: ((r: ApprovalRequest) => PrincipalResponse)[], now = () => NOW) {
  const session = new Session({ pace: 0, now });
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
  requestId: r.id,
  digest: r.digest,
  type: "approve-once",
  offeredId: r.offered.find((o) => o.type === "approve-once")?.id ?? "?",
});
const setLimit = (r: ApprovalRequest): PrincipalResponse => {
  const o = r.offered.find((x) => x.type === "set-limit");
  if (!o?.draft) throw new Error("no set-limit offered");
  return { requestId: r.id, digest: r.digest, type: "set-limit", offeredId: o.id, draft: o.draft };
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
      requestId: r.id,
      digest: r.digest,
      type: "share-less",
      offeredId: "share-less",
      keep:
        r.action.type === "share" ? r.action.fields.filter((f) => f.required).map((f) => f.id) : [],
    });
    const faceCheck = (r: ApprovalRequest): PrincipalResponse => ({
      requestId: r.id,
      digest: r.digest,
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
    const { session, asked } = harness([deny]);
    await session.send("Find me running sneakers under $25");
    await session.choose("p:tempo", "size 9, white", "Tempo");
    expect(asked[0]?.kind).toBe("new-recipient");
    expect(asked[0]?.offered.map((o) => o.label)).toEqual(["Allow this time", "Not now"]);
    expect(asked[0]?.standingWithheldReason).toContain("once Fleet Foot Market is confirmed");
  });
});

const deny = (r: ApprovalRequest): PrincipalResponse => ({
  requestId: r.id,
  digest: r.digest,
  type: "deny",
  offeredId: "deny",
});
const face = (r: ApprovalRequest): PrincipalResponse => ({
  requestId: r.id,
  digest: r.digest,
  type: "step-up-done",
  offeredId: "step-up",
  attestation: "face-check",
});
const limit =
  (minor: number, kind: "budget" | "allowance" = "budget") =>
  (r: ApprovalRequest): PrincipalResponse => {
    const response = setLimit(r);
    if (response.type !== "set-limit") throw new Error("expected limit");
    const { period: _period, ...draft } = response.draft;
    return {
      ...response,
      draft: {
        ...draft,
        kind,
        limit: { minor, currency: "USD" },
        ...(kind === "budget" ? { period: "month" } : {}),
      },
    };
  };
const raise =
  (minor: number) =>
  (r: ApprovalRequest): PrincipalResponse => {
    const offered = r.offered.find((o) => o.type === "raise-limit");
    if (!offered?.draft) throw new Error("no raise offered");
    return {
      requestId: r.id,
      digest: r.digest,
      type: "raise-limit",
      offeredId: offered.id,
      draft: { ...offered.draft, limit: { minor, currency: "USD" } },
    };
  };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Pause one real signed exchange without replacing the crypto or inbound gate. */
function pauseSigning(matches: (payload: Record<string, unknown>) => boolean) {
  const entered = deferred();
  const release = deferred();
  const original = Parties.prototype.sign;
  const spy = vi.spyOn(Parties.prototype, "sign").mockImplementation(async function (
    this: Parties,
    from,
    payload,
  ) {
    if (matches(payload)) {
      entered.resolve();
      await release.promise;
    }
    return original.call(this, from, payload);
  });
  return { entered: entered.promise, release: release.resolve, restore: () => spy.mockRestore() };
}

describe("second adversarial review", () => {
  it("revocation immediately disables a rule behind an approval and persists across Stop", async () => {
    const { session, messages } = harness([limit(10000)]);
    await session.send("buy socks");
    const engine = session.engine;
    const ruleId = engine.getState().rules[0]?.rule.id as string;
    const application = engine.mortgageApply(engine.getState().activeChat).catch((e: unknown) => e);
    await vi.waitFor(() => expect(engine.getState().pending?.request.kind).toBe("disclosure"));
    const revocation = engine.revokeRule(ruleId, engine.getState().activeChat);
    const removedImmediately = engine.getState().rules.length === 0;
    engine.stop();
    engine.resume();
    const [revoked] = await Promise.allSettled([revocation, application]);
    const internals = engine as unknown as { ruleRecords: string[]; key: DeviceKey };
    const records = await Promise.all(
      internals.ruleRecords.map((jws) => verifyRecord(jws, internals.key.publicJwk)),
    );
    const purchase = engine.buy(engine.getState().activeChat, "p:socks");
    await vi.waitFor(() => expect(engine.getState().pending).toBeDefined()).catch(() => undefined);
    const pending = engine.getState().pending;
    if (pending) await engine.respond(deny(pending.request));
    await purchase;
    expect(removedImmediately).toBe(true);
    expect(revoked.status).toBe("fulfilled");
    expect(records).toContainEqual(expect.objectContaining({ type: "revocation", ruleId }));
    expect(engine.getState().rules).toHaveLength(0);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(1);
  });

  it("can revoke while already stopped without a new action run", async () => {
    const { session } = harness([limit(10000)]);
    await session.send("buy socks");
    const engine = session.engine;
    const ruleId = engine.getState().rules[0]?.rule.id as string;
    engine.stop();
    await expect(engine.revokeRule(ruleId)).resolves.toBeUndefined();
    expect(engine.getState().rules).toHaveLength(0);
  });

  it("rechecks a rule revoked after authorization but before the purchase starts", async () => {
    const { session, messages } = harness([limit(10000), deny]);
    await session.send("buy socks");
    const engine = session.engine;
    const internals = engine as unknown as { passGate(...args: unknown[]): Promise<unknown> };
    const original = internals.passGate.bind(engine);
    const entered = deferred();
    const release = deferred();
    const spy = vi.spyOn(internals, "passGate").mockImplementation(async (...args) => {
      const result = await original(...args);
      entered.resolve();
      await release.promise;
      return result;
    });
    const purchase = engine.buy(engine.getState().activeChat, "p:socks");
    await entered.promise;
    const revocation = engine.revokeRule(engine.getState().rules[0]?.rule.id as string);
    release.resolve();
    let result: unknown;
    try {
      [result] = await Promise.all([purchase, revocation]);
    } finally {
      spy.mockRestore();
    }
    expect(result).toBe("denied");
    expect(messages().filter((message) => message.type === "receipt")).toHaveLength(1);
  });

  it("compares signed approval timestamps as instants, including at expiry", async () => {
    const { session } = harness([]);
    const engine = session.engine;
    await engine.ready;
    const internals = engine as unknown as {
      key: DeviceKey;
      approvalRecords: Map<string, string>;
      verifiedApprovals(): Promise<Set<string>>;
    };
    const digest = `sha-256:${"a".repeat(64)}`;
    const put = async (issuedAt: string, expiresAt: string) => {
      internals.approvalRecords.set(
        digest,
        await signRecord(internals.key, {
          type: "approval",
          id: "time",
          decision: "approve",
          actionDigest: digest,
          issuedAt,
          expiresAt,
        }),
      );
      return internals.verifiedApprovals();
    };
    expect(await put("2026-11-13T12:00:00Z", "2026-11-13T12:10:00Z")).toContain(digest);
    expect(await put("2026-11-13T11:00:00Z", "2026-11-13T12:00:00Z")).not.toContain(digest);
    expect(await put("2026-11-13T12:00:00.001Z", "2026-11-13T12:10:00Z")).not.toContain(digest);
    expect(await put("2026-11-13T10:00:00+02:00", "2026-11-13T13:00:00+02:00")).not.toContain(
      digest,
    );
  });

  it.each([
    "resolve",
    "reject",
  ])("closes retained callbacks on sampling %s before draining or fallback", async (settlement) => {
    const { session, messages } = harness([limit(10000)]);
    await session.send("buy socks");
    let retained!: SampleTool;
    session.enableLive(async (_input, { tools }) => {
      retained = tools.find((tool) => tool.name === "buy_product") as SampleTool;
      if (settlement === "reject") throw new Error("offline before dispatch");
      return { text: "" };
    });
    session.engine.setCore("live");
    await session.send("buy socks");
    const receiptsBefore = messages().filter((m) => m.type === "receipt").length;
    await expect(
      Promise.resolve().then(() => retained.execute({ product_id: "p:socks" })),
    ).rejects.toThrow("closed");
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(receiptsBefore);
  });

  it("drains accepted tools after sampling settles while rejecting new dispatch", async () => {
    const { session, messages } = harness([limit(10000)]);
    await session.send("buy socks");
    const pause = pauseSigning((payload) => typeof payload.order === "string");
    let retained!: SampleTool;
    let accepted!: Promise<unknown>;
    const settled = deferred();
    session.enableLive(async (_input, { tools }) => {
      retained = tools.find((tool) => tool.name === "buy_product") as SampleTool;
      accepted = retained.execute({ product_id: "p:socks" });
      await pause.entered;
      settled.resolve();
      return { text: "" };
    });
    session.engine.setCore("live");
    const request = session.send("buy socks");
    await settled.promise;
    // Let the fulfilled sample propagate to the request wrapper, without waiting for the tool.
    await new Promise<void>((resolve) => setImmediate(resolve));
    let lateError: unknown;
    const late = Promise.resolve()
      .then(() => retained.execute({ product_id: "p:roadrunner" }))
      .catch((error: unknown) => {
        lateError = error;
      });
    pause.release();
    try {
      await Promise.all([request, accepted, late]);
    } finally {
      pause.restore();
    }
    expect(lateError).toBeInstanceOf(Error);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(2);
  });

  it("normalizes defaults before deduplication and rejects invalid or unknown arguments", async () => {
    const { session, messages } = harness([limit(10000)]);
    await session.send("buy socks");
    let results: PromiseSettledResult<unknown>[] = [];
    session.enableLive(async (_input, { tools }) => {
      const buy = tools.find((tool) => tool.name === "buy_product") as SampleTool;
      const defaultVariant = PRODUCTS.find((product) => product.id === "p:socks")?.variants[0];
      results = await Promise.allSettled([
        buy.execute({ product_id: "p:socks" }),
        buy.execute({ variant: defaultVariant, product_id: "p:socks" }),
        buy.execute({ product_id: "p:socks", variant: "invalid" }),
        buy.execute({ product_id: "p:socks", unused: true }),
      ]);
      return { text: "" };
    });
    session.engine.setCore("live");
    await session.send("buy socks");
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
      "rejected",
    ]);
    expect(results.slice(0, 2)).toEqual([
      { status: "fulfilled", value: "done" },
      { status: "fulfilled", value: "done" },
    ]);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(2);
  });

  it("validates every live tool before accepting an operation", async () => {
    const { session, messages } = harness([limit(10000), deny, deny]);
    await session.send("buy socks");
    const invalid: [string, unknown][] = [
      ["buy_product", null],
      ["buy_product", []],
      ["buy_product", {}],
      ["buy_product", { product_id: 1 }],
      ["buy_product", { product_id: "unknown" }],
      ["buy_product", { product_id: "p:socks", variant: 1 }],
      ["buy_product", { product_id: "p:socks", operation_id: "model-retry-id" }],
      ["search_products", { category: "unknown" }],
      ["search_products", { max_price_usd: "20" }],
      ["search_products", { max_price_usd: NaN }],
      ["search_products", { max_price_usd: Infinity }],
      ["search_products", { max_price_usd: -1 }],
      ["search_products", { max_price_usd: 1.001 }],
      ["search_products", { unused: true }],
      ["apply_for_decision_in_principle", {}],
      ["apply_for_decision_in_principle", { lender_id: "unknown" }],
      ["find_mortgages", { unused: true }],
      ["explain_rules", { unused: true }],
    ];
    let results: PromiseSettledResult<unknown>[] = [];
    session.enableLive(async (_input, { tools }) => {
      results = await Promise.allSettled(
        invalid.map(([name, input]) => {
          const tool = tools.find((t) => t.name === name) as SampleTool;
          return tool.execute(input as Record<string, unknown>);
        }),
      );
      return { text: "" };
    });
    session.engine.setCore("live");
    await session.send("check tools");
    expect(results).toHaveLength(invalid.length);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(session.engine.getState().core).toBe("live");
    expect(messages().filter((message) => message.type === "receipt")).toHaveLength(1);
    expect(session.engine.getState().pending).toBeUndefined();
  });

  it("automatically settles approval expiry and releases queued actions", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(NOW);
    const { session, messages } = harness([], () => new Date());
    const engine = session.engine;
    await engine.ready;
    const pending = deferred();
    const unsubscribe = engine.subscribe((state) => {
      if (state.pending) pending.resolve();
    });
    const first = engine.buy(engine.getState().activeChat, "p:socks");
    await pending.promise;
    unsubscribe();
    const queued = engine.explainRules(engine.getState().activeChat);
    try {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      const released = engine.getState().pending === undefined;
      if (!released) engine.stop(); // Ensure a failing regression does not leave a promise or timer behind.
      const results = await Promise.allSettled([first, queued]);
      expect(released).toBe(true);
      expect(results[0]).toEqual({ status: "fulfilled", value: "expired" });
      expect(results[1]?.status).toBe("fulfilled");
      expect(messages().some((m) => m.type === "approval" && m.state === "expired")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    "approve",
    "dismiss",
  ])("settles a stale sheet on %s even before its timer fires", async (answer) => {
    let time = NOW;
    const { session, messages } = harness([], () => time);
    const engine = session.engine;
    await engine.ready;
    const purchase = engine
      .buy(engine.getState().activeChat, "p:socks")
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(engine.getState().pending).toBeDefined());
    const request = engine.getState().pending?.request as ApprovalRequest;
    time = new Date(request.expiresAt);
    const response = await engine.respond(answer === "dismiss" ? deny(request) : once(request));
    const released = engine.getState().pending === undefined;
    if (!released) engine.stop();
    await purchase;
    expect(response).toEqual(
      answer === "dismiss" ? { ok: true } : { ok: false, reason: "expired" },
    );
    expect(released).toBe(true);
    expect(messages().some((m) => m.type === "approval" && m.state === "expired")).toBe(true);
  });

  it.each([
    "order",
    "actionDigest",
    "total",
    "currency",
  ])("rejects a validly signed receipt with a different %s", async (field) => {
    const { session, messages } = harness([limit(10000)]);
    await session.send("buy socks");
    const original = Parties.prototype.sign;
    const spy = vi.spyOn(Parties.prototype, "sign").mockImplementation(function (
      this: Parties,
      from,
      payload,
    ) {
      return original.call(
        this,
        from,
        typeof payload.order === "string"
          ? { ...payload, [field]: field === "total" ? 1201 : "wrong" }
          : payload,
      );
    });
    try {
      await session.send("buy socks");
    } finally {
      spy.mockRestore();
    }
    expect(session.engine.getState().rules[0]?.used.minor).toBe(1200);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(1);
  });

  it("rejects a replayed signed receipt for a second purchase", async () => {
    const { session, messages } = harness([limit(10000)]);
    const original = Parties.prototype.sign;
    let firstReceipt: string | undefined;
    const spy = vi.spyOn(Parties.prototype, "sign").mockImplementation(async function (
      this: Parties,
      from,
      payload,
    ) {
      if (typeof payload.order !== "string") return original.call(this, from, payload);
      firstReceipt ??= await original.call(this, from, payload);
      return firstReceipt;
    });
    try {
      await session.send("buy socks");
      await session.send("buy socks");
    } finally {
      spy.mockRestore();
    }
    expect(session.engine.getState().rules[0]?.used.minor).toBe(1200);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(1);
  });

  it("commits Activity and its receipt with the ledger before cancellable rule refresh", async () => {
    const { session, messages } = harness([limit(10000)]);
    await session.send("buy socks");
    const engine = session.engine;
    const internals = engine as unknown as {
      ledger: SpendRecord[];
      parties: Parties;
      refreshRules(run: unknown): Promise<void>;
    };
    const entered = deferred();
    const release = deferred();
    const original = internals.refreshRules.bind(engine);
    const spy = vi.spyOn(internals, "refreshRules").mockImplementation(async (run) => {
      entered.resolve();
      await release.promise;
      await original(run);
    });
    const purchase = session.send("buy socks");
    await entered.promise;
    const activityAtCommit = engine
      .getState()
      .activity.filter((entry) => entry.filter === "purchases");
    engine.stop();
    engine.resume();
    release.resolve();
    try {
      await purchase;
    } finally {
      spy.mockRestore();
    }
    expect(activityAtCommit).toHaveLength(internals.ledger.length);
    expect(engine.getState().activity.filter((entry) => entry.filter === "purchases")).toHaveLength(
      2,
    );
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(2);
    const entry = activityAtCommit[0];
    expect(entry?.receiptJws).toBeTypeOf("string");
    const receipt = await internals.parties.receive(entry?.receiptJws as string, "store:stride");
    expect(receipt?.payload).toMatchObject({
      order: internals.ledger[1]?.id,
      actionDigest: entry?.digest,
      total: 1200,
      currency: "USD",
    });
    expect(entry?.orderRef).toBe(internals.ledger[1]?.id);
  });
});

describe("review security regressions", () => {
  it("binds answers to the displayed request and digest and accepts one answer only", async () => {
    const { session, asked, messages } = harness([]);
    await session.engine.ready;
    const firstPending = deferred();
    const unsubscribe = session.engine.subscribe((s) => {
      if (s.pending) firstPending.resolve();
    });
    const socks = session.send("buy socks");
    await firstPending.promise;
    const old = once(asked[0] as ApprovalRequest);
    const answers = await Promise.all([session.engine.respond(old), session.engine.respond(old)]);
    expect(answers).toEqual([{ ok: true }, { ok: false, reason: "nothing-pending" }]);
    await socks;
    unsubscribe();
    const nextPending = deferred();
    session.engine.subscribe((s) => {
      if (s.pending) nextPending.resolve();
    });
    const jacket = session.send("buy jacket");
    await nextPending.promise;
    const request = asked[1] as ApprovalRequest;
    const replay = await session.engine.respond(old);
    const wrongDigest = await session.engine.respond({ ...once(request), digest: old.digest });
    await session.engine.respond(deny(request));
    await jacket;
    expect(replay).toEqual({ ok: false, reason: "request-mismatch" });
    expect(wrongDigest).toEqual({ ok: false, reason: "digest-mismatch" });
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(1);
  });

  it("serializes concurrent purchases against the same budget", async () => {
    const { session, asked, messages } = harness([limit(3600), deny]);
    await session.send("buy socks");
    const engine = session.engine;
    const results = await Promise.all(
      Array.from({ length: 3 }, () => engine.buy(engine.getState().activeChat, "p:socks")),
    );
    expect(results).toEqual(["done", "done", "denied"]);
    expect(asked).toHaveLength(2);
    expect(engine.getState().rules[0]?.used.minor).toBe(3600);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(3);
  });

  it("consumes a purchase approval before a failed store exchange can reuse it", async () => {
    const { session, asked } = harness([once, deny]);
    await session.engine.ready;
    const spy = vi
      .spyOn(Parties.prototype, "sign")
      .mockRejectedValueOnce(new Error("store offline"));
    await expect(session.send("buy socks")).rejects.toThrow("store offline");
    spy.mockRestore();
    await session.engine.buy(session.engine.getState().activeChat, "p:socks");
    expect(asked).toHaveLength(2);
  });

  it.each([
    false,
    true,
  ])("consumes sharing approval even when the application pauses: %s", async (paused) => {
    const { session, asked } = harness([once, paused ? deny : face, once, face]);
    await session.send("Go with North Bank");
    await session.send("Go with North Bank");
    expect(asked.map((r) => r.kind)).toEqual(["disclosure", "step-up", "disclosure", "step-up"]);
  });

  it.each([
    "budget",
    "allowance",
  ] as const)("preserves %s usage and lifetime across two raises", async (kind) => {
    let time = NOW;
    const { session, messages } = harness(
      [limit(10000, kind), raise(15000), raise(25000)],
      () => time,
    );
    await session.send("buy socks");
    await session.choose("p:roadrunner", "size 9, grey", "buy shoes");
    const original = session.engine.getState().rules[0]?.rule;
    time = new Date("2026-11-14T12:00:00.000Z");
    await session.send("buy jacket");
    expect(session.engine.getState().rules[0]?.remaining.minor).toBe(3300);
    time = new Date("2026-11-15T12:00:00.000Z");
    await session.send("buy jacket");
    const view = session.engine.getState().rules[0];
    expect(view?.rule.supersedes).toHaveLength(2);
    expect(view?.rule.supersedes).toContain(original?.id);
    expect(view?.rule.createdAt).toBe(original?.createdAt);
    expect(view?.used.minor).toBe(20200);
    expect(view?.remaining.minor).toBe(4800);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(4);
  });

  it.each([
    0,
    24 * 60 * 60_000,
  ])("fresh applications require fresh face checks after %i ms", async (elapsed) => {
    let time = NOW;
    const { session, asked } = harness([once, face, once, face], () => time);
    await session.send("Go with North Bank");
    time = new Date(NOW.getTime() + elapsed);
    await session.send("Go with North Bank");
    expect(asked.filter((r) => r.kind === "step-up")).toHaveLength(2);
  });

  it("an expired signed face check does not authorize release", async () => {
    let time = NOW;
    let expired = false;
    const { session, asked, messages } = harness([once, face, deny], () => time);
    const original = Parties.prototype.sign;
    const spy = vi.spyOn(Parties.prototype, "sign").mockImplementation(async function (
      this: Parties,
      from,
      payload,
    ) {
      const signed = await original.call(this, from, payload);
      if (from === "org:idp" && !expired) {
        expired = true;
        time = new Date(NOW.getTime() + 15 * 60000);
      }
      return signed;
    });
    try {
      await session.send("Go with North Bank");
    } finally {
      spy.mockRestore();
    }
    expect(asked.map((r) => r.kind)).toEqual(["disclosure", "step-up", "step-up"]);
    expect(messages().some((m) => m.type === "offer")).toBe(false);
  });

  it.each([
    "digest",
    "method",
    "validMinutes",
    "issuedAt",
    "issuer",
  ])("rejects a signed attestation with the wrong %s", async (field) => {
    const { session, asked, messages } = harness([once, face, deny]);
    const original = Parties.prototype.sign;
    const spy = vi.spyOn(Parties.prototype, "sign").mockImplementation(async function (
      this: Parties,
      from,
      payload,
    ) {
      if (from === "org:idp") {
        const altered = { ...payload, [field]: field === "validMinutes" ? 60 : "wrong" };
        return original.call(this, field === "issuer" ? "org:north" : from, altered);
      }
      return original.call(this, from, payload);
    });
    try {
      await session.send("Go with North Bank");
    } finally {
      spy.mockRestore();
    }
    expect(asked.filter((r) => r.kind === "step-up")).toHaveLength(2);
    expect(messages().some((m) => m.type === "offer")).toBe(false);
  });

  it("Stop during receipt creation permanently cancels the purchase across resume", async () => {
    const { session, messages } = harness([limit(10000)]);
    await session.send("buy socks");
    const pause = pauseSigning((p) => typeof p.order === "string");
    const purchase = session.send("buy socks");
    await pause.entered;
    session.engine.stop();
    session.engine.resume();
    pause.release();
    try {
      await purchase;
    } finally {
      pause.restore();
    }
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(1);
    expect(session.engine.getState().rules[0]?.used.minor).toBe(1200);
  });

  it("Stop during a lender reply prevents the decision workflow continuing", async () => {
    const { session, messages } = harness([once, face]);
    await session.engine.ready;
    const pause = pauseSigning((p) => p.decision === "decision-in-principle");
    const application = session.send("Go with North Bank");
    await pause.entered;
    session.engine.stop();
    session.engine.resume();
    pause.release();
    try {
      await application;
    } finally {
      pause.restore();
    }
    expect(messages().some((m) => m.type === "offer")).toBe(false);
    expect(
      session.engine.getState().activity.some((a) => a.summary.startsWith("Decision in principle")),
    ).toBe(false);
  });

  it("serializes live tools and does not restart purchases after a sampling failure", async () => {
    const { session, asked, messages } = harness([limit(4400), deny]);
    await session.send("buy socks");
    session.enableLive(async (_input, opts) => {
      const buy = opts.tools.find((t) => t.name === "buy_product");
      if (!buy) throw new Error("missing tool");
      await Promise.all([
        buy.execute({ product_id: "p:socks" }),
        buy.execute({ product_id: "p:roadrunner", variant: "size 9, grey" }),
      ]);
      throw new Error("transport failed after purchase");
    });
    session.engine.setCore("live");
    await session.send("buy socks");
    expect(asked).toHaveLength(1);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(3);
  });

  it("deduplicates retries of the same live tool call within one request", async () => {
    const { session, messages } = harness([limit(10000)]);
    await session.send("buy socks");
    session.enableLive(async (_input, opts) => {
      const buy = opts.tools.find((t) => t.name === "buy_product");
      if (!buy) throw new Error("missing tool");
      await Promise.all([
        buy.execute({ product_id: "p:socks" }),
        buy.execute({ product_id: "p:socks" }),
      ]);
      return { text: "" };
    });
    session.engine.setCore("live");
    await session.send("buy socks");
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(2);
  });

  it("allows one purchase from an unestablished store without establishing trust", async () => {
    const { session, asked, messages } = harness([once, deny, deny, deny, deny]);
    await session.choose("p:tempo", "size 9, white", "Tempo");
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(1);
    expect(asked).toHaveLength(1);
    expect(
      session.engine.getState().activity.find((a) => a.filter === "purchases")?.checks[1]?.code,
    ).toBe("approved-once-recipient");
    await session.choose("p:tempo", "size 9, white", "Tempo again");
    expect(asked).toHaveLength(2);
    expect(asked[1]?.kind).toBe("new-recipient");
    expect(asked.every((r) => r.offered.every((o) => o.type !== "set-limit"))).toBe(true);
  });
});

describe("authority and cancellation boundaries", () => {
  it("one approval cannot authorize concurrent copies of a purchase", async () => {
    const { session, asked, messages } = harness([once, deny]);
    await session.engine.ready;
    const pause = pauseSigning((p) => typeof p.order === "string");
    const chat = session.engine.getState().activeChat;
    const first = session.engine.buy(chat, "p:socks");
    await pause.entered;
    const second = session.engine.buy(chat, "p:socks");
    pause.release();
    try {
      expect(await Promise.all([first, second])).toEqual(["done", "denied"]);
    } finally {
      pause.restore();
    }
    expect(asked).toHaveLength(2);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(1);
  });

  it("sharing consent is spent even if the evidence exchange fails", async () => {
    const { session, asked } = harness([once, deny]);
    await session.engine.ready;
    const spy = vi
      .spyOn(Parties.prototype, "sign")
      .mockRejectedValueOnce(new Error("evidence unavailable"));
    await expect(session.send("Go with North Bank")).rejects.toThrow("evidence unavailable");
    spy.mockRestore();
    await session.send("Go with North Bank");
    expect(asked.map((r) => r.kind)).toEqual(["disclosure", "disclosure"]);
  });

  it("rejects a face check issued in the future", async () => {
    const { session, asked } = harness([once, face, deny]);
    const original = Parties.prototype.sign;
    const spy = vi.spyOn(Parties.prototype, "sign").mockImplementation(function (
      this: Parties,
      from,
      payload,
    ) {
      return original.call(
        this,
        from,
        from === "org:idp" ? { ...payload, issuedAt: "2026-11-14T12:00:00.000Z" } : payload,
      );
    });
    try {
      await session.send("Go with North Bank");
    } finally {
      spy.mockRestore();
    }
    expect(asked.filter((r) => r.kind === "step-up")).toHaveLength(2);
  });

  it("Stop invalidates queued tasks as well as an in-flight receipt", async () => {
    const { session, messages } = harness([limit(10000)]);
    await session.send("buy socks");
    const pause = pauseSigning((p) => typeof p.order === "string");
    const active = session.send("buy socks");
    await pause.entered;
    const queued = session.send("buy socks");
    const queuedTool = session.engine.buy(session.engine.getState().activeChat, "p:socks");
    const rejected = expect(queuedTool).rejects.toBeInstanceOf(StoppedError);
    session.engine.stop();
    session.engine.resume();
    // The run aborts before the counterparty is released.
    await active;
    await queued;
    await rejected;
    pause.release();
    pause.restore();
    await session.send("buy socks");
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(2);
    expect(session.engine.getState().rules[0]?.used.minor).toBe(2400);
  });

  it("Stop before bank release prevents submission and uses up sharing consent", async () => {
    const { session, asked, messages } = harness([once, face, deny]);
    await session.engine.ready;
    const pause = pauseSigning((p) => p.statement === "balance");
    const application = session.send("Go with North Bank");
    await pause.entered;
    session.engine.stop();
    session.engine.resume();
    await application;
    pause.release();
    pause.restore();
    expect(messages().some((m) => m.type === "offer")).toBe(false);
    await session.send("Go with North Bank");
    expect(asked.map((r) => r.kind)).toEqual(["disclosure", "step-up", "disclosure"]);
  });

  it("Stop during receipt verification prevents a ledger write", async () => {
    const { session, messages } = harness([limit(10000)]);
    await session.send("buy socks");
    const entered = deferred();
    const release = deferred();
    const original = Parties.prototype.receive;
    const spy = vi.spyOn(Parties.prototype, "receive").mockImplementation(async function (
      this: Parties,
      ...args
    ) {
      entered.resolve();
      await release.promise;
      return original.apply(this, args);
    });
    const purchase = session.send("buy socks");
    await entered.promise;
    session.engine.stop();
    session.engine.resume();
    await purchase;
    release.resolve();
    spy.mockRestore();
    expect(session.engine.getState().rules[0]?.used.minor).toBe(1200);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(1);
  });
});

describe("core execution and standing authority", () => {
  it("falls back safely when sampling fails before any tool executes", async () => {
    const { session, messages } = harness([once]);
    session.enableLive(async () => {
      throw new Error("offline");
    });
    session.engine.setCore("live");
    await session.send("buy socks");
    expect(session.engine.getState().core).toBe("scripted");
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(1);
  });

  it("live search, explanation and application use the gated engine", async () => {
    const { session, asked, messages } = harness([once, face]);
    session.enableLive(async (_input, { tools }) => {
      const call = (name: string, input: Record<string, unknown> = {}) => {
        const tool = tools.find((t) => t.name === name);
        if (!tool) throw new Error(`no tool ${name}`);
        return tool.execute(input);
      };
      await expect(call("buy_product", { product_id: "unknown" })).rejects.toThrow(
        "unknown product",
      );
      expect(await call("search_products", { category: "clothing", max_price_usd: 100 })).toEqual([
        expect.objectContaining({ id: "p:stormshell", price_usd: 85 }),
      ]);
      expect(await call("search_products", { max_price_usd: 1 })).toEqual([]);
      expect(await call("search_products")).toHaveLength(5);
      expect(await call("explain_rules")).toBe("shown");
      expect(await call("find_mortgages")).toBe("shown");
      expect(await call("apply_for_decision_in_principle", { lender_id: "org:canal" })).toBe(
        "done",
      );
      return { text: "The decision is ready." };
    });
    session.engine.setCore("live");
    await session.send("Please check the choices and apply to Canal Bank once I approve.");
    expect(asked.map((r) => r.kind)).toEqual(["disclosure", "step-up"]);
    expect(messages().some((m) => m.type === "offer" && m.party === "Canal Bank")).toBe(true);
  });

  it("a late live tool cannot act after Stop and resume", async () => {
    const { session, messages } = harness([]);
    const entered = deferred();
    const release = deferred();
    session.enableLive(async (_input, { tools }) => {
      entered.resolve();
      await release.promise;
      const buy = tools.find((t) => t.name === "buy_product");
      if (!buy) throw new Error("no purchase tool");
      await buy.execute({ product_id: "p:socks" });
      return { text: "" };
    });
    session.engine.setCore("live");
    const request = session.send("buy socks");
    await entered.promise;
    session.engine.stop();
    session.engine.resume();
    await request;
    release.resolve();
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(0);
    expect(session.engine.getState().core).toBe("live");
  });

  it("revoking a signed limit preserves spend and restores approval requirements", async () => {
    const { session, asked, messages } = harness([limit(10000), deny]);
    await session.send("my limits");
    await session.send("buy socks");
    await session.send("my limits");
    const ruleId = session.engine.getState().rules[0]?.rule.id;
    if (!ruleId) throw new Error("no rule");
    const chat = session.engine.getState().activeChat;
    await session.engine.revokeRule(ruleId, chat);
    expect(session.engine.getState().rules).toHaveLength(0);
    expect(messages().some((m) => m.type === "rule-change" && m.change === "revoked")).toBe(true);
    await session.send("buy socks");
    expect(asked).toHaveLength(2);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(1);
    expect(Engine.outcomeWord([{ check: "recipient", result: "fail", plain: "unknown" }])).toBe(
      "stop",
    );
    expect(Engine.outcomeWord([{ check: "disclosure", result: "ask", plain: "consent" }])).toBe(
      "ask the principal",
    );
    expect(Engine.outcomeWord([])).toBe("go");
  });

  it("search handles empty, filtered and single-result requests and unknown product IDs", async () => {
    const { session, messages } = harness([]);
    await session.send("   ");
    await session.send("help");
    const original = session.engine.getState().activeChat;
    const other = session.engine.newChat();
    session.engine.openChat(original);
    session.engine.openChat(other);
    expect(() => session.engine.openChat("missing")).toThrow("no chat");
    await session.send("running shoes under $1");
    await session.send("running shoes under $20");
    await session.send("running shoes");
    expect(await session.engine.searchProducts(other, { text: "stormshell" })).toHaveLength(1);
    expect(await session.engine.searchProducts(other, { text: "nothing" })).toHaveLength(0);
    expect(messages().some((m) => m.type === "products")).toBe(true);
    await expect(session.engine.buy(other, "missing")).rejects.toThrow("unknown product");
    expect((await Parties.create([])).name("unknown")).toBe("unknown");
  });

  it("denied sharing does not begin the evidence exchanges", async () => {
    const { session, asked, messages } = harness([deny]);
    await session.send("Go with North Bank");
    expect(asked).toHaveLength(1);
    expect(messages().some((m) => m.type === "offer")).toBe(false);
    expect(session.engine.getState().activity.some((a) => a.summary.startsWith("Shared"))).toBe(
      false,
    );
  });
});

describe("Stop discards authority from a cancelled run", () => {
  it("an approval signed just before Stop cannot authorize a later task", async () => {
    const { session, asked, messages } = harness([once, deny]);
    let stopped = false;
    session.engine.subscribe((state) => {
      const approved = state.chats.some((chat) =>
        chat.messages.some((m) => m.type === "approval" && m.state === "approved-once"),
      );
      if (approved && !stopped) {
        stopped = true;
        session.engine.stop();
        session.engine.resume();
      }
    });
    await session.send("buy socks");
    await session.send("buy socks");
    expect(asked).toHaveLength(2);
    expect(messages().filter((m) => m.type === "receipt")).toHaveLength(0);
  });

  it("a face check signed just before Stop cannot authorize a later release", async () => {
    const { session, asked, messages } = harness([once, face, once, face]);
    let stopped = false;
    session.engine.subscribe((state) => {
      const faceRequest = asked.find((r) => r.kind === "step-up");
      const approved = state.chats.some((chat) =>
        chat.messages.some(
          (m) =>
            m.type === "approval" && m.requestId === faceRequest?.id && m.state === "approved-once",
        ),
      );
      if (approved && !stopped) {
        stopped = true;
        session.engine.stop();
        session.engine.resume();
      }
    });
    await session.send("Go with North Bank");
    await session.send("Go with North Bank");
    expect(asked.map((r) => r.kind)).toEqual(["disclosure", "step-up", "disclosure", "step-up"]);
    expect(messages().filter((m) => m.type === "offer")).toHaveLength(1);
  });
});
