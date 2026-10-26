/**
 * Recoverable public replies (anonymous public carriage): the requester retains the bounded
 * signed reply durably BEFORE its request counts as sent, and processes it through the same
 * runtime after an interruption — idempotently, without re-running the retailer and without a
 * blind resend. Lost / malformed replies are resolved only by an IDENTICAL re-request, which
 * the service answers with the SAME signed response (duplicate path). Transport completion,
 * response validation and domain completion are recorded separately.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PUBLIC_REPLIES_FILE,
  PublicDispatcher,
  type PublicFaultPoint,
  readPublicConfig,
  readPublicPeers,
  startPublicServer,
} from "./bindings/public-http.js";
import { main, openAgent } from "./cli.js";
import { HARBOUR, SOUTHERN } from "./fixtures/energy.js";
import { AgentHost, type Json } from "./host.js";
import { runEnergy } from "./scenarios/energy.js";
import { FileLedger } from "./store/ledger.js";

const NOW = "2026-10-19T08:00:00Z";
const now = () => new Date(NOW);
const RETAILERS = [SOUTHERN, HARBOUR];
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function cli(args: string[]) {
  let out = "";
  await main([...args], { stdout: (s) => (out += s) });
  return out.trim().startsWith("{") ? JSON.parse(out) : {};
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function provision() {
  const root = mkdtempSync(join(tmpdir(), "awp-public-reply-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const common = ["--dir", root, "--now", NOW, "--policy-engine=solid-odrl"];
  const owners = ["--owner-dir", join(root, "owners")];
  const syn = await cli(["synthetic-energy", "--out", join(root, "inputs"), ...common]);
  const inits: Record<string, Json> = {};
  for (const r of RETAILERS) {
    inits[r.name] = await cli([
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
    writeFileSync(
      join(root, `${r.name}.card.json`),
      JSON.stringify(await cli(["card", "--name", r.name, ...common])),
    );
  }
  await cli([
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
    const init = inits[r.name] as Json;
    await cli([
      "pin",
      "--name",
      "wattlecompare",
      "--card",
      join(root, `${r.name}.card.json`),
      `--party-kid=${String(init.partyKid)}`,
      `--actor-kid=${String(init.actorKid)}`,
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
  return root;
}

async function openRetailers(root: string) {
  const counts: Record<string, number> = {};
  const hosts: AgentHost[] = [];
  for (const r of RETAILERS) {
    const a = await openAgent(root, r.name, now);
    const h = new AgentHost(a, now);
    hosts.push(h);
    counts[r.name] = 0;
    const listener = await startPublicServer(
      h,
      readPublicConfig(a.dir) as NonNullable<ReturnType<typeof readPublicConfig>>,
      () => {},
      { onRequest: () => (counts[r.name] = (counts[r.name] ?? 0) + 1) },
    );
    cleanups.push(async () => {
      h.stopAccepting();
      await listener.close();
      await h.drain();
      a.close();
    });
  }
  return { counts, hosts, total: () => Object.values(counts).reduce((n, c) => n + c, 0) };
}

async function openComparator(
  root: string,
  opts: { fault?: (p: PublicFaultPoint) => void; fetchImpl?: typeof fetch } = {},
) {
  const a = await openAgent(root, "wattlecompare", now);
  await a.rt.recover();
  const h = new AgentHost(a, now);
  const d = new PublicDispatcher(
    h,
    readPublicPeers(a.dir),
    () => {},
    5_000,
    opts.fault,
    opts.fetchImpl,
  );
  let closed = false;
  /** A crash: the runtime is simply closed; nothing else runs. */
  const crash = () => {
    if (closed) return;
    closed = true;
    a.close();
  };
  cleanups.push(crash);
  return { a, h, d, crash };
}

async function drain(c: Awaited<ReturnType<typeof openComparator>>) {
  for (let i = 0; i < 6; i++) {
    await c.d.dispatch();
    if (c.h.undelivered().length === 0 && c.d.retained().length === 0) return;
  }
}

const events = (dir: string, type: string) =>
  new FileLedger(join(dir, "ledger.jsonl"))
    .entries()
    .map((e) => e.record as Json)
    .filter((r) => r.type === type);

const pick = (r: Json) => [r.retailer, r.planId, r.estimateAudPerYear];
async function reference() {
  return ((await runEnergy(now)).obs.ranked as Json[]).map(pick);
}

