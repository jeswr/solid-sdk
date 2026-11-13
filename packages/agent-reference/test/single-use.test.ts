// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, rmSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { LocalSingleUseRegister } from "../src/mechanisms/single-use.js";
import { signStatement } from "../src/mechanisms/statements.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { testKey } from "../src/reference/keys.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { FileStateStore, MemoryStateStore, type StateStore } from "../src/store/state.js";

async function fixture(store: StateStore = new MemoryStateStore()) {
  const keys = await Promise.all(["register", "a", "b"].map((x) => testKey(`once/${x}`)));
  const trust = await TrustStore.load({
    version: 1,
    owner: "urn:register",
    sourceAuthority: [],
    keys: keys.map((k, i) => ({
      kid: k.kid,
      alg: k.alg,
      publicJwk: k.publicJwk,
      role: i ? "actor" : "issuer",
      subject: i ? `urn:actor:${i}` : "urn:register",
      ...(i ? { party: `urn:party:${i}` } : {}),
    })),
  });
  let at = "2026-11-13T09:00:00.000Z";
  let requestId = 0;
  const options = {
    identity: "urn:register",
    key: required(keys[0]),
    trust,
    store,
    ledger: new MemoryLedger(),
    items: [
      {
        id: "urn:item",
        issuer: "urn:register",
        state: "active" as const,
        redeemers: ["urn:party:1", "urn:party:2"],
        purposes: ["urn:purpose"],
      },
    ],
    now: () => at,
    maxAgeSeconds: 60,
    resolver: { resolve: async () => undefined },
  };
  const service = new LocalSingleUseRegister(options);
  async function request(actor = 1, operation = "redeem", until?: string) {
    return signStatement(required(keys[actor]), "awp-single-use-request+jws", {
      type: "SingleUseRequest",
      id: `urn:request:${++requestId}`,
      actor: `urn:actor:${actor}`,
      party: `urn:party:${actor}`,
      item: "urn:item",
      operation,
      at,
      purpose: "urn:purpose",
      for: `urn:effect:${actor}`,
      ...(until ? { until } : {}),
    });
  }
  return {
    service,
    request,
    options,
    advance: (value: string) => {
      at = value;
    },
  };
}
it("makes exactly one concurrent redemption succeed, including through separate instances sharing a store", async () => {
  const f = await fixture();
  const other = new LocalSingleUseRegister(f.options);
  const [a, b] = await Promise.all([f.request(1), f.request(2)]);
  const answers = await Promise.all([f.service.request(a), other.request(b)]);
  expect(answers.filter((r) => r.ok)).toHaveLength(1);
  expect(answers.find((r) => !r.ok)).toMatchObject({ reason: "status-withdrawn" });
  expect(f.options.store.load().domain["single-use:urn:item"]).toMatchObject({
    status: "redeemed",
    redeemedBy: `urn:party:${answers[0]?.ok ? 1 : 2}`,
  });
});
it("keeps reservation and redemption across file-store restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "single-use-"));
  try {
    const store = new FileStateStore(join(dir, "state.json"));
    const f = await fixture(store);
    expect(
      await f.service.request(await f.request(1, "reserve", "2026-11-13T09:01:00.000Z")),
    ).toMatchObject({ ok: true });
    store.close();
    const nextStore = new FileStateStore(join(dir, "state.json"));
    const next = await fixture(nextStore);
    expect(await next.service.request(await next.request(2))).toMatchObject({
      reason: "status-withdrawn",
    });
    expect(await next.service.request(await next.request(1))).toMatchObject({ ok: true });
    nextStore.close();
    const finalStore = new FileStateStore(join(dir, "state.json"));
    const last = await fixture(finalStore);
    expect(await last.service.request(await last.request(2))).toMatchObject({
      reason: "status-withdrawn",
    });
    finalStore.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("expires a reservation and supports gated release without consuming the item", async () => {
  const f = await fixture();
  await f.service.request(await f.request(1, "reserve", "2026-11-13T09:00:10.000Z"));
  f.advance("2026-11-13T09:00:11.000Z");
  expect(
    await f.service.request(await f.request(2, "reserve", "2026-11-13T09:01:00.000Z")),
  ).toMatchObject({ ok: true });
  expect(await f.service.request(await f.request(2, "release"))).toMatchObject({ ok: true });
  expect(await f.service.request(await f.request(1))).toMatchObject({ ok: true });
});
it("refuses withdrawn items, forged actors and expired reservations", async () => {
  const f = await fixture();
  f.options.store.save({
    ...f.options.store.load(),
    domain: { "single-use:urn:item": { status: "withdrawn" } },
  });
  expect(await f.service.request(await f.request(1))).toMatchObject({ reason: "status-withdrawn" });
  const next = await fixture();
  expect(
    await next.service.request(await next.request(1, "reserve", "2026-11-13T08:00:00.000Z")),
  ).toMatchObject({ reason: "expired" });
  expect(await next.service.request("bad.jws.signature")).toMatchObject({
    reason: "bad-signature",
  });
});
it("checks all escrow conditions, both acceptances, exact effect parameters and current issuer standing", async () => {
  for (const attack of [
    "none",
    "missing-condition",
    "missing-acceptance",
    "different-terms",
    "financed",
    "stale",
    "amount",
    "no-register",
  ]) {
    const { profile, scenario } = loadCase(join(import.meta.dirname, ".."), "sell-a-car");
    scenario.branches = [];
    scenario.expect = [];
    if (attack === "missing-condition")
      scenario.statements = scenario.statements.filter((s) => s.id !== "complete");
    if (attack === "missing-acceptance") required(scenario.singleUseRegisters[0]).acceptances.pop();
    if (attack === "different-terms")
      required(required(scenario.singleUseRegisters[0]).acceptances[0]).termsDigest =
        "sha-256:other";
    if (attack === "financed")
      required(scenario.statements.find((s) => s.id === "search")).value.financed = true;
    if (attack === "stale")
      required(scenario.statements.find((s) => s.id === "search")).asOf =
        "2026-11-13T08:00:00.000Z";
    if (attack === "amount") {
      const step = scenario.script[1];
      if (step?.type !== "effect") throw Error("fixture");
      (step.intent.parameters as Record<string, number>).amount = 1;
      step.params.amount = 1;
    }
    if (attack === "no-register") scenario.singleUseRegisters = [];
    const [path] = await runScenario(profile, scenario, { compare: false });
    const events = path?.trace?.events ?? [];
    const stopped = events.findLast((e) => e.outcome === "stop" || e.outcome === "refuse");
    expect(stopped?.reason, attack).toBe(
      {
        none: undefined,
        "missing-condition": "evidence-missing",
        "missing-acceptance": "terms-not-acceptable",
        "different-terms": "terms-digest-mismatch",
        financed: "evidence-invalid",
        stale: "stale-data",
        amount: "terms-digest-mismatch",
        "no-register": "lookup-failed",
      }[attack],
    );
  }
  const { profile, scenario } = loadCase(
    join(import.meta.dirname, ".."),
    "prescription-dispensing",
  );
  const paths = await runScenario(profile, scenario);
  expect(paths.every((p) => !p.blocked && !p.disagrees)).toBe(true);
  expect(paths[2]?.actual).toMatchObject({ outcome: "refuse", reason: "status-withdrawn" });
});
it("an issuer can withdraw a reserved item through the register gate without erasing a redemption", async () => {
  const f = await fixture();
  await f.service.request(await f.request(1, "reserve", "2026-11-13T09:01:00.000Z"));
  const withdrawal = await signStatement(f.options.key, "awp-single-use-withdrawal+jws", {
    type: "SingleUseWithdrawal",
    id: "urn:withdrawal",
    issuer: "urn:register",
    item: "urn:item",
    at: "2026-11-13T09:00:00.000Z",
  });
  expect(await f.service.withdraw(withdrawal)).toMatchObject({ ok: true });
  expect(await f.service.request(await f.request(1))).toMatchObject({ reason: "status-withdrawn" });
  const redeemed = await fixture();
  await redeemed.service.request(await redeemed.request(1));
  expect(await redeemed.service.withdraw(withdrawal)).toMatchObject({ reason: "status-withdrawn" });
  expect(redeemed.options.store.load().domain["single-use:urn:item"]).toMatchObject({
    status: "redeemed",
    redeemedBy: "urn:party:1",
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture");
  return value;
}
