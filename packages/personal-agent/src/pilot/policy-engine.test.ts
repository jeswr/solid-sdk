/**
 * The declared policy-module seam and the SPARQ engine's protocol handling.
 *
 * What is tested here WITHOUT the Rust evaluator:
 *  - the default solid-odrl engine against the shared authorisation cases;
 *  - the Turtle/request serialisation SPARQ receives (parsed back with n3);
 *  - response mapping, failure handling and the no-fallback rule, using STAND-IN
 *    executables (small local scripts) — these exercise the process boundary only and are
 *    NOT evidence about the sparq-policy evaluator. The real evaluator is exercised by
 *    `scripts/sparq-policy-cases.mjs` when a locally built binary exists.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Parser } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "./core/limits.js";
import { buildMeetingTerms, MEETING_MODEL, SCHEDULE_OP } from "./domains/scheduling.js";
import { schedulingMandate } from "./mandates.js";
import { evaluateIntent, loadMandate } from "./mechanisms/mandate.js";
import { solidOdrlEngine } from "./mechanisms/policy-engine.js";
import {
  odrlPolicyToTurtle,
  SPARQ_DECIDE_API,
  sparqPolicyEngine,
  sparqRequest,
  verdictFromResponse,
} from "./mechanisms/sparq-policy.js";
import { TrustStore } from "./mechanisms/trust.js";
import { POLICY_CASES } from "./policy-cases.js";
import { PURPOSE } from "./profile/vocabulary.js";
import { BOB, fixedClock, personalPair, provisionPair } from "./scenarios/personal.js";

const ODRL = "http://www.w3.org/ns/odrl/2/";
const work = mkdtempSync(join(tmpdir(), "awp-engine-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A stand-in executable (NOT sparq-policy): records stdin, prints a canned response. */
function standIn(name: string, body: string): string {
  const path = join(work, name);
  writeFileSync(path, `#!${process.execPath}\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function canned(response: unknown, exit = 0): string {
  const record = join(work, `stdin-${Math.random().toString(36).slice(2)}.json`);
  return standIn(
    `canned-${Math.random().toString(36).slice(2)}`,
    `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{require("fs").writeFileSync(${JSON.stringify(record)},s);process.stdout.write(${JSON.stringify(JSON.stringify(response))});process.exit(${exit});});`,
  ).concat(`\u0000${record}`);
}

const identity = { crate: "sparq-policy", version: "0.1.0", function: "decide", semantics: "x" };

describe("default engine (solid-odrl) on the shared authorisation cases", () => {
  for (const c of POLICY_CASES) {
    it(`${c.id} ${c.note}`, () => {
      expect(solidOdrlEngine.evaluate(c.policy, c.request).effect).toBe(c.expected);
    });
  }
});

describe("SPARQ engine serialisation", () => {
  it("serialises a pilot policy as parseable Turtle with the pilot's rule identifiers", () => {
    const m = schedulingMandate([BOB.party])({
      owner: "https://alice.example/#me",
      actor: "https://agents.alice.example/personal#agent",
      validFrom: "2026-10-19T00:00:00Z",
      validUntil: "2026-11-19T00:00:00Z",
    });
    const ttl = odrlPolicyToTurtle(m.autonomous, "https://agents.alice.example/personal#agent");
    const quads = new Parser().parse(ttl);
    const rules = quads
      .filter((q) => q.predicate.value === `${ODRL}permission`)
      .map((q) => q.object.value);
    expect(rules).toEqual([(m.autonomous.permissions ?? [])[0]?.id]);
    expect(quads.some((q) => q.predicate.value === `${ODRL}prohibition`)).toBe(true);
    // Multi-valued right operands become RDF lists; IRIs stay IRIs.
    expect(
      quads.some((q) => q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#first"),
    ).toBe(true);
    // A policy assigned to someone else contributes no rules for this subject.
    const other = odrlPolicyToTurtle(
      { ...m.autonomous, assignee: "https://someone.else/#me" },
      "urn:x",
    );
    expect(new Parser().parse(other).some((q) => q.predicate.value === `${ODRL}permission`)).toBe(
      false,
    );
  });

  it("sends typed context and no party (a missing recipient stays missing)", () => {
    const doc = JSON.parse(
      sparqRequest("", {
        agent: "urn:agent",
        action: "use",
        target: "urn:t",
        purpose: PURPOSE.scheduling,
        at: "2026-10-20T09:00:00.000Z",
      }),
    );
    expect(doc.api).toBe(SPARQ_DECIDE_API);
    expect(doc.request).toEqual({
      action: `${ODRL}use`,
      target: "urn:t",
      context: [
        {
          leftOperand: `${ODRL}dateTime`,
          value: { type: "dateTime", value: "2026-10-20T09:00:00.000Z" },
        },
        { leftOperand: `${ODRL}purpose`, value: { type: "iri", value: PURPOSE.scheduling } },
      ],
    });
  });
});

describe("SPARQ engine response mapping (fail closed)", () => {
  const ok = (effect: string, matchedRules: string[] = [], extra = {}) =>
    JSON.stringify({
      api: SPARQ_DECIDE_API,
      evaluator: identity,
      effect,
      matchedRules,
      reasons: ["r"],
      ...extra,
    });
  it("maps permit, prohibition carve-out, no permission and indeterminate", () => {
    expect(verdictFromResponse(ok("permit", ["urn:rule"]), 0, "b")).toMatchObject({
      effect: "permit",
      matchedRule: "urn:rule",
      evaluator: "sparq-policy@0.1.0 decide() via sparq-policy-decide/1",
    });
    expect(verdictFromResponse(ok("deny", ["urn:proh"]), 0, "b").effect).toBe("prohibited");
    expect(verdictFromResponse(ok("deny", []), 0, "b").effect).toBe("not-applicable");
    const ind = verdictFromResponse(
      ok("indeterminate", ["urn:proh"], {
        unresolved: [{ kind: "missing-context", leftOperand: `${ODRL}purpose` }],
      }),
      0,
      "b",
    );
    expect(ind.effect).toBe("indeterminate");
    expect(ind.reason).toContain(`missing-context: ${ODRL}purpose`);
  });

  it("treats refusals, garbage, wrong protocol and wrong evaluator identity as indeterminate", () => {
    for (const [stdout, status] of [
      [JSON.stringify({ api: SPARQ_DECIDE_API, error: "policy: bad turtle" }), 2],
      ["not json", 0],
      [JSON.stringify({ api: "other/1", evaluator: identity, effect: "permit" }), 0],
      [
        JSON.stringify({
          api: SPARQ_DECIDE_API,
          evaluator: { ...identity, crate: "fake" },
          effect: "permit",
        }),
        0,
      ],
      [ok("permit"), 1],
      [ok("maybe"), 0],
    ] as const) {
      expect(verdictFromResponse(stdout, status, "b").effect, stdout).toBe("indeterminate");
    }
  });
});

describe("SPARQ engine process boundary (stand-in executables, not the evaluator)", () => {
  const request = {
    agent: "https://agents.alice.example/personal#agent",
    action: "use",
    target: SCHEDULE_OP.id,
    purpose: PURPOSE.scheduling,
    recipient: BOB.party,
    at: "2026-10-20T09:00:00.000Z",
  };
  const m = schedulingMandate([BOB.party])({
    owner: "https://alice.example/#me",
    actor: request.agent,
    validFrom: "2026-10-19T00:00:00Z",
    validUntil: "2026-11-19T00:00:00Z",
  });

  it("passes the exact typed request on stdin and maps the reply", () => {
    const [path, record] = canned({
      api: SPARQ_DECIDE_API,
      evaluator: identity,
      effect: "permit",
      matchedRules: ["urn:x"],
      reasons: [],
      unresolved: [],
    }).split("\u0000") as [string, string];
    const v = sparqPolicyEngine({ binary: path }).evaluate(m.autonomous, request);
    expect(v).toMatchObject({ effect: "permit", matchedRule: "urn:x" });
    const sent = JSON.parse(readFileSync(record, "utf8"));
    expect(sent.policy.format).toBe("turtle");
    expect(sent.request.context.map((c: { leftOperand: string }) => c.leftOperand)).toEqual([
      `${ODRL}dateTime`,
      `${ODRL}purpose`,
      `${ODRL}recipient`,
    ]);
  });

  it("a missing binary, a hang or an oversized reply is indeterminate", () => {
    expect(
      sparqPolicyEngine({ binary: join(work, "does-not-exist") }).evaluate(m.autonomous, request)
        .effect,
    ).toBe("indeterminate");
    const hang = standIn("hang", "setInterval(()=>{},1000);");
    const t0 = Date.now();
    expect(
      sparqPolicyEngine({ binary: hang, timeoutMs: 300 }).evaluate(m.autonomous, request).effect,
    ).toBe("indeterminate");
    expect(Date.now() - t0).toBeLessThan(3_000);
    const flood = standIn("flood", `process.stdout.write("x".repeat(200000));`);
    expect(sparqPolicyEngine({ binary: flood }).evaluate(m.autonomous, request).effect).toBe(
      "indeterminate",
    );
  });

  it("never falls back: an unavailable SPARQ engine yields an indeterminate decision the default would permit", async () => {
    const clock = fixedClock();
    const { alice } = await provisionPair({ now: clock.now });
    const loaded = await loadMandate(alice.mandateJws, {
      trust: await TrustStore.load(alice.trust),
      actor: alice.identity.actor,
      limits: DEFAULT_LIMITS,
      at: request.at,
    });
    if (!loaded.ok) throw new Error(loaded.reason);
    const intent = {
      operation: SCHEDULE_OP.id,
      action: "use",
      target: SCHEDULE_OP.id,
      purpose: PURPOSE.scheduling,
      recipient: BOB.party,
      parameters: {},
      conversation: "urn:uuid:c",
    };
    const base = { loaded: loaded.loaded, intent, decider: alice.identity.actor, at: request.at };
    expect(evaluateIntent(base).outcome).toBe("permit");
    const engine = sparqPolicyEngine({ binary: join(work, "does-not-exist") });
    const d = evaluateIntent({ ...base, engine });
    expect(d.outcome).toBe("indeterminate");
    expect(d.policy.evaluator).toBe(engine.id);
    expect(d.reason).toMatch(/policy evaluator unavailable/);
  });

  it("a runtime configured with the SPARQ engine records its identity and does not act when it is unavailable", async () => {
    const clock = fixedClock();
    const pair = await personalPair({ now: clock.now });
    const { startAgent, londonCalendar } = await import("./scenarios/personal.js");
    const { CONFIG_ED25519 } = await import("./profile/configurations.js");
    const engine = sparqPolicyEngine({ binary: join(work, "does-not-exist") });
    const alice = await startAgent(pair.alice.provisioned, londonCalendar(), {
      now: clock.now,
      accepted: [CONFIG_ED25519],
      runtime: { policyEngine: engine },
    });
    const start = await alice.runtime.startNegotiation({
      peer: { actor: BOB.actor, party: BOB.party },
      operation: SCHEDULE_OP,
      terms: buildMeetingTerms({
        calendar: alice.calendar,
        title: "x",
        durationMinutes: 30,
        window: { start: "2026-10-20T13:00:00Z", end: "2026-10-20T17:00:00Z" },
        now: clock.now().toISOString(),
      }) as never,
      models: [MEETING_MODEL],
      discover: false,
      configuration: CONFIG_ED25519,
    });
    expect(start.outbound).toEqual([]);
    const decision = alice.ledger.entries().find((e) => e.record.type === "authorisation-decision");
    expect(decision?.record).toMatchObject({
      outcome: "indeterminate",
      policy: { evaluator: engine.id },
    });
  });
});