describe("recoverable public replies", () => {
  for (const point of ["after-receipt", "after-processing"] as const)
    it(`a crash ${point.replace("-", " ")} loses nothing: restart processes the retained reply once; one contribution per retailer; no resend`, async () => {
      const root = await provision();
      const retailers = await openRetailers(root);
      let cmp = await openComparator(root, {
        fault: (p) => {
          if (p === point) throw new Error(`simulated crash ${p}`);
        },
      });
      await cmp.h.call(() => cmp.h.runOperation("request_plans", {}));
      await expect(cmp.d.dispatch()).rejects.toThrow(/simulated crash/);
      const sentBefore = retailers.total();
      expect(sentBefore).toBe(1); // exactly the first request left, and its reply came back
      // The reply is RETAINED durably (the request is recorded sent).
      expect(existsSync(join(cmp.a.dir, PUBLIC_REPLIES_FILE))).toBe(true);
      expect(cmp.d.retained()).toHaveLength(1);
      cmp.crash();

      cmp = await openComparator(root);
      expect(cmp.d.retained()).toHaveLength(1);
      await drain(cmp);
      const comparison = await cmp.h.call(() => cmp.h.runOperation("compare_plans", {}));
      expect((comparison.ranked as Json[]).map(pick)).toEqual(await reference());
      expect((comparison.sources as Json[]).map((s) => s.retailer).sort()).toEqual(
        RETAILERS.map((r) => r.actor).sort(),
      );
      // No resend of the retained request: describe + invoke per retailer, nothing more.
      expect(retailers.total()).toBe(2 * RETAILERS.length);
      expect(cmp.d.retained()).toEqual([]);
      // Distinct records: transport completion vs response validation (per response).
      const dir = cmp.a.dir;
      expect(events(dir, "public-reply-received").length).toBe(2 * RETAILERS.length);
      const processed = events(dir, "public-reply-processed").map((e) => e.disposition);
      expect(processed.filter((d) => d === "accepted")).toHaveLength(2 * RETAILERS.length);
      // Re-processing after a crash AFTER processing is a runtime duplicate (no second effect).
      expect(processed.filter((d) => d === "duplicate")).toHaveLength(
        point === "after-processing" ? 1 : 0,
      );
    }, 60_000);

  it("a dropped reply and a malformed reply are resolved by ONE identical re-request each; the service returns the same signed response; no duplicate contribution", async () => {
    const root = await provision();
    const retailers = await openRetailers(root);
    let drop = 1;
    let garble = 1;
    const lossy: typeof fetch = async (input, init) => {
      const res = await fetch(input, init); // the service processed it
      if (drop > 0) {
        drop--;
        await res.arrayBuffer();
        throw new Error("socket hang up (simulated dropped reply)");
      }
      if (garble > 0) {
        garble--;
        await res.arrayBuffer();
        return new Response('{"binding":"public-http/0.1","outbound":[{"format":"x"', {
          status: 200,
        });
      }
      return res;
    };
    const cmp = await openComparator(root, { fetchImpl: lossy });
    await cmp.h.call(() => cmp.h.runOperation("request_plans", {}));
    const first = await cmp.d.dispatch();
    expect((first.failed as Json[]).map((f) => f.status)).toEqual(["uncertain", "uncertain"]);
    await drain(cmp);
    const comparison = await cmp.h.call(() => cmp.h.runOperation("compare_plans", {}));
    expect((comparison.ranked as Json[]).map(pick)).toEqual(await reference());
    // 4 requests + exactly 2 identical re-requests (one per lost / malformed reply).
    expect(retailers.total()).toBe(2 * RETAILERS.length + 2);
    // The services saw the re-requests as duplicates and answered with the SAME signed reply.
    const dups = retailers.hosts.flatMap((h) => events(h.agent.dir, "duplicate"));
    expect(dups).toHaveLength(2);
    const retries = cmp.a.rt.transmissions().filter((t) => (t.attempts ?? 0) > 1);
    expect(retries.map((t) => t.status)).toEqual(["sent", "sent"]);
    expect(cmp.d.retained()).toEqual([]);
    expect(JSON.parse(readFileSync(join(cmp.a.dir, PUBLIC_REPLIES_FILE), "utf8"))).toEqual({
      version: 1,
      replies: [],
    });
  }, 60_000);
});
