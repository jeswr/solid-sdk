/**
 * Durable UC-04 roles in-process (direct carriage between hosts; the separate-process A2A
 * workflow is scripts/pilot-regional-integration.mjs Part H; queued protected deliveries over
 * the real transmission boundary are in protected-disclosure.test.ts): two patient agents
 * (Maya, Noah) and an un-enrolled one (Zoe), the authorisation service (own token-issuer key,
 * the clinic's enrollment register), a resource service and a second resource service (wrong
 * audience). Separate owner custody; the Cedar Valley services share their organisation's
 * owner key but have their own actor keys and mandates.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, openAgent } from "./cli.js";
import { newUrn } from "./core/canonical.js";
import { AUTHZ_OP } from "./domains/fhir.js";
import {
  CAREBRIEF,
  CAREBRIEF_NOAH,
  CV_ARCHIVE,
  CV_AUTH,
  CV_FHIR,
  NOAH_PATIENT_ID,
  PATIENT_ID,
} from "./fixtures/health.js";
import { AgentHost, type Json } from "./host.js";
import { signStatement, TYP } from "./mechanisms/statements.js";
import { PURPOSE } from "./profile/vocabulary.js";
import { scopedStateKey } from "./roles/durable.js";
import { readAgent, readOwnerKey } from "./setup.js";
import { FileLedger } from "./store/ledger.js";

const NOW = "2026-10-19T08:00:00Z";
const now = () => new Date(NOW);
const dirs: string[] = [];
const open: AgentHost[] = [];
afterEach(() => {
  for (const h of open.splice(0)) h.agent.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ZOE = {
  name: "carebrief-zoe",
  party: "https://zoe.example/#me",
  actor: "https://carebrief.example/agents/brief-zoe#agent",
};
const PATIENTS = [CAREBRIEF, CAREBRIEF_NOAH, ZOE];
const SERVICES = ["cv-auth", "cv-fhir", "cv-archive"];
const APPROVED = [
  "launch/patient",
  "patient/Patient.r",
  "patient/MedicationRequest.rs",
  "patient/AllergyIntolerance.rs",
];

async function cli(args: string[]) {
  let out = "";
  await main([...args], { stdout: (s) => (out += s) });
  return JSON.parse(out) as Record<string, unknown>;
}

async function provision() {
  const root = mkdtempSync(join(tmpdir(), "awp-health-"));
  dirs.push(root);
  const owners = join(root, "owners");
  const common = ["--dir", root, "--now", NOW, "--policy-engine=solid-odrl"];
  const syn = (await cli(["synthetic-health", "--out", join(root, "inputs"), ...common])) as {
    resources: string;
    enrollments: string;
  };
  const init: Record<string, Record<string, unknown>> = {};
  for (const [p, patientId] of [
    [CAREBRIEF, PATIENT_ID],
    [CAREBRIEF_NOAH, NOAH_PATIENT_ID],
    [ZOE, "synthetic-zoe"],
  ] as const)
    init[p.name] = await cli([
      "init",
      "--name",
      p.name,
      "--role",
      "health-patient",
      "--party",
      p.party,
      "--actor",
      p.actor,
      "--role-input",
      `patient-id=${patientId}`,
      "--owner-dir",
      owners,
      ...common,
    ]);
  init["cv-auth"] = await cli([
    "init",
    "--name",
    "cv-auth",
    "--role",
    "health-authorization",
    "--role-input",
    `enrollments=${syn.enrollments}`,
    "--owner-dir",
    owners,
    "--owner-name",
    "cedarvalley",
    ...common,
  ]);
  const issuerCard = join(root, "token-issuer.json");
  writeFileSync(
    issuerCard,
    JSON.stringify(await cli(["issuer-card", "--name", "cv-auth", ...common])),
  );
  for (const r of [CV_FHIR, CV_ARCHIVE])
    init[r.name] = await cli([
      "init",
      "--name",
      r.name,
      "--role",
      "health-resource",
      "--party",
      r.party,
      "--actor",
      r.actor,
      "--role-input",
      `resources=${syn.resources}`,
      "--role-input",
      `issuers=${issuerCard}`,
      "--owner-dir",
      owners,
      "--owner-name",
      "cedarvalley",
      ...common,
    ]);
  for (const n of [...PATIENTS.map((p) => p.name), ...SERVICES])
    writeFileSync(
      join(root, `${n}.card.json`),
      JSON.stringify(await cli(["card", "--name", n, ...common])),
    );
  const pin = (who: string, peer: string) =>
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
  for (const p of PATIENTS)
    for (const s of SERVICES) {
      await pin(p.name, s);
      await pin(s, p.name);
    }
  return { root, owners, common, init };
}

async function start(root: string, name: string, clock = now) {
  const a = await openAgent(root, name, clock);
  await a.rt.recover();
  const h = new AgentHost(a, clock);
  open.push(h);
  return h;
}
function stop(h: AgentHost) {
  open.splice(open.indexOf(h), 1);
  h.agent.close();
}

async function pump(hosts: AgentHost[]) {
  for (let round = 0; round < 20; round++) {
    let moved = 0;
    for (const from of hosts)
      for (const m of from.undelivered()) {
        const to = hosts.find((h) => h.agent.rt.identity.actor === m.toActor);
        if (!to) continue;
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

const lastPhase = (h: AgentHost) => {
  const c = h.agent.rt.conversations().at(-1);
  return { phase: c?.phase, reason: c?.closedReason };
};
const records = (h: AgentHost, type: string) =>
  new FileLedger(join(h.agent.dir, "ledger.jsonl"))
    .entries()
    .map((e) => e.record as Json)
    .filter((r) => r.type === type);
const grantOf = (h: AgentHost) =>
  (
    h.agent.rt.domainState(scopedStateKey(AUTHZ_OP, "carebrief")) as {
      grant?: { id: string; jws: string };
    }
  )?.grant;
const payloadOf = (jws: string) =>
  JSON.parse(Buffer.from(jws.split(".")[1] as string, "base64url").toString()) as Json;

describe("durable health summary (synthetic FHIR R4, SMART-like pattern)", () => {
  it("scoped grant, refusals, cited summary, revocation surviving restart", async () => {
    const { root, owners, common, init } = await provision();
    // Shared organisation owner key; independent actor keys; no owner key in any service dir.
    expect(init["cv-auth"]?.partyKid).toBe(init["cv-fhir"]?.partyKid);
    expect(init["cv-auth"]?.actorKid).not.toBe(init["cv-fhir"]?.actorKid);
    // The token issuer key is neither the org owner key nor the service actor key.
    expect(init["cv-auth"]?.issuerKid).not.toBe(init["cv-auth"]?.partyKid);
    expect(init["cv-auth"]?.issuerKid).not.toBe(init["cv-auth"]?.actorKid);
    let cb = await start(root, "carebrief");
    const auth = await start(root, "cv-auth");
    let fhir = await start(root, "cv-fhir");
    const archive = await start(root, "cv-archive");
    const all = () => [cb, auth, fhir, archive];
    expect(cb.operations.map((o) => o.name)).toEqual([
      "request_access",
      "read_resources",
      "current_grant",
      "summarise",
    ]);
    expect(fhir.operations.map((o) => o.name)).toEqual(["accept_revocation"]);

    // The patient signs outside the service: a SUBSET (no Observation) for this client key.
    const pa = (await cli([
      "owner-sign",
      "--name",
      "carebrief",
      "--owner-dir",
      owners,
      "--kind",
      "patient-authorisation",
      "--args",
      JSON.stringify({ audience: CV_AUTH.actor, approvedScopes: APPROVED, patientId: PATIENT_ID }),
      ...common,
    ])) as { statement: string };
    await cb.call(() =>
      cb.runOperation("request_access", {
        authServerActor: CV_AUTH.actor,
        authorisation: pa.statement,
      }),
    );
    await pump(all());
    const decision = records(auth, "scope-decision")[0];
    expect(decision).toMatchObject({
      granted: APPROVED,
      patient: CAREBRIEF.party,
      patientId: PATIENT_ID,
      audience: CV_AUTH.actor,
      purpose: PURPOSE.personalHealthSummary,
    });
    const grant = grantOf(cb);
    expect(grant?.id).toBeTruthy();
    // Signed with the token-issuer key; names its patient principal and consent.
    const header = JSON.parse(
      Buffer.from((grant?.jws ?? "").split(".")[0] as string, "base64url").toString(),
    );
    expect(header.kid).toBe(init["cv-auth"]?.issuerKid);
    expect(payloadOf(grant?.jws ?? "")).toMatchObject({
      patient: CAREBRIEF.party,
      patientId: PATIENT_ID,
      consent: payloadOf(pa.statement).id,
    });

    const read = async (resourceType: string, server = CV_FHIR.actor, patientId?: string) => {
      await cb.call(() =>
        cb.runOperation("read_resources", {
          resourceServerActor: server,
          resourceType,
          ...(patientId ? { patientId } : {}),
        }),
      );
      await pump(all());
      return lastPhase(cb);
    };
    expect((await read("Patient")).phase).toBe("completed");
    expect((await read("MedicationRequest")).phase).toBe("completed");
    expect((await read("AllergyIntolerance")).phase).toBe("completed");
    expect(await read("Observation")).toMatchObject({
      phase: "refused",
      reason: expect.stringMatching(/insufficient-scope/),
    });
    expect(await read("MedicationRequest", CV_FHIR.actor, NOAH_PATIENT_ID)).toMatchObject({
      phase: "refused",
      reason: expect.stringMatching(/insufficient-scope/),
    });
    expect(await read("MedicationRequest", CV_ARCHIVE.actor)).toMatchObject({
      phase: "refused",
      reason: expect.stringMatching(/grant-invalid/),
    });
    const denials = records(fhir, "audit-denial").map((d) => d.reason);
    expect(denials).toEqual(["insufficient-scope", "insufficient-scope"]);
    expect(records(archive, "audit-denial").map((d) => d.reason)).toEqual(["grant-invalid"]);
    // Minimised audit: no clinical payload at the resource server.
    expect(
      JSON.stringify(new FileLedger(join(fhir.agent.dir, "ledger.jsonl")).entries()),
    ).not.toMatch(/lisinopril|penicillin|atorvastatin|Systolic|metformin/i);
    // The searchset deliveries carried their grant as a disclosure condition.
    const conditioned = records(fhir, "message-out").filter((r) => r.conditions);
    expect(conditioned.length).toBe(3);
    // No write capability anywhere: the resource server describes only the read operation.
    const ops = (
      fhir.agent.rt.description() as unknown as { operations: { id: string }[] }
    ).operations.map((o) => o.id);
    expect(ops.some((id) => id.includes("write"))).toBe(false);

    // Summary: cited with resource versions; contradictions unresolved; no other patient.
    const summary = await cb.call(() => cb.runOperation("summarise", {}));
    const stmts = summary.statements as { status: string; cites: string[]; text: string }[];
    expect(stmts.length).toBeGreaterThan(0);
    for (const s of stmts)
      for (const c of s.cites)
        expect(c).toMatch(/\/_history\/\d+ @ https:\/\/cedarvalley\.example\/fhir$/);
    expect(stmts.some((s) => s.status === "unresolved")).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/Observation\/|metformin|synthetic-noah/);

    // Patient restart: grant, resources and summary persist.
    stop(cb);
    cb = await start(root, "carebrief");
    const again = await cb.call(() => cb.runOperation("summarise", {}));
    expect(again.statements).toEqual(summary.statements);

    // Revocation, signed by the patient outside the service over the grant they hold.
    const held = await cb.call(() => cb.runOperation("current_grant", {}));
    expect(held.id).toBe(grant?.id);
    const rev = (await cli([
      "owner-sign",
      "--name",
      "carebrief",
      "--owner-dir",
      owners,
      "--kind",
      "grant-revocation",
      "--args",
      JSON.stringify({ grant: held.grant }),
      ...common,
    ])) as { statement: string };
    expect(
      (await auth.call(() => auth.runOperation("accept_revocation", { revocation: rev.statement })))
        .revoked,
    ).toBe(true);
    expect(
      (await fhir.call(() => fhir.runOperation("accept_revocation", { revocation: rev.statement })))
        .revoked,
    ).toBe(true);
    // A revocation signed with the patient AGENT's actor key is not the patient's: refused.
    const actorKey = (await readAgent(root, "carebrief")).actorKey;
    const forged = await signStatement(actorKey, TYP.statement, {
      type: "GrantRevocation",
      id: "urn:uuid:forged-revocation",
      grant: grant?.id,
      grantStatement: grant?.jws,
      patient: CAREBRIEF.party,
      issuedAt: NOW,
    });
    expect(
      (await fhir.call(() => fhir.runOperation("accept_revocation", { revocation: forged })))
        .revoked,
    ).toBe(false);
    expect(await read("MedicationRequest")).toMatchObject({
      phase: "refused",
      reason: expect.stringMatching(/grant-revoked/),
    });
    stop(fhir);
    fhir = await start(root, "cv-fhir"); // restart: revocation persisted
    expect(await read("Patient")).toMatchObject({
      phase: "refused",
      reason: expect.stringMatching(/grant-revoked/),
    });
  }, 60_000);

  it("issuance authority: clinic enrollment, consent audience/purpose/validity, bounded expiry — with authentic owner signatures", async () => {
    const { root, owners } = await provision();
    const clock = { t: Date.parse(NOW) };
    const at = () => new Date(clock.t);
    const hosts: Record<string, AgentHost> = {};
    for (const n of ["carebrief", "carebrief-noah", "carebrief-zoe", "cv-auth", "cv-fhir"])
      hosts[n] = await start(root, n, at);
    const all = () => Object.values(hosts);
    const auth = hosts["cv-auth"] as AgentHost;

    /** Sign a consent with the patient's REAL owner key (from the owner directory). */
    const consent = async (name: string, over: Json = {}) => {
      const agent = await readAgent(root, name);
      const owner = await readOwnerKey(root, name, owners);
      return signStatement(owner.key, TYP.statement, {
        type: "PatientAuthorisation",
        id: newUrn(),
        patient: agent.identity.party,
        patientId: PATIENT_ID,
        client: agent.identity.actor,
        clientKid: agent.actorKey.kid,
        audience: CV_AUTH.actor,
        approvedScopes: APPROVED,
        purpose: PURPOSE.personalHealthSummary,
        issuedAt: at().toISOString(),
        validUntil: new Date(clock.t + 60 * 60_000).toISOString(),
        ...over,
      });
    };
    const request = async (
      name: string,
      authorisation: string,
      extra: Json = {},
    ): Promise<{ phase?: string; reason?: string; detail?: string }> => {
      const h = hosts[name] as AgentHost;
      await h.call(() =>
        h.runOperation("request_access", {
          authServerActor: CV_AUTH.actor,
          authorisation,
          ...extra,
        }),
      );
      await pump(all());
      const last = records(auth, "consent-decision").at(-1);
      return { ...lastPhase(h), detail: last?.detail as string | undefined };
    };

    // Maya asks, with her own authentic consent, for NOAH's compartment → refused.
    const cross = await request(
      "carebrief",
      await consent("carebrief", { patientId: NOAH_PATIENT_ID }),
      { patientId: NOAH_PATIENT_ID },
    );
    expect(cross).toMatchObject({
      phase: "refused",
      reason: expect.stringMatching(/not-authorised/),
      detail: expect.stringMatching(/not the enrolled compartment/),
    });
    // Noah, authentically, for MAYA's compartment → refused; for his own → granted.
    expect(
      await request("carebrief-noah", await consent("carebrief-noah"), { patientId: PATIENT_ID }),
    ).toMatchObject({ phase: "refused", detail: expect.stringMatching(/enrolled compartment/) });
    expect(
      await request(
        "carebrief-noah",
        await consent("carebrief-noah", { patientId: NOAH_PATIENT_ID }),
      ),
    ).toMatchObject({ phase: "agreed" });
    // Zoe is authentic but not enrolled at this clinic → refused.
    expect(
      await request(
        "carebrief-zoe",
        await consent("carebrief-zoe", { patientId: "synthetic-zoe" }),
      ),
    ).toMatchObject({ phase: "refused", detail: expect.stringMatching(/not enrolled/) });
    // Consent addressed to ANOTHER authorisation service → refused.
    expect(
      await request("carebrief", await consent("carebrief", { audience: "urn:test:OTHER-auth" })),
    ).toMatchObject({ phase: "refused", detail: expect.stringMatching(/another authorisation/) });
    // Consent for another purpose → refused.
    expect(
      await request(
        "carebrief",
        await consent("carebrief", { purpose: "https://w3id.org/dpv#Marketing" }),
      ),
    ).toMatchObject({ phase: "refused", reason: expect.stringMatching(/purpose-not-permitted/) });
    // Expired, future and malformed/too-long validity → refused.
    expect(
      await request(
        "carebrief",
        await consent("carebrief", {
          issuedAt: new Date(clock.t - 2 * 3_600_000).toISOString(),
          validUntil: new Date(clock.t - 3_600_000).toISOString(),
        }),
      ),
    ).toMatchObject({ phase: "refused", reason: expect.stringMatching(/grant-expired/) });
    expect(
      await request(
        "carebrief",
        await consent("carebrief", {
          issuedAt: new Date(clock.t + 3_600_000).toISOString(),
          validUntil: new Date(clock.t + 2 * 3_600_000).toISOString(),
        }),
      ),
    ).toMatchObject({ phase: "refused", reason: expect.stringMatching(/not-yet-valid/) });
    expect(
      await request(
        "carebrief",
        await consent("carebrief", {
          validUntil: new Date(clock.t + 3 * 86_400_000).toISOString(),
        }),
      ),
    ).toMatchObject({ phase: "refused", detail: expect.stringMatching(/malformed or too long/) });
    // A ONE-minute consent with a 60-minute session → the grant ends with the consent.
    expect(
      await request(
        "carebrief",
        await consent("carebrief", { validUntil: new Date(clock.t + 60_000).toISOString() }),
        { sessionMinutes: 60 },
      ),
    ).toMatchObject({ phase: "agreed" });
    const mayaGrant = grantOf(hosts.carebrief as AgentHost);
    expect(payloadOf(mayaGrant?.jws ?? "").expiresAt).toBe(
      new Date(clock.t + 60_000).toISOString(),
    );
    // Every refusal was recorded; issued grants name the enrolled patient only.
    expect(records(auth, "consent-decision").length).toBe(8);
    expect(records(auth, "scope-decision").map((d) => [d.patient, d.patientId])).toEqual([
      [CAREBRIEF_NOAH.party, NOAH_PATIENT_ID],
      [CAREBRIEF.party, PATIENT_ID],
    ]);

    // Noah's data release: only his compartment; Maya's grant never releases Noah's records.
    const noah = hosts["carebrief-noah"] as AgentHost;
    await noah.call(() =>
      noah.runOperation("read_resources", {
        resourceServerActor: CV_FHIR.actor,
        resourceType: "MedicationRequest",
      }),
    );
    await pump(all());
    const fhir = hosts["cv-fhir"] as AgentHost;
    expect(records(fhir, "audit-access").map((a) => a.ids)).toEqual([
      [`MedicationRequest/${NOAH_PATIENT_ID}-mr-1`],
    ]);
  }, 60_000);

  it("revocation needs authoritative grant ownership (unknown, arbitrary, cross-patient refused; own accepted; persisted)", async () => {
    const { root, owners, common } = await provision();
    const hosts: Record<string, AgentHost> = {};
    for (const n of ["carebrief", "carebrief-noah", "cv-auth", "cv-fhir"])
      hosts[n] = await start(root, n);
    const all = () => Object.values(hosts);
    const sign = async (name: string, kind: string, args: Json) =>
      (
        (await cli([
          "owner-sign",
          "--name",
          name,
          "--owner-dir",
          owners,
          "--kind",
          kind,
          "--args",
          JSON.stringify(args),
          ...common,
        ])) as { statement: string }
      ).statement;
    const obtain = async (name: string, patientId: string) => {
      const h = hosts[name] as AgentHost;
      const pa = await sign(name, "patient-authorisation", {
        audience: CV_AUTH.actor,
        approvedScopes: APPROVED,
        patientId,
      });
      await h.call(() =>
        h.runOperation("request_access", { authServerActor: CV_AUTH.actor, authorisation: pa }),
      );
      await pump(all());
      return (await h.call(() => h.runOperation("current_grant", {}))) as {
        id: string;
        grant: string;
      };
    };
    const maya = await obtain("carebrief", PATIENT_ID);
    const noah = await obtain("carebrief-noah", NOAH_PATIENT_ID);
    const accept = (server: string, revocation: string) => {
      const h = hosts[server] as AgentHost;
      return h.call(() => h.runOperation("accept_revocation", { revocation }));
    };

    // Noah (authentic owner signature) names MAYA's real grant → refused at both servers.
    const cross = await sign("carebrief-noah", "grant-revocation", { grant: maya.grant });
    for (const s of ["cv-auth", "cv-fhir"])
      expect(await accept(s, cross)).toMatchObject({
        revoked: false,
        reason: expect.stringMatching(/another patient/),
      });
    // An arbitrary / unknown grant id, with a grant statement Maya forged herself → refused.
    const mayaOwner = await readOwnerKey(root, "carebrief", owners);
    const fakeGrant = await signStatement(mayaOwner.key, TYP.statement, {
      ...payloadOf(maya.grant),
      id: "urn:test:UNRELATED-grant",
    });
    const arbitrary = await signStatement(mayaOwner.key, TYP.statement, {
      type: "GrantRevocation",
      id: newUrn(),
      grant: "urn:test:UNRELATED-grant",
      grantStatement: fakeGrant,
      patient: CAREBRIEF.party,
      issuedAt: NOW,
    });
    expect(await accept("cv-fhir", arbitrary)).toMatchObject({
      revoked: false,
      reason: expect.stringMatching(/not a grant of the pinned issuer/),
    });
    // A real grant carried under a different grant id → refused.
    const mismatch = await signStatement(mayaOwner.key, TYP.statement, {
      type: "GrantRevocation",
      id: newUrn(),
      grant: "urn:test:UNRELATED-grant",
      grantStatement: maya.grant,
      patient: CAREBRIEF.party,
      issuedAt: NOW,
    });
    expect(await accept("cv-fhir", mismatch)).toMatchObject({
      revoked: false,
      reason: expect.stringMatching(/not the grant named/),
    });
    // Maya's own revocation → accepted; Noah's grant is untouched.
    const own = await sign("carebrief", "grant-revocation", { grant: maya.grant });
    expect(await accept("cv-auth", own)).toMatchObject({ revoked: true });
    expect(await accept("cv-fhir", own)).toMatchObject({ revoked: true });
    expect(
      records(hosts["cv-fhir"] as AgentHost, "revocation-refused").map((r) => r.reason),
    ).toHaveLength(3);
    // Persisted with the verified ownership facts; survives a restart.
    stop(hosts["cv-fhir"] as AgentHost);
    hosts["cv-fhir"] = await start(root, "cv-fhir");
    const status = (hosts["cv-fhir"] as AgentHost).status() as {
      domain: { revokedGrants: string[] };
    };
    expect(status.domain.revokedGrants).toEqual([maya.id]);
    expect(status.domain.revokedGrants).not.toContain(noah.id);
    const read = async (name: string) => {
      const h = hosts[name] as AgentHost;
      await h.call(() =>
        h.runOperation("read_resources", {
          resourceServerActor: CV_FHIR.actor,
          resourceType: "Patient",
        }),
      );
      await pump(all());
      return lastPhase(h);
    };
    expect(await read("carebrief")).toMatchObject({
      phase: "refused",
      reason: expect.stringMatching(/grant-revoked/),
    });
    expect((await read("carebrief-noah")).phase).toBe("completed");
  }, 60_000);
});
