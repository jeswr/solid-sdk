/**
 * Durable UC-03 roles in-process over the real anonymous public carriage (loopback HTTP):
 * four independently initialised retailer services and one comparator. Checks the estimates
 * against the existing in-process scenario, incompatible-model / represented-only isolation,
 * that nothing identifying or about usage reaches a retailer (observed at the retailer's
 * listener and in its files), and that a restart preserves outputs and provenance.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PublicDispatcher,
  type PublicListener,
  readPublicConfig,
  readPublicPeers,
  startPublicServer,
} from "./bindings/public-http.js";
import { main, openAgent } from "./cli.js";
import { GATED, HARBOUR, OLDSCHEMA, SOUTHERN, WATTLE } from "./fixtures/energy.js";
import { AgentHost, type Json } from "./host.js";
import { runEnergy } from "./scenarios/energy.js";

const NOW = "2026-10-19T08:00:00Z";
const now = () => new Date(NOW);
const RETAILERS = [SOUTHERN, HARBOUR, GATED, OLDSCHEMA];
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function cli(args: string[]) {
  let out = "";
  await main([...args], { stdout: (s) => (out += s) });
  return out.trim().startsWith("{") || out.trim().startsWith("[") ? JSON.parse(out) : {};
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

async function provision() {
  const root = mkdtempSync(join(tmpdir(), "awp-energy-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const common = ["--dir", root, "--now", NOW, "--policy-engine=solid-odrl"];
  const owners = ["--owner-dir", join(root, "owners")];
  const syn = await cli(["synthetic-energy", "--out", join(root, "inputs"), ...common]);
  const init: Record<string, Json> = {};
  for (const r of RETAILERS) {
    init[r.name] = await cli([
      "init",
      "--name",
      r.name,
      "--role",
      "energy-retailer",
      "--party",
      r.party,
      "--actor",
      r.actor,
      "--role-input",
      `plans=${syn.files[`plans-${r.name}.json`]}`,
      ...owners,
      ...common,
    ]);
    await cli([
      "public-config",
      "--name",
      r.name,
      "--port",
      String(await freePort()),
      "--out",
      join(root, `${r.name}.public.json`),
      ...common,
    ]);
  }
  init.wattlecompare = await cli([
    "init",
    "--name",
    "wattlecompare",
    "--role",
    "energy-comparator",
    "--role-input",
    `profile=${syn.files["household.json"]}`,
    ...owners,
    ...common,
  ]);
  for (const r of RETAILERS) {
    const card = join(root, `${r.name}.card.json`);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(card, JSON.stringify(await cli(["card", "--name", r.name, ...common])));
    await cli([
      "pin",
      "--name",
      "wattlecompare",
      "--card",
      card,
      `--party-kid=${String(init[r.name]?.partyKid)}`,
      `--actor-kid=${String(init[r.name]?.actorKid)}`,
      ...common,
    ]);
    await cli([
      "public-pin",
      "--name",
      "wattlecompare",
      "--connection",
      join(root, `${r.name}.public.json`),
      ...common,
    ]);
  }
  return { root, household: JSON.parse(readFileSync(syn.files["household.json"], "utf8")) };
}

async function openRetailer(root: string, name: string) {
  const a = await openAgent(root, name, now);
  const h = new AgentHost(a, now);
  const seen: { headers: string[]; bytes: number }[] = [];
  const listener: PublicListener = await startPublicServer(
    h,
    readPublicConfig(a.dir) as NonNullable<ReturnType<typeof readPublicConfig>>,
    () => {},
    { onRequest: (r) => seen.push({ headers: r.headers, bytes: r.bytes }) },
  );
  cleanups.push(async () => {
    h.stopAccepting();
    await listener.close();
    await h.drain();
    a.close();
  });
  return { a, h, seen };
}

async function openComparator(root: string) {
  const a = await openAgent(root, "wattlecompare", now);
  await a.rt.recover();
  const h = new AgentHost(a, now);
  const d = new PublicDispatcher(h, readPublicPeers(a.dir), () => {});
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    h.stopAccepting();
    await d.idle();
    await h.drain();
    a.close();
  };
  cleanups.push(close);
  return { a, h, d, close };
}

describe("durable energy comparison (anonymous public carriage)", () => {
  it("compares durable retailers anonymously, isolates incompatible ones, leaks nothing, and survives a restart", async () => {
    const { root, household } = await provision();
    const retailers = await Promise.all(RETAILERS.map((r) => openRetailer(root, r.name)));
    let cmp = await openComparator(root);
    expect(cmp.h.operations.map((o) => o.name)).toEqual(["request_plans", "compare_plans"]);
    const started = await cmp.h.call(() => cmp.h.runOperation("request_plans", {}));
    expect((started.retailers as string[]).sort()).toEqual(RETAILERS.map((r) => r.actor).sort());
    // Every request is ANONYMOUS and unsigned (no identity, no evidence).
    for (const m of cmp.h.undelivered()) {
      expect(m.wire.format).toBe("awp-unsigned-json/0.1");
      expect(Object.keys(m.message.from)).toEqual([]);
    }
    for (let i = 0; i < 4 && cmp.h.undelivered().length > 0; i++) await cmp.d.dispatch();
    const comparison = await cmp.h.call(() => cmp.h.runOperation("compare_plans", {}));

    // Same estimates as the existing in-process scenario (same domain code, same fixtures).
    const reference = await runEnergy(now);
    const pick = (r: Json) => [r.retailer, r.planId, r.estimateAudPerYear];
    expect((comparison.ranked as Json[]).map(pick)).toEqual(
      (reference.obs.ranked as Json[]).map(pick),
    );
    expect(comparison.deterministic).toBe(true);
    // Every ranked plan cites a signed source message recorded with its digest.
    for (const r of comparison.ranked as Json[])
      expect((comparison.sources as Json[]).some((s) => s.messageId === r.sourceMessage)).toBe(
        true,
      );
    // Retailer figures vs comparator derivations stay separately attributed.
    expect(Object.keys((comparison.ranked as Json[])[0]?.trace as Json)).toEqual([
      "assertedByRetailer",
      "derivedByComparator",
    ]);
    // Incompatible model version and represented-only access are isolated, not ranked.
    expect((comparison.incompatibilities as Json[]).map((i) => i.retailer).sort()).toEqual(
      [GATED.actor, OLDSCHEMA.actor].sort(),
    );
    expect(JSON.stringify(comparison.ranked)).not.toMatch(/gatedpower|oldschema/);

    // Nothing identifying or about usage reached any retailer (listener and files).
    for (const r of retailers) {
      for (const req of r.seen) {
        expect(req.headers).not.toContain("authorization");
        expect(req.headers).not.toContain("cookie");
      }
      const text = files(r.a.dir)
        .map((f) => readFileSync(f, "utf8"))
        .join("\n");
      expect(text).not.toContain(household.household);
      expect(text).not.toContain(WATTLE.party);
      expect(text).not.toContain(WATTLE.actor);
      expect(text).not.toContain("usage");
      const ins = r.h.evidence({ type: "message-in", limit: 20 }).records as Json[];
      for (const e of ins) expect((e.record as Json).from).toBeUndefined();
    }
    expect(retailers.reduce((n, r) => n + r.seen.length, 0)).toBeGreaterThanOrEqual(4);

    // Restart: the persisted comparison and its provenance survive; a re-run is identical.
    const before = cmp.h.status().domain as Json;
    await cmp.close();
    cmp = await openComparator(root);
    expect(cmp.h.status().domain).toEqual(before);
    const again = await cmp.h.call(() => cmp.h.runOperation("compare_plans", {}));
    expect(again.ranked).toEqual(comparison.ranked);
    expect(again.sources).toEqual(comparison.sources);
  }, 60_000);
});
