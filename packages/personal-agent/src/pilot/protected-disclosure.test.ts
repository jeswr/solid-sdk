/**
 * Queued PROTECTED deliveries lose nothing of their authorisation basis: a response prepared
 * under a grant / release is re-checked at the transmission boundary (AgentRuntime.transmit,
 * here through the loopback A2A dispatcher) and leaves ZERO requests and ZERO bytes at the
 * recipient once that basis no longer holds — in the live runtime and after a restart.
 *
 * Note the distinction: "no NEW read after revocation" (the resource server refuses a new
 * request) is tested elsewhere; this file tests "no QUEUED disclosure after revocation".
 * Recipient requests are counted at its listener before any check.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  A2A_BINDING,
  A2aDispatcher,
  type A2aListener,
  readA2aConfig,
  readA2aPeers,
  startA2aServer,
} from "./bindings/a2a.js";
import { main, openAgent } from "./cli.js";
import type { Agreement } from "./core/types.js";
import {
  consumerGrant,
  EQUIPMENT_HEALTH,
  OFFER_ID,
  type OfferTerms,
} from "./domains/industrial.js";
import { PurposeBoundStore } from "./domains/purpose-store.js";
import { CAREBRIEF, CV_AUTH, CV_FHIR, PATIENT_ID } from "./fixtures/health.js";
import { NORDWERK, NW_CONTRACT, nordwerkInternalRoles, ORBIS } from "./fixtures/industrial.js";
import { AgentHost } from "./host.js";
import { solidOdrlEngine } from "./mechanisms/policy-engine.js";
import { PURPOSE } from "./profile/vocabulary.js";

const NOW = "2026-10-19T08:00:00Z";
const DEBUG = false;
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function cli(args: string[]) {
  let out = "";
  await main([...args], { stdout: (s) => (out += s) });
  return out.trim().startsWith("{") ? (JSON.parse(out) as Record<string, unknown>) : {};
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** Stand-in SPARQ executable (permits except the init probe's gated prohibition). */
function standIn(dir: string): string {
  const path = join(dir, "sparq-policy-decide");
  const body = `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
const gated=JSON.parse(s).policy.text.includes("urn:awp:probe:prohibit");
process.stdout.write(JSON.stringify({api:"sparq-policy-decide/1",effect:gated?"indeterminate":"permit",
matchedRules:[],reasons:[],unresolved:gated?[{rule:"r",leftOperand:"purpose",kind:"missing-context"}]:[],
evaluator:{crate:"sparq-policy",version:"0.0.0-stand-in",function:"decide"}}));});`;
  writeFileSync(path, `#!${process.execPath}\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

interface Env {
  root: string;
  owners: string;
  common: string[];
  clock: { t: number };
  now: () => Date;
  init: Record<string, Record<string, unknown>>;
}

async function newEnv(prefix: string): Promise<Env> {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const clock = { t: Date.parse(NOW) };
  return {
    root,
    owners: join(root, "owners"),
    common: ["--dir", root, "--now", NOW],
    clock,
    now: () => new Date(clock.t),
    init: {},
  };
}

async function initAgent(env: Env, name: string, args: string[]) {
  env.init[name] = await cli([
    "init",
    "--name",
    name,
    "--owner-dir",
    env.owners,
    ...args,
    ...env.common,
  ]);
  if (!env.init[name]?.actorKid) throw new Error(`init ${name} failed`);
  writeFileSync(
    join(env.root, `${name}.card.json`),
    JSON.stringify(await cli(["card", "--name", name, ...env.common])),
  );
  await cli([
    "a2a-config",
    "--name",
    name,
    "--port",
    String(await freePort()),
    "--out",
    join(env.root, `${name}.a2a.json`),
    ...env.common,
  ]);
}

async function pinBoth(env: Env, a: string, b: string) {
  for (const [who, peer] of [
    [a, b],
    [b, a],
  ] as const) {
    await cli([
      "pin",
      "--name",
      who,
      "--card",
      join(env.root, `${peer}.card.json`),
      `--party-kid=${String(env.init[peer]?.partyKid)}`,
      `--actor-kid=${String(env.init[peer]?.actorKid)}`,
      ...env.common,
    ]);
    await cli([
      "a2a-pin",
      "--name",
      who,
      "--connection",
      join(env.root, `${peer}.a2a.json`),
      ...env.common,
    ]);
  }
}

interface Running {
  h: AgentHost;
  dispatcher: A2aDispatcher | undefined;
  listener: A2aListener;
  /** POST requests and request bytes that reached this agent's listener (before any check). */
  inbound: { posts: number; bytes: number };
  stop(): Promise<void>;
}

async function run(env: Env, name: string, auto: boolean): Promise<Running> {
  const a = await openAgent(env.root, name, env.now, { extraBindings: [{ id: A2A_BINDING }] });
  const h = new AgentHost(a, env.now);
  await a.rt.recover();
  const inbound = { posts: 0, bytes: 0 };
  const log = (l: string) => {
    if (DEBUG) console.error(`[${name}] ${l}`);
  };
  const listener = await startA2aServer(
    h,
    readA2aConfig(a.dir) as NonNullable<ReturnType<typeof readA2aConfig>>,
    log,
    {
      onRequest: (r) => {
        if (r.method !== "POST") return;
        inbound.posts++;
        inbound.bytes += r.bytes;
      },
    },
  );
  const peers = readA2aPeers(a.dir);
  const dispatcher = peers.length > 0 ? new A2aDispatcher(h, peers, log, 5_000, fetch) : undefined;
  if (dispatcher && auto) h.onOutbound(() => dispatcher.kick());
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    h.stopAccepting();
    await listener.close();
    await dispatcher?.idle();
    await h.drain();
    a.close();
  };
  cleanups.push(stop);
  return { h, dispatcher, listener, inbound, stop };
}

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const op = (r: Running, name: string, args: Record<string, unknown> = {}) =>
  r.h.call(() => r.h.runOperation(name, args));

// ------------------------------------------------------------------ health

async function health() {
  const env = await newEnv("awp-protected-health-");
  const syn = (await cli(["synthetic-health", "--out", join(env.root, "in"), ...env.common])) as {
    resources: string;
    enrollments: string;
  };
  const odrl = ["--policy-engine=solid-odrl"];
  await initAgent(env, "carebrief", [
    "--role",
    "health-patient",
    "--party",
    CAREBRIEF.party,
    "--actor",
    CAREBRIEF.actor,
    ...odrl,
  ]);
  await initAgent(env, "cv-auth", [
    "--role",
    "health-authorization",
    "--role-input",
    `enrollments=${syn.enrollments}`,
    "--owner-name",
    "cedarvalley",
    ...odrl,
  ]);
  const card = join(env.root, "issuer.json");
  writeFileSync(
    card,
    JSON.stringify(await cli(["issuer-card", "--name", "cv-auth", ...env.common])),
  );
  await initAgent(env, "cv-fhir", [
    "--role",
    "health-resource",
    "--party",
    CV_FHIR.party,
    "--actor",
    CV_FHIR.actor,
    "--role-input",
    `resources=${syn.resources}`,
    "--role-input",
    `issuers=${card}`,
    "--owner-name",
    "cedarvalley",
    ...odrl,
  ]);
  await pinBoth(env, "carebrief", "cv-auth");
  await pinBoth(env, "carebrief", "cv-fhir");
  return env;
}

/** Maya obtains a grant (consent valid `consentMinutes`) and asks for one read; cv-fhir queues. */
async function grantAndQueue(env: Env, consentMinutes = 60) {
  const cb = await run(env, "carebrief", true);
  const auth = await run(env, "cv-auth", true);
  let fhir = await run(env, "cv-fhir", false); // MANUAL dispatch: its reply stays queued
  const pa = (await cli([
    "owner-sign",
    "--name",
    "carebrief",
    "--owner-dir",
    env.owners,
    "--kind",
    "patient-authorisation",
    "--args",
    JSON.stringify({
      audience: CV_AUTH.actor,
      approvedScopes: ["launch/patient", "patient/Patient.r", "patient/MedicationRequest.rs"],
      patientId: PATIENT_ID,
      validMinutes: consentMinutes,
    }),
    ...env.common,
  ])) as { statement: string };
  await op(cb, "request_access", { authServerActor: CV_AUTH.actor, authorisation: pa.statement });
  await until(() => cb.h.agent.rt.conversations().at(-1)?.phase === "agreed");
  // Positive control: a read whose reply IS dispatched reaches the patient agent.
  const control = await op(cb, "read_resources", {
    resourceServerActor: CV_FHIR.actor,
    resourceType: "Patient",
  });
  await until(() => fhir.h.undelivered().some((m) => m.kind === "deliver"));
  cb.inbound.posts = 0;
  cb.inbound.bytes = 0;
  const sent = await fhir.dispatcher?.dispatch();
  expect(sent?.failed ?? []).toEqual([]);
  expect(cb.inbound.posts).toBe(1);
  const controlConv = (control as { step: { conversation: string } }).step.conversation;
  await until(() => cb.h.agent.rt.conversation(controlConv)?.phase === "completed");
  // The protected reply under test: queued, NOT dispatched.
  await op(cb, "read_resources", {
    resourceServerActor: CV_FHIR.actor,
    resourceType: "MedicationRequest",
  });
  await until(() => fhir.h.undelivered().some((m) => m.kind === "deliver"));
  const queued = fhir.h.undelivered().find((m) => m.kind === "deliver");
  if (!queued) throw new Error("no deliver queued");
  return {
    cb,
    auth,
    get fhir() {
      return fhir;
    },
    async restartFhir() {
      await fhir.stop();
      fhir = await run(env, "cv-fhir", false);
      return fhir;
    },
    queued,
  };
}

async function expectWithheld(sender: Running, recipient: Running, id: string) {
  recipient.inbound.posts = 0;
  recipient.inbound.bytes = 0;
  const result = await sender.dispatcher?.dispatch();
  expect(result?.failed).toEqual([
    expect.objectContaining({ id, status: "refused", reason: "condition-failed" }),
  ]);
  expect(recipient.inbound).toEqual({ posts: 0, bytes: 0 });
  // No transmission attempt was even written ahead; the item stays listed but WITHHELD.
  expect(sender.h.agent.rt.transmissions().find((t) => t.messageId === id)).toBeUndefined();
  const listed = (await sender.h.call(() => sender.h.listOutbound({}))) as {
    outbound: { id: string; envelope?: unknown; withheld?: string; status: string }[];
  };
  const item = listed.outbound.find((o) => o.id === id);
  expect(item).toMatchObject({ status: "blocked", withheld: expect.any(String) });
  expect(item?.envelope).toBeUndefined();
}

describe("queued protected deliveries are re-checked at the transmission boundary", () => {
  it("health: a searchset queued under a grant is not sent after the patient revokes it — live and after restart", async () => {
    const env = await health();
    const t = await grantAndQueue(env);
    const grant = (await op(t.cb, "current_grant")) as { grant: string };
    const rev = (await cli([
      "owner-sign",
      "--name",
      "carebrief",
      "--owner-dir",
      env.owners,
      "--kind",
      "grant-revocation",
      "--args",
      JSON.stringify({ grant: grant.grant }),
      ...env.common,
    ])) as { statement: string };
    expect(await op(t.fhir, "accept_revocation", { revocation: rev.statement })).toMatchObject({
      revoked: true,
    });
    await expectWithheld(t.fhir, t.cb, t.queued.id);
    const restarted = await t.restartFhir();
    await expectWithheld(restarted, t.cb, t.queued.id);
    // The refusal is recorded with the condition that failed (payload-free).
    const refusals = restarted.h.agent.rt
      .transmissions()
      .filter((x) => x.messageId === t.queued.id);
    expect(refusals).toEqual([]);
  }, 60_000);

  it("health: a searchset queued under a grant is not sent once the grant EXPIRES (consent shorter than the session) — live and after restart", async () => {
    const env = await health();
    const t = await grantAndQueue(env, 5); // consent 5 min → grant ends at +5 min
    env.clock.t += 6 * 60_000; // the 6 h message itself is still valid
    await expectWithheld(t.fhir, t.cb, t.queued.id);
    const restarted = await t.restartFhir();
    await expectWithheld(restarted, t.cb, t.queued.id);
  }, 60_000);
});

// ------------------------------------------------------------------ industrial

async function industrial() {
  const env = await newEnv("awp-protected-ind-");
  const bin = standIn(env.root);
  const syn = (await cli([
    "synthetic-industrial",
    "--out",
    join(env.root, "in"),
    ...env.common,
  ])) as {
    membership: string;
  };
  await initAgent(env, "nordwerk-contracting", [
    "--role",
    "industrial-contracting",
    "--role-input",
    `membership=${syn.membership}`,
    "--owner-name",
    "nordwerk",
    `--sparq-bin=${bin}`,
  ]);
  await initAgent(env, "nordwerk-diagnostic", [
    "--role",
    "industrial-diagnostic",
    "--owner-name",
    "nordwerk",
    "--policy-engine=solid-odrl",
  ]);
  await pinBoth(env, "nordwerk-contracting", "nordwerk-diagnostic");
  // TEST FIXTURE: seed NordWerk's store as if a transfer under an agreement had stored it, with
  // a SHORT (1 h) data-use grant, through the store's own API (commit + evidence).
  const agreement = { id: "urn:test:agreement:1" } as Agreement;
  const terms = {
    model: EQUIPMENT_HEALTH.id,
    modelVersion: EQUIPMENT_HEALTH.version,
    offerId: OFFER_ID,
    asset: "urn:orbis:asset:PRESS-204",
    window: { start: NOW, end: NOW },
    purpose: PURPOSE.maintenance,
    recipient: NORDWERK,
    retentionDays: 1,
    noRedistribution: true,
    thirdPartyAuthorisation: "urn:test:tpa",
    synthetic: true,
  } as OfferTerms;
  const g = consumerGrant(agreement, terms, ORBIS, NORDWERK);
  const dir = join(env.root, "nordwerk-contracting");
  const seed = new PurposeBoundStore(NORDWERK, nordwerkInternalRoles(), env.now, solidOdrlEngine, {
    path: join(dir, "nordwerk-data-store.json"),
    ledgerPath: join(dir, "nordwerk-data-store-ledger.jsonl"),
  });
  seed.put({
    id: "urn:orbis:dataset:test",
    claimType: "telemetry.vibration-temperature",
    subject: "urn:orbis:asset:PRESS-204",
    source: ORBIS,
    data: { samples: [{ t: NOW, vibrationRms: 4.2, temperatureC: 61 }] },
    grant: {
      id: g.policy.id as string,
      target: g.target,
      policy: g.policy,
      assignee: NORDWERK,
      validUntil: new Date(Date.parse(NOW) + 3_600_000).toISOString(),
    },
  });
  return { env, bin };
}

async function releaseAndQueue(env: Env) {
  const diag = await run(env, "nordwerk-diagnostic", true);
  let contracting = await run(env, "nordwerk-contracting", false);
  const read = () =>
    op(diag, "read_dataset", {
      contractingActor: NW_CONTRACT.actor,
      dataset: "urn:orbis:dataset:test",
      purpose: "maintenance",
    });
  // Positive control: released and dispatched → reaches the diagnostic agent.
  await read();
  await until(() => contracting.h.undelivered().some((m) => m.kind === "deliver"));
  diag.inbound.posts = 0;
  expect((await contracting.dispatcher?.dispatch())?.failed ?? []).toEqual([]);
  expect(diag.inbound.posts).toBe(1);
  // The release under test: queued, NOT dispatched.
  await read();
  await until(() => contracting.h.undelivered().some((m) => m.kind === "deliver"));
  const queued = contracting.h.undelivered().find((m) => m.kind === "deliver");
  if (!queued) throw new Error("no deliver queued");
  return {
    diag,
    get contracting() {
      return contracting;
    },
    async restart() {
      await contracting.stop();
      contracting = await run(env, "nordwerk-contracting", false);
      return contracting;
    },
    queued,
  };
}

describe("queued internal dataset releases are re-decided by the enforcement point before sending", () => {
  it("industrial: the store's data-use grant expires while the release is queued — live and after restart", async () => {
    const { env } = await industrial();
    const t = await releaseAndQueue(env);
    env.clock.t += 2 * 3_600_000; // grant (1 h) over; the 6 h message is still valid
    await expectWithheld(t.contracting, t.diag, t.queued.id);
    const restarted = await t.restart();
    await expectWithheld(restarted, t.diag, t.queued.id);
    // The re-decision is in the enforcement point's own ledger.
    const log = readFileSync(
      join(env.root, "nordwerk-contracting", "nordwerk-data-store-ledger.jsonl"),
      "utf8",
    );
    expect(log).toMatch(/"access-recheck"[^\n]*"deny"/);
  }, 60_000);

  it("industrial: the pinned SPARQ policy module is replaced while the release is queued (generic usage decision indeterminate)", async () => {
    const { env, bin } = await industrial();
    const t = await releaseAndQueue(env);
    writeFileSync(bin, `${readFileSync(bin, "utf8")}//replaced`);
    await expectWithheld(t.contracting, t.diag, t.queued.id);
  }, 60_000);
});
