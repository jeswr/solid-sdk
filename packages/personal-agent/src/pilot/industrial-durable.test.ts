/**
 * Durable UC-05 roles in-process (direct carriage between hosts; the separate-process A2A
 * workflow is scripts/pilot-regional-integration.mjs Part I): Alpine planner + data authority,
 * Orbis provider (+ a legacy endpoint on the old model), NordWerk contracting + diagnostic.
 * Shared organisation owner keys per organisation; independent actor keys and mandates.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, openAgent } from "./cli.js";
import { digestOf, newUrn } from "./core/canonical.js";
import type { JsonObject } from "./core/types.js";
import { DATA_OFFER_OP, EQUIPMENT_HEALTH, OFFER_ID, TRANSFER_OP } from "./domains/industrial.js";
import {
  AUTHORITY,
  CHEAPFIX,
  NORDWERK,
  NW_CONTRACT,
  NW_DIAG,
  ORBIS,
  ORBIS_LEGACY,
  ORBIS_TP,
  PLANNER,
} from "./fixtures/industrial.js";
import { AgentHost, type Json } from "./host.js";
import { signStatement, TYP } from "./mechanisms/statements.js";
import { CONFIG_ED25519 } from "./profile/configurations.js";
import { PILOT_PROFILE, PURPOSE } from "./profile/vocabulary.js";
import { readAgent } from "./setup.js";
import { FileLedger, verifyLedger } from "./store/ledger.js";
import type { WireMessage } from "./store/state.js";

const NOW = "2026-10-19T08:00:00Z";
const now = () => new Date(NOW);
const dirs: string[] = [];
const open: AgentHost[] = [];
afterEach(() => {
  for (const h of open.splice(0)) h.agent.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function cli(args: string[]) {
  let out = "";
  await main([...args], { stdout: (s) => (out += s) });
  return JSON.parse(out) as Record<string, unknown>;
}

const NAMES = [
  "alpine-planner",
  "alpine-authority",
  "orbis-telemetry",
  "orbis-legacy",
  "nordwerk-contracting",
  "nordwerk-diagnostic",
] as const;
type Name = (typeof NAMES)[number];

async function provision() {
  const root = mkdtempSync(join(tmpdir(), "awp-industrial-"));
  dirs.push(root);
  const owners = join(root, "owners");
  const common = ["--dir", root, "--now", NOW, "--policy-engine=solid-odrl"];
  const syn = (await cli(["synthetic-industrial", "--out", join(root, "inputs"), ...common])) as {
    programmeIssuer: string;
    membership: string;
  };
  const init: Record<string, Record<string, unknown>> = {};
  const add = async (name: Name, args: string[]) => {
    init[name] = await cli(["init", "--name", name, "--owner-dir", owners, ...args, ...common]);
  };
  await add("alpine-planner", ["--role", "industrial-planner", "--owner-name", "alpine"]);
  await add("alpine-authority", ["--role", "industrial-authority", "--owner-name", "alpine"]);
  const alpineIssuer = join(root, "alpine-issuer.json");
  writeFileSync(
    alpineIssuer,
    JSON.stringify(await cli(["issuer-card", "--name", "alpine-authority", ...common])),
  );
  for (const [p, model] of [
    [ORBIS_TP, "current"],
    [ORBIS_LEGACY, "old"],
  ] as const)
    await add(p.name as Name, [
      "--role",
      "industrial-provider",
      "--party",
      p.party,
      "--actor",
      p.actor,
      "--role-input",
      `issuers=${syn.programmeIssuer},${alpineIssuer}`,
      "--role-input",
      `model=${model}`,
      "--owner-name",
      "orbis",
    ]);
  await add("nordwerk-contracting", [
    "--role",
    "industrial-contracting",
    "--role-input",
    `membership=${syn.membership}`,
    "--owner-name",
    "nordwerk",
  ]);
  await add("nordwerk-diagnostic", ["--role", "industrial-diagnostic", "--owner-name", "nordwerk"]);
  for (const n of NAMES)
    writeFileSync(
      join(root, `${n}.card.json`),
      JSON.stringify(await cli(["card", "--name", n, ...common])),
    );
  const pin = (who: Name, peer: Name) =>
    cli([
      "pin",
      "--name",
      who,
      "--card",
      join(root, `${peer}.card.json`),
      `--party-kid=${String(init[peer]?.partyKid)}`,
      `--actor-kid=${String(init[peer]?.actorKid)}`,
      ...common,
    ]);
  const both = async (a: Name, b: Name) => {
    await pin(a, b);
    await pin(b, a);
  };
  await both("alpine-planner", "alpine-authority");
  await both("alpine-planner", "nordwerk-diagnostic");
  await both("nordwerk-contracting", "orbis-telemetry");
  await both("nordwerk-contracting", "orbis-legacy");
  await both("nordwerk-diagnostic", "orbis-telemetry");
  await both("nordwerk-diagnostic", "nordwerk-contracting");
  return { root, owners, common, init };
}

async function start(root: string, name: Name) {
  const a = await openAgent(root, name, now);
  await a.rt.recover();
  const h = new AgentHost(a, now);
  open.push(h);
  return h;
}
function stop(h: AgentHost) {
  open.splice(open.indexOf(h), 1);
  h.agent.close();
}

const carried: { from: string; kind: string; wire: WireMessage }[] = [];
async function pump(hosts: AgentHost[]) {
  for (let round = 0; round < 30; round++) {
    let moved = 0;
    for (const from of hosts)
      for (const m of from.undelivered()) {
        const to = hosts.find((h) => h.agent.rt.identity.actor === m.toActor);
        if (!to) continue;
        carried.push({ from: from.agent.rt.identity.actor, kind: m.kind, wire: m.wire });
        await to.call(() =>
          to.deliver({
            format: "envelope",
            data: JSON.stringify(m.wire),
            carrier: "direct-local/0.1",
          }),
        );
        await from.call(() => from.ack([m.id]));
        moved++;
      }
    if (moved === 0) return;
  }
  throw new Error("pump did not settle");
}

const conv = (h: AgentHost, id: string) => {
  const c = h.agent.rt.conversation(id);
  return { phase: c?.phase, reason: c?.closedReason?.split(":")[0] };
};
const records = (h: AgentHost, type: string) =>
  new FileLedger(join(h.agent.dir, "ledger.jsonl"))
    .entries()
    .map((e) => e.record as Json)
    .filter((r) => r.type === type);

/** Test harness only: sign a message with an agent's REAL actor key, bypassing its runtime. */
async function forge(
  root: string,
  from: Name,
  fromIdentity: { actor: string; party: string },
  to: { actor: string; party: string },
  kind: "propose" | "invoke",
  body: JsonObject,
  evidence: { role: string; value: string }[],
) {
  const agent = await readAgent(root, from);
  const at = now();
  const jws = await signStatement(agent.actorKey, TYP.message, {
    profile: PILOT_PROFILE,
    configuration: CONFIG_ED25519,
    id: newUrn(),
    conversation: newUrn(),
    kind,
    from: {
      actor: fromIdentity.actor,
      onBehalfOf: fromIdentity.party,
      operator: fromIdentity.party,
    },
    to,
    createdAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + 600_000).toISOString(),
    body,
    evidence: [
      ...evidence.map((e) => ({ ...e, format: "jws-compact" })),
      { role: "representation", format: "jws-compact", value: agent.representationJws },
    ],
  });
  return {
    format: "envelope" as const,
    data: JSON.stringify({ format: "awp-jws-compact/0.1", jws }),
    carrier: "direct-local/0.1",
  };
}

