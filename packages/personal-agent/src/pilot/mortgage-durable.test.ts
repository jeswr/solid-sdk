/**
 * The DURABLE synthetic mortgage slice in-process: independently initialised consumer, lender
 * intake and underwriter agent directories (roles), each opened by the same persistent runtime
 * through AgentHost, with restarts mid-flow. Messages are carried directly between hosts here;
 * the separate-process workflow (MCP operator + A2A transport + real SPARQ) is
 * scripts/pilot-a2a-integration.mjs. Agents use the explicitly selected solid-odrl module so
 * the gate needs no Rust binary.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, openAgent } from "./cli.js";
import { newUrn } from "./core/canonical.js";
import { NB_ASSESS, NB_MARKETING, NORTH, SAM, UW } from "./fixtures/mortgage.js";
import { auditAgentDirectory } from "./governance.js";
import { AgentHost, type Json } from "./host.js";
import { signApproval } from "./mechanisms/mandate.js";
import { PURPOSE } from "./profile/vocabulary.js";
import { readAgent } from "./setup.js";
import { FileLedger } from "./store/ledger.js";

const NOW = "2026-10-19T08:00:00Z";
const clock = { t: Date.parse(NOW) };
const now = () => new Date(clock.t);
const dirs: string[] = [];
const open: AgentHost[] = [];
afterEach(() => {
  clock.t = Date.parse(NOW);
  delete process.env.AWP_SYNTHETIC_FAULT;
  for (const h of open.splice(0)) h.agent.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function cli(args: string[]) {
  let out = "";
  await main([...args], { stdout: (s) => (out += s) });
  return JSON.parse(out) as Record<string, unknown>;
}

type Name = "sam" | "northbank" | "uw";

async function provision() {
  const root = mkdtempSync(join(tmpdir(), "awp-mortgage-durable-"));
  dirs.push(root);
  // SEPARATE owner custody: owner keys live under `owners/`, never in a service directory.
  const common = [
    "--dir",
    root,
    "--now",
    NOW,
    "--policy-engine=solid-odrl",
    "--owner-dir",
    join(root, "owners"),
  ];
  const issuance = (await cli([
    "synthetic-issuers",
    "--out",
    join(root, "issuance"),
    ...common,
  ])) as {
    issuers: string;
    wallet: string;
  };
  const init: Record<string, Record<string, unknown>> = {};
  init.sam = await cli([
    "init",
    "--name",
    "sam",
    "--role",
    "mortgage-consumer",
    "--wallet",
    issuance.wallet,
    ...common,
  ]);
  init.northbank = await cli([
    "init",
    "--name",
    "northbank",
    "--role",
    "mortgage-lender",
    "--issuers",
    issuance.issuers,
    ...common,
  ]);
  init.uw = await cli(["init", "--name", "uw", "--role", "mortgage-underwriter", ...common]);
  for (const name of ["sam", "northbank", "uw"])
    writeFileSync(
      join(root, `${name}.card.json`),
      JSON.stringify(await cli(["card", "--name", name, ...common])),
    );
  for (const [who, peer] of [
    ["sam", "northbank"],
    ["northbank", "sam"],
    ["northbank", "uw"],
    ["uw", "northbank"],
  ] as const)
    await cli([
      "pin",
      "--name",
      who,
      "--card",
      join(root, `${peer}.card.json`),
      `--party-kid=${String(init[peer]?.partyKid)}`,
      `--actor-kid=${String(init[peer]?.actorKid)}`,
      ...common,
    ]);
  return { root, common };
}

async function start(root: string, name: Name): Promise<AgentHost> {
  const a = await openAgent(root, name, now);
  await a.rt.recover();
  const h = new AgentHost(a, now);
  open.push(h);
  return h;
}

function stop(h: AgentHost): void {
  open.splice(open.indexOf(h), 1);
  h.agent.close();
}

const carried: { kind: string; to: string; wire: unknown }[] = [];

/** Carry every undelivered envelope to its addressee (direct binding) until quiescent. */
async function pump(hosts: AgentHost[]): Promise<Json[]> {
  const steps: Json[] = [];
  for (let round = 0; round < 20; round++) {
    let moved = 0;
    for (const from of hosts)
      for (const m of from.undelivered()) {
        const to = hosts.find((h) => h.agent.rt.identity.actor === m.toActor);
        if (!to) continue;
        const r = await to.call(() =>
          to.deliver({
            format: "envelope",
            data: JSON.stringify(m.wire),
            carrier: "direct-local/0.1",
          }),
        );
        await from.call(() => from.ack([m.id]));
        carried.push({ kind: m.kind, to: to.agent.name, wire: m.wire });
        steps.push({ kind: m.kind, to: to.agent.name, disposition: r.step?.disposition });
        moved++;
      }
    if (moved === 0) return steps;
  }
  throw new Error("pump did not settle");
}