describe("durable industrial maintenance exchange (synthetic, three organisations)", () => {
  it("delegation, eligibility vs authority, exact agreement, transfer, recommendation, restart", async () => {
    const { root, init } = await provision();
    // Custody: one owner key per ORGANISATION, independent actor keys; Alpine's issuing key
    // is a third key.
    expect(init["alpine-planner"]?.partyKid).toBe(init["alpine-authority"]?.partyKid);
    expect(init["nordwerk-contracting"]?.partyKid).toBe(init["nordwerk-diagnostic"]?.partyKid);
    expect(init["alpine-planner"]?.partyKid).not.toBe(init["nordwerk-contracting"]?.partyKid);
    expect(init["alpine-planner"]?.actorKid).not.toBe(init["alpine-authority"]?.actorKid);
    expect(init["alpine-authority"]?.issuerKid).not.toBe(init["alpine-authority"]?.partyKid);
    expect(existsSync(join(root, "inputs", "programme-issuer.json"))).toBe(true);
    expect(readFileSync(join(root, "inputs", "programme-issuer.json"), "utf8")).not.toMatch(
      /"d"\s*:/,
    ); // public card only: the programme's private key was discarded

    const h = {} as Record<Name, AgentHost>;
    for (const n of NAMES) h[n] = await start(root, n);
    const all = () => NAMES.map((n) => h[n]);
    const op = (n: Name, name: string, args: Record<string, unknown> = {}) =>
      h[n].call(() => h[n].runOperation(name, args));
    expect(h["alpine-planner"].operations.map((o) => o.name)).toEqual([
      "request_authorisation",
      "export_authorisation",
      "record_performance",
    ]);
    expect(h["alpine-authority"].operations).toEqual([]);
    expect(h["orbis-telemetry"].operations).toEqual([]);
    expect(h["nordwerk-contracting"].operations.map((o) => o.name)).toEqual([
      "negotiate_offer",
      "request_transfer",
    ]);
    expect(h["nordwerk-diagnostic"].operations.map((o) => o.name)).toEqual([
      "read_dataset",
      "recommend",
    ]);

    // 1. Internal delegation at Alpine: the authority's mandate bounds the recipient.
    const cheap = (await op("alpine-planner", "request_authorisation", {
      authorityActor: AUTHORITY.actor,
      recipient: CHEAPFIX,
    })) as { step: { conversation: string } };
    await pump(all());
    expect(conv(h["alpine-planner"], cheap.step.conversation).phase).toBe("refused");
    const ok = (await op("alpine-planner", "request_authorisation", {
      authorityActor: AUTHORITY.actor,
      recipient: NORDWERK,
    })) as { step: { conversation: string } };
    await pump(all());
    expect(conv(h["alpine-planner"], ok.step.conversation).phase).toBe("completed");
    const tpa = (await op("alpine-planner", "export_authorisation")) as {
      authorisation: string;
      payload: { requestedBy: string; recipient: string; id: string; window: JsonObject };
    };
    // requestedBy is the VERIFIED signer of the internal request, not an input value.
    expect(tpa.payload.requestedBy).toBe(PLANNER.actor);
    expect(tpa.payload.recipient).toBe(NORDWERK);

    // 2. Incompatible model at the legacy endpoint: isolated before any proposal.
    const legacy = (await op("nordwerk-contracting", "negotiate_offer", {
      providerActor: ORBIS_LEGACY.actor,
      authorisation: tpa.authorisation,
      purpose: "maintenance",
    })) as { step: { conversation: string } };
    await pump(all());
    expect(conv(h["nordwerk-contracting"], legacy.step.conversation)).toMatchObject({
      phase: "unsupported",
      reason: "unsupported-term",
    });
    expect(h["orbis-legacy"].agent.rt.agreements()).toEqual([]);

    // 3. Membership is not internal authority: the diagnostic agent (valid NordWerk credential,
    //    over-broad LOCAL mandate) is not represented for contracting → refused at Orbis.
    const membership = JSON.parse(
      readFileSync(join(root, "inputs", "nordwerk-membership.json"), "utf8"),
    ).credential as string;
    const terms = (purpose: string): JsonObject => ({
      model: EQUIPMENT_HEALTH.id,
      modelVersion: EQUIPMENT_HEALTH.version,
      offerId: OFFER_ID,
      asset: "urn:orbis:asset:PRESS-204",
      window: tpa.payload.window,
      purpose,
      recipient: NORDWERK,
      retentionDays: 30,
      noRedistribution: true,
      thirdPartyAuthorisation: tpa.payload.id,
      synthetic: true,
    });
    const byDiag = await forge(
      root,
      "nordwerk-diagnostic",
      NW_DIAG,
      { actor: ORBIS_TP.actor, party: ORBIS },
      "propose",
      {
        operation: DATA_OFFER_OP,
        terms: terms(PURPOSE.maintenance),
        termsDigest: digestOf(terms(PURPOSE.maintenance)),
        round: 1,
      },
      [
        { role: "membership", value: membership },
        { role: "authorisation", value: tpa.authorisation },
      ],
    );
    const diagResult = await h["orbis-telemetry"].call(() => h["orbis-telemetry"].deliver(byDiag));
    expect(diagResult.outbound.map((o) => o.kind)).toEqual(["refuse"]);
    expect(
      records(h["orbis-telemetry"], "representation-assessment").map((r) => [r.actor, r.outcome]),
    ).toContainEqual([NW_DIAG.actor, "not-accepted"]);
    await pump(all());

    // 4. Purpose other than the authorisation's: refused by the holder.
    const rnd = (await op("nordwerk-contracting", "negotiate_offer", {
      providerActor: ORBIS_TP.actor,
      authorisation: tpa.authorisation,
      purpose: "product-development",
    })) as { step: { conversation: string } };
    await pump(all());
    expect(conv(h["nordwerk-contracting"], rnd.step.conversation)).toMatchObject({
      phase: "refused",
      reason: "purpose-not-permitted",
    });

    // 5. Transfer before agreement: refused by the holder at its boundary; nothing transferred.
    const forced = await forge(
      root,
      "nordwerk-contracting",
      NW_CONTRACT,
      { actor: ORBIS_TP.actor, party: ORBIS },
      "invoke",
      {
        operation: TRANSFER_OP,
        input: { dataset: "vibration-temperature" },
        basis: { kind: "agreement", agreement: "urn:awp:agreement:not-formed" },
      },
      [],
    );
    const forcedResult = await h["orbis-telemetry"].call(() =>
      h["orbis-telemetry"].deliver(forced),
    );
    expect(forcedResult.outbound.map((o) => o.kind)).toEqual(["refuse"]);
    expect(forcedResult.step?.reason).toBe("no-agreement");
    expect(records(h["orbis-telemetry"], "transfer")).toEqual([]);
    await pump(all());

    // 6. The authorised contracting agent agrees the EXACT terms.
    const good = (await op("nordwerk-contracting", "negotiate_offer", {
      providerActor: ORBIS_TP.actor,
      authorisation: tpa.authorisation,
      purpose: "maintenance",
    })) as { step: { conversation: string } };
    await pump(all());
    const c = good.step.conversation;
    expect(conv(h["nordwerk-contracting"], c).phase).toBe("agreed");
    const agreement = h["nordwerk-contracting"].agent.rt
      .agreements()
      .find((a) => a.conversation === c);
    expect(
      h["orbis-telemetry"].agent.rt
        .agreements()
        .some((a) => a.id === agreement?.id && a.termsDigest === agreement?.termsDigest),
    ).toBe(true);
    expect(records(h["orbis-telemetry"], "transfer")).toEqual([]); // agreement ≠ transfer

    // 7. Transfer under the agreement; stored under the derived usage policy.
    await op("nordwerk-contracting", "request_transfer", { conversation: c });
    await pump(all());
    expect(conv(h["nordwerk-contracting"], c).phase).toBe("completed");
    const status = h["nordwerk-contracting"].status() as unknown as {
      domain: { dataStore: { id: string; grant: string }[] };
    };
    expect(status.domain.dataStore).toHaveLength(1);
    const dataset = status.domain.dataStore[0]?.id as string;
    expect(records(h["orbis-telemetry"], "transfer")).toHaveLength(1);

    // 8. Restart holder and recipient: state persists; a REPLAYED transfer request is a
    //    duplicate (no second transfer, no second storage); the performed agreement takes no
    //    further transfer request.
    stop(h["orbis-telemetry"]);
    stop(h["nordwerk-contracting"]);
    h["orbis-telemetry"] = await start(root, "orbis-telemetry");
    h["nordwerk-contracting"] = await start(root, "nordwerk-contracting");
    const invoke = carried.find((m) => m.kind === "invoke" && m.from === NW_CONTRACT.actor);
    const replayed = (await h["orbis-telemetry"].call(() =>
      h["orbis-telemetry"].deliver({
        format: "envelope",
        data: JSON.stringify(invoke?.wire),
        carrier: "direct-local/0.1",
      }),
    )) as { step?: { disposition?: string } };
    expect(replayed.step?.disposition).toBe("duplicate");
    await expect(
      op("nordwerk-contracting", "request_transfer", { conversation: c }),
    ).rejects.toThrow(/needs an agreed offer/);
    expect(records(h["orbis-telemetry"], "transfer").map((t) => t.dataset)).toEqual([dataset]);
    const after = h["nordwerk-contracting"].status() as unknown as {
      domain: { dataStore: unknown[] };
    };
    expect(after.domain.dataStore).toHaveLength(1);

    // 9. Internal read: the store decides for the VERIFIED requesting agent and the purpose.
    const denied = (await op("nordwerk-diagnostic", "read_dataset", {
      contractingActor: NW_CONTRACT.actor,
      dataset,
      purpose: "product-development",
    })) as { step: { conversation: string } };
    await pump(all());
    expect(conv(h["nordwerk-diagnostic"], denied.step.conversation)).toMatchObject({
      phase: "refused",
      reason: "not-authorised",
    });
    const read = (await op("nordwerk-diagnostic", "read_dataset", {
      contractingActor: NW_CONTRACT.actor,
      dataset,
      purpose: "maintenance",
    })) as { step: { conversation: string } };
    await pump(all());
    expect(conv(h["nordwerk-diagnostic"], read.step.conversation).phase).toBe("completed");
    const storeLog = new FileLedger(
      join(h["nordwerk-contracting"].agent.dir, "nordwerk-data-store-ledger.jsonl"),
    )
      .entries()
      .map((e) => e.record as Json)
      .filter((r) => r.type === "access-decision");
    expect(storeLog.map((r) => [r.agent, r.purpose, r.decision])).toEqual([
      [NW_DIAG.actor, PURPOSE.productDevelopment, "deny"],
      [NW_DIAG.actor, PURPOSE.maintenance, "permit"],
    ]);

    // 10. Recommendation → accepted → ONE synthetic work order (an effect, not performance).
    const rec = (await op("nordwerk-diagnostic", "recommend", {
      plannerActor: PLANNER.actor,
    })) as { step: { conversation: string } };
    await pump(all());
    expect(conv(h["alpine-planner"], rec.step.conversation).phase).toBe("completed");
    const orders = () =>
      JSON.parse(
        readFileSync(join(h["alpine-planner"].agent.dir, "industrial-work-orders.json"), "utf8"),
      ).orders as Record<string, { id: string; status: string }>;
    expect(Object.values(orders())).toEqual([{ id: "WO-1", status: "open" }]);

    // 11. Planner restart + replay of the recommendation: duplicate, still one work order.
    stop(h["alpine-planner"]);
    h["alpine-planner"] = await start(root, "alpine-planner");
    const proposal = carried.filter((m) => m.kind === "propose" && m.from === NW_DIAG.actor).at(-1);
    const replay = (await h["alpine-planner"].call(() =>
      h["alpine-planner"].deliver({
        format: "envelope",
        data: JSON.stringify(proposal?.wire),
        carrier: "direct-local/0.1",
      }),
    )) as { step?: { disposition?: string } };
    expect(replay.step?.disposition).toBe("duplicate");
    expect(Object.values(orders())).toHaveLength(1);
    const perf = await op("alpine-planner", "record_performance", { workOrder: "WO-1" });
    const perfAgain = await op("alpine-planner", "record_performance", { workOrder: "WO-1" });
    expect([perf.recorded, perfAgain.recorded]).toEqual([true, false]);

    // Agreement, transfer and performance are distinct events in distinct ledgers.
    expect(records(h["orbis-telemetry"], "transfer")).toHaveLength(1);
    expect(records(h["alpine-planner"], "performance-observation")).toHaveLength(1);
    for (const n of NAMES)
      expect(verifyLedger(new FileLedger(join(h[n].agent.dir, "ledger.jsonl")).entries()).ok).toBe(
        true,
      );
  }, 90_000);
});