const ledger = (h: AgentHost) =>
  new FileLedger(join(h.agent.dir, "ledger.jsonl")).entries().map((e) => e.record);

describe("durable synthetic mortgage slice (roles; restarts mid-flow)", () => {
  it("prequalification, purpose-bound storage, attenuated underwriting and a final receipt survive restarts without duplicates", async () => {
    const { root, common } = await provision();
    let sam = await start(root, "sam");
    let nb = await start(root, "northbank");
    const uw = await start(root, "uw");
    expect(sam.operations.map((o) => o.name)).toEqual(["start_prequalification"]);
    expect(nb.operations.map((o) => o.name)).toEqual([
      "internal_access",
      "start_underwriting",
      "send_decision_receipt",
      "purge_expired",
    ]);
    expect(uw.operations).toEqual([]);

    // 1. The consumer's operator starts the application with the pinned lender.
    const started = await sam.call(() =>
      sam.runOperation("start_prequalification", {
        lenderActor: NORTH.actor,
        propertyPrice: 450000,
        loanAmount: 380000,
      }),
    );
    const application = (started.step as { conversation: string }).conversation;
    await pump([sam, nb, uw]);
    const pending = sam.agent.rt.pendingApprovals();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.intent).toMatchObject({ recipient: NORTH.party });

    // 2. Restart the consumer while the disclosure awaits the owner's approval.
    stop(sam);
    sam = await start(root, "sam");
    expect(sam.agent.rt.pendingApprovals().map((p) => p.actionDigest)).toEqual([
      pending[0]?.actionDigest,
    ]);
    // An approval signed with the ACTOR key (what a compromised interface could reach) and an
    // unsigned string release nothing: only the owner key authorises.
    const stored = await readAgent(root, "sam");
    const forgedJws = await signApproval(stored.actorKey, {
      type: "OwnerApproval",
      id: newUrn(),
      issuer: SAM.party,
      actor: SAM.actor,
      actionDigest: pending[0]?.actionDigest as string,
      conversation: application,
      decision: "approve",
      issuedAt: NOW,
      validUntil: "2026-10-19T09:00:00Z",
    });
    for (const attempt of [forgedJws, "eyJhbGciOiJub25lIn0.e30.x"]) {
      const forged = await sam.call(() => sam.submitApproval(attempt));
      expect((forged.outbound as unknown[]).length).toBe(0);
    }
    expect(sam.agent.rt.pendingApprovals()).toHaveLength(1);
    // The service directories hold no owner private key; signing needs the owner directory,
    // and a key that is not sam's published party key signs nothing.
    for (const n of ["sam", "northbank", "uw"])
      expect(existsSync(join(root, n, "keys", "owner.private.jwk.json"))).toBe(false);
    const noOwnerDir = common.slice(0, common.indexOf("--owner-dir"));
    await expect(
      cli([
        "sign-approval",
        "--name",
        "sam",
        "--action",
        "x",
        "--conversation",
        application,
        ...noOwnerDir,
      ]),
    ).rejects.toThrow(/separate custody.*--owner-dir/);
    const wrong = join(root, "wrong-owners");
    mkdirSync(join(wrong, "sam"), { recursive: true });
    copyFileSync(
      join(root, "owners", "northbank", "owner.private.jwk.json"),
      join(wrong, "sam", "owner.private.jwk.json"),
    );
    await expect(
      cli([
        "sign-approval",
        "--name",
        "sam",
        "--action",
        "x",
        "--conversation",
        application,
        ...noOwnerDir,
        "--owner-dir",
        wrong,
      ]),
    ).rejects.toThrow(/not sam's published party key/);
    const signed = (await cli([
      "sign-approval",
      "--name",
      "sam",
      "--action",
      pending[0]?.actionDigest as string,
      "--conversation",
      application,
      ...common,
    ])) as { approval: string };
    const approved = await sam.call(() => sam.submitApproval(signed.approval));
    expect(approved.step).toMatchObject({ disposition: "accepted" });
    await pump([sam, nb, uw]);

    // 3. The lender stored the verified evidence under the grant; restart the lender.
    const before = (nb.status().domain as { dataStore: Json[] }).dataStore;
    expect(before.length).toBeGreaterThanOrEqual(2);
    stop(nb);
    nb = await start(root, "northbank");
    expect((nb.status().domain as { dataStore: Json[] }).dataStore).toEqual(before);
    // Replaying the consumer's disclosure after the restart is a duplicate: no second storage.
    const toLender = carried.filter((c) => c.to === "northbank");
    expect(toLender.length).toBeGreaterThan(1);
    for (const c of toLender) {
      const again = await nb.call(() =>
        nb.deliver({
          format: "envelope",
          data: JSON.stringify(c.wire),
          carrier: "direct-local/0.1",
        }),
      );
      expect(again.step?.disposition).toBe("duplicate");
    }
    expect((nb.status().domain as { dataStore: Json[] }).dataStore).toEqual(before);

    // 4. Internal purpose-limited use is permitted; marketing is refused.
    const permit = await nb.call(() =>
      nb.runOperation("internal_access", {
        agent: NB_ASSESS,
        action: "read",
        purpose: PURPOSE.creditChecking,
        application,
      }),
    );
    expect(permit.decision).toBe("permit");
    const marketing = await nb.call(() =>
      nb.runOperation("internal_access", {
        agent: NB_MARKETING,
        action: "read",
        purpose: PURPOSE.marketing,
        application,
      }),
    );
    expect(marketing.decision).toBe("deny");
    expect(marketing.items).toBeUndefined();

    // 5. Lender → underwriter under attenuated terms; once only.
    const uwStart = await nb.call(() => nb.runOperation("start_underwriting", { application }));
    expect(uwStart.attenuatedFields).toEqual(expect.arrayContaining(["annualGrossIncome"]));
    await expect(
      nb.call(() => nb.runOperation("start_underwriting", { application })),
    ).rejects.toThrow(/already requested/);
    await pump([sam, nb, uw]);
    expect(uw.agent.rt.conversations()[0]?.phase).toBe("completed");

    // 6. The final (indicative) receipt reaches the consumer; once only.
    const decided = await nb.call(() => nb.runOperation("send_decision_receipt", { application }));
    expect(decided.decided).toBe("indicatively-eligible");
    await expect(
      nb.call(() => nb.runOperation("send_decision_receipt", { application })),
    ).rejects.toThrow(/already sent/);
    await pump([sam, nb, uw]);
    expect(sam.agent.rt.conversation(application)?.phase).toBe("completed");

    // No duplicate storage, and grants are unchanged (no widening) after all of it.
    expect((nb.status().domain as { dataStore: Json[] }).dataStore).toEqual(before);
    const stores = readFileSync(join(nb.agent.dir, "data-store-ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l).record as Json)
      .filter((r) => r.type === "data-stored");
    expect(stores.length).toBe(before.length);
    expect(ledger(nb).filter((r) => r.type === "message-in").length).toBeGreaterThan(0);
    // Every retained file of every role directory has a governance register entry.
    for (const h of [sam, nb, uw]) {
      const audit = auditAgentDirectory(h.agent.dir);
      expect(audit.unregistered).toEqual([]);
    }
    expect(auditAgentDirectory(sam.agent.dir).files.map((f) => f.resource)).toContain(
      "mortgage-wallet",
    );
    expect(auditAgentDirectory(nb.agent.dir).files.map((f) => f.resource)).toEqual(
      expect.arrayContaining(["purpose-bound-store", "mortgage-workflow"]),
    );
    expect(SAM.party).not.toBe(UW.party);
  }, 30_000);

  /** Provision, apply, approve (owner key outside the service) and store the evidence. */
  async function stored() {
    const { root, common } = await provision();
    const sam = await start(root, "sam");
    const nb = await start(root, "northbank");
    const uw = await start(root, "uw");
    const started = await sam.call(() =>
      sam.runOperation("start_prequalification", {
        lenderActor: NORTH.actor,
        propertyPrice: 450000,
        loanAmount: 380000,
      }),
    );
    const application = (started.step as { conversation: string }).conversation;
    await pump([sam, nb, uw]);
    const [pending] = sam.agent.rt.pendingApprovals();
    const signed = (await cli([
      "sign-approval",
      "--name",
      "sam",
      "--action",
      pending?.actionDigest as string,
      "--conversation",
      application,
      ...common,
    ])) as { approval: string };
    await sam.call(() => sam.submitApproval(signed.approval));
    await pump([sam, nb, uw]);
    return { root, sam, nb, uw, application };
  }

  const underwritingConversations = (h: AgentHost) =>
    h.agent.rt.conversations().filter((c) => c.peer.party === UW.party);
  const finalReceiptsAt = (h: AgentHost, application: string) =>
    ledger(h).filter(
      (r) => r.type === "message-in" && r.kind === "receipt" && r.conversation === application,
    ).length;

  it("interrupted after the intent: provably not started, so the step runs (once); interrupted after the receipt commit: recovered, not repeated", async () => {
    const { root, sam, uw, application } = await stored();
    let nb = open.find((h) => h.agent.name === "northbank") as AgentHost;
    process.env.AWP_SYNTHETIC_FAULT = "lender-underwriting-after-intent";
    await expect(
      nb.call(() => nb.runOperation("start_underwriting", { application })),
    ).rejects.toThrow(/synthetic fault/);
    delete process.env.AWP_SYNTHETIC_FAULT;
    stop(nb);
    nb = await start(root, "northbank"); // restart
    const ran = await nb.call(() => nb.runOperation("start_underwriting", { application }));
    expect(ran.recovered).toBeUndefined();
    expect(underwritingConversations(nb)).toHaveLength(1);
    await pump([sam, nb, uw]);
    const receiptsBefore = finalReceiptsAt(sam, application);
    process.env.AWP_SYNTHETIC_FAULT = "lender-decision-after-commit";
    await expect(
      nb.call(() => nb.runOperation("send_decision_receipt", { application })),
    ).rejects.toThrow(/synthetic fault/);
    delete process.env.AWP_SYNTHETIC_FAULT;
    stop(nb);
    nb = await start(root, "northbank");
    const recovered = await nb.call(() =>
      nb.runOperation("send_decision_receipt", { application }),
    );
    expect(recovered).toMatchObject({ recovered: true });
    await expect(
      nb.call(() => nb.runOperation("send_decision_receipt", { application })),
    ).rejects.toThrow(/already sent/);
    await pump([sam, nb, uw]);
    expect(finalReceiptsAt(sam, application)).toBe(receiptsBefore + 1); // exactly one
    expect(sam.agent.rt.conversation(application)?.phase).toBe("completed");

    // Retention: after the 90-day grant, the payloads are erased; access says so; the old
    // disclosure cannot resurrect them (the signed message has long expired).
    clock.t += 91 * 86_400_000;
    const purged = await nb.call(() => nb.runOperation("purge_expired", {}));
    expect((purged.erased as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect((nb.status().domain as { dataStore: Json[] }).dataStore).toEqual([]);
    const denied = await nb.call(() =>
      nb.runOperation("internal_access", {
        agent: NB_ASSESS,
        action: "read",
        purpose: PURPOSE.creditChecking,
        application,
      }),
    );
    expect(denied).toMatchObject({ decision: "deny", reason: expect.stringMatching(/erased/) });
    const disclosure = carried.filter((c) => c.to === "northbank" && c.kind === "deliver").at(-1);
    const replay = await nb.call(() =>
      nb.deliver({
        format: "envelope",
        data: JSON.stringify(disclosure?.wire),
        carrier: "direct-local/0.1",
      }),
    );
    expect(replay.step?.disposition).toBe("rejected");
    expect((nb.status().domain as { dataStore: Json[] }).dataStore).toEqual([]);
    expect(auditAgentDirectory(nb.agent.dir).unregistered).toEqual([]);
  }, 30_000);

  it("interrupted after the underwriting commit: recovered from the runtime (one conversation); a phase-6 marker stays refused", async () => {
    const { root, sam, uw, application } = await stored();
    let nb = open.find((h) => h.agent.name === "northbank") as AgentHost;
    process.env.AWP_SYNTHETIC_FAULT = "lender-underwriting-after-commit";
    await expect(
      nb.call(() => nb.runOperation("start_underwriting", { application })),
    ).rejects.toThrow(/synthetic fault/);
    delete process.env.AWP_SYNTHETIC_FAULT;
    stop(nb);
    nb = await start(root, "northbank");
    const recovered = await nb.call(() => nb.runOperation("start_underwriting", { application }));
    expect(recovered).toMatchObject({ recovered: true });
    expect(underwritingConversations(nb)).toHaveLength(1);
    await expect(
      nb.call(() => nb.runOperation("start_underwriting", { application })),
    ).rejects.toThrow(/already requested/);
    await pump([sam, nb, uw]);
    expect(uw.agent.rt.conversations().map((c) => c.phase)).toEqual(["completed"]);
    process.env.AWP_SYNTHETIC_FAULT = "lender-decision-after-intent";
    await expect(
      nb.call(() => nb.runOperation("send_decision_receipt", { application })),
    ).rejects.toThrow(/synthetic fault/);
    delete process.env.AWP_SYNTHETIC_FAULT;
    const sent = await nb.call(() => nb.runOperation("send_decision_receipt", { application }));
    expect(sent.recovered).toBeUndefined();
    expect(sent.decided).toBe("indicatively-eligible");
    // A phase-6 marker (no correlation id) cannot be reconciled and is never repeated.
    const wfPath = join(nb.agent.dir, "mortgage-workflow.json");
    writeFileSync(
      wfPath,
      JSON.stringify({ applications: { "urn:legacy:app": { underwritingRequestedAt: NOW } } }),
    );
    await expect(
      nb.call(() => nb.runOperation("start_underwriting", { application: "urn:legacy:app" })),
    ).rejects.toThrow(/cannot be reconciled automatically/);
  }, 30_000);
});
