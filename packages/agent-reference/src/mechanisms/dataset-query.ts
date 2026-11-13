// AUTHORED-BY Codex GPT-6
/** A source answers an approved closed rule. The reader never receives dataset rows. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { randomUUID } from "crypto";
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import { id, iso } from "../core/schema.js";
import type { Json, JsonObject, ReasonCode } from "../core/types.js";
import { evaluateRule, ruleInputs, ruleSchema, validateRules } from "../derive/rules.js";
import { type ContextItem, GateMemory } from "../gates/common.js";
import type { StateStore } from "../store/state.js";
import type { SigningKey } from "./jws.js";
import { type ServiceContext, ServiceGate } from "./service-gate.js";
import { signStatement, TYP } from "./statements.js";

export const protocolSchema = z.strictObject({
  rules: z.array(ruleSchema).min(1),
  rule: id,
  cohort: z.strictObject({
    field: z.string(),
    equals: z.union([z.string(), z.number(), z.boolean()]),
  }),
});
export const queryGrantSchema = z.strictObject({
  type: z.literal("QueryGrant"),
  id,
  issuer: id,
  dataset: id,
  reader: z.strictObject({ actor: id, party: id }),
  purpose: id,
  protocol: z.array(protocolSchema).min(1),
  minimumPeople: z.number().int().min(2),
  relatedQueryCap: z.number().int().positive(),
  validUntil: iso,
});
export const datasetRequestSchema = z.strictObject({
  type: z.literal("DatasetQuery"),
  id,
  actor: id,
  party: id,
  representation: z.string(),
  at: iso,
  grant: z.string(),
  purpose: id,
  protocol: z.json(),
});
export const datasetRowSchema = z.strictObject({
  person: id,
  labels: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  claims: z.array(z.record(z.string(), z.json())).min(1),
});
export type DatasetRow = z.infer<typeof datasetRowSchema>;
interface QueryState {
  grantDigest: string;
  count: number;
  requests: Record<string, string>;
  nonce: string;
}
export class LocalDatasetHolder {
  readonly gate: ServiceGate;
  private readonly rows: DatasetRow[];
  constructor(
    readonly options: ServiceContext & {
      key: SigningKey;
      store: StateStore;
      dataset: string;
      rows: DatasetRow[];
      nonce?: string;
    },
  ) {
    this.gate = new ServiceGate(options);
    this.rows = z.array(datasetRowSchema).parse(structuredClone(options.rows));
  }
  count(grant: string) {
    return (
      (this.options.store.load().domain[`query:${grant}`] as unknown as QueryState | undefined)
        ?.count ?? 0
    );
  }
  private release(
    check: "data-terms" | "limits-approval" | "disclosure" | "evidence",
    reason?: ReasonCode,
  ) {
    const event = {
      part: "outbound-gate" as const,
      kind: "check" as const,
      check,
      verdict: reason ? ("fail" as const) : ("pass" as const),
      reason:
        reason ??
        (
          {
            "data-terms": "terms-allow",
            "limits-approval": "within-limits",
            disclosure: "minimal-disclosure",
            evidence: "evidence-complete",
          } as const
        )[check],
      caption: reason
        ? `The holder withholds the answer: ${reason}.`
        : "The holder checks the approved answer before release.",
    };
    this.gate.record("query-release-check", event);
    this.options.sink?.(event);
    if (reason) {
      const decision = {
        part: "outbound-gate" as const,
        kind: "decision" as const,
        outcome: "stop" as const,
        reason,
        caption: `The holder stops: ${reason}.`,
      };
      this.gate.record("query-release-decision", decision);
      this.options.sink?.(decision);
      return { ok: false as const, reason };
    }
    return undefined;
  }
  async query(jws: string) {
    const checked = await this.gate.request(
      jws,
      "awp-dataset-query+jws",
      datasetRequestSchema,
      "urn:op:dataset-query",
    );
    if (!checked.ok) return checked;
    const r = checked.request;
    const verified = await this.gate.verify(
        r.grant,
        "awp-query-grant+jws",
        queryGrantSchema,
        "issuer",
      ),
      g = verified.payload;
    if (
      !g ||
      verified.signer?.subject !== this.options.identity ||
      g.issuer !== this.options.identity ||
      g.dataset !== this.options.dataset
    )
      return this.gate.fail("not-authorised");
    if (g.reader.actor !== r.actor || g.reader.party !== r.party)
      return this.gate.fail("not-authorised");
    this.gate.check("authority");
    this.gate.check("terms");
    this.gate.check("fitness");
    this.gate.decision();
    if (Date.parse(g.validUntil) <= Date.parse(this.options.now()))
      return required(this.release("data-terms", "expired"));
    const protocol = g.protocol.find((p) => digestOf(p) === digestOf(r.protocol));
    if (r.purpose !== g.purpose || !protocol)
      return required(this.release("data-terms", "purpose-not-permitted"));
    this.release("data-terms");
    validateRules(protocol.rules);
    if (
      !protocol.rules.some((rule) => rule.id === protocol.rule) ||
      protocol.rules.some(
        (rule) =>
          !rule.inputsFrom.every((s) => s === this.options.identity) ||
          !rule.assurances.includes("by-source"),
      )
    )
      return required(this.release("data-terms", "purpose-not-permitted"));
    // Count ALL approved queries against this grant, independent of request IDs and cohorts.
    // No await from load through save. A crash after this save consumes the query safely.
    const state = this.options.store.load(),
      key = `query:${g.id}`;
    const prior = state.domain[key] as unknown as QueryState | undefined;
    if (prior && prior.grantDigest !== digestOf(g))
      return required(this.release("data-terms", "purpose-not-permitted"));
    const stored: QueryState = structuredClone(
      prior ?? {
        grantDigest: digestOf(g),
        count: 0,
        requests: {},
        nonce: this.options.nonce ?? randomUUID(),
      },
    );
    if (stored.count >= g.relatedQueryCap)
      return required(this.release("limits-approval", "limit-exceeded"));
    if (stored.requests[r.id]) return required(this.release("limits-approval", "limit-exceeded"));
    stored.count++;
    stored.requests[r.id] = digestOf(r);
    state.domain[key] = stored as unknown as Json;
    this.options.store.save(state);
    this.gate.record("query-counted", { grant: g.id, count: stored.count, request: digestOf(r) });
    this.release("limits-approval");
    const selected = this.rows.filter(
      (row) => row.labels[protocol.cohort.field] === protocol.cohort.equals,
    );
    const reachable: typeof protocol.rules = [];
    const visit = (id: string) => {
      const rule = protocol.rules.find((r) => r.id === id || r.output === id);
      if (!rule || reachable.includes(rule)) return;
      reachable.push(rule);
      ruleInputs(rule).forEach(visit);
    };
    visit(protocol.rule);
    const leaves = reachable.flatMap((rule) =>
      ruleInputs(rule)
        .filter(
          (kind) =>
            !("completeness" in rule.params && kind === rule.params.completeness) &&
            !protocol.rules.some((r) => r.output === kind || r.id === kind),
        )
        .map((kind) => ({ kind, rule })),
    );
    const covering = leaves.map(
      ({ kind, rule }) =>
        new Set(
          selected
            .filter((row) =>
              row.claims.some((c) => {
                if (c.claimType !== kind) return false;
                if ("period" in rule.params && rule.params.period) {
                  const date = Date.parse(String(c.date ?? c.month ?? c.asOf ?? "")),
                    start = Date.parse(rule.params.period.start),
                    end =
                      Date.parse(rule.params.period.end) +
                      (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(rule.params.period.end)
                        ? 86_399_999
                        : 0);
                  return date >= start && date <= end;
                }
                return true;
              }),
            )
            .map((row) => row.person),
        ).size,
    );
    if (!covering.length || covering.some((n) => n < g.minimumPeople))
      return required(this.release("disclosure", "prohibited"));
    this.release("disclosure");
    const memory = new GateMemory(),
      task = `urn:query:${digestOf(r).slice(8)}`,
      at = this.options.now();
    const permissions = [
      {
        type: "permission",
        action: "use",
        constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: g.purpose }],
      },
      {
        type: "permission",
        action: "distribute",
        constraints: [
          { leftOperand: "purpose", operator: "eq", rightOperand: g.purpose },
          { leftOperand: "recipient", operator: "eq", rightOperand: g.reader.party },
        ],
      },
    ];
    const inputTerms = { policy: { id: `urn:query-terms:${digestOf(g).slice(8)}`, permissions } };
    const enter = (statement: JsonObject) => {
      const item: ContextItem = {
        id: String(statement.id),
        digest: digestOf(statement),
        kind: "statement",
        source: this.options.identity,
        subject: this.options.dataset,
        claimType: String(statement.claimType),
        label: String(statement.claimType),
        method: "recorded-by-authority",
        asOf: at,
        terms: inputTerms as unknown as ContextItem["terms"],
        admittedPurpose: g.purpose,
        accepted: true,
        statement,
      };
      memory.enter(task, item);
      memory.facts.set(item.id, item);
    };
    const outputKinds = new Set(protocol.rules.map((rule) => rule.output));
    const kinds = new Set(
      protocol.rules
        .flatMap(ruleInputs)
        .filter(
          (kind) => !outputKinds.has(kind) && !protocol.rules.some((rule) => rule.id === kind),
        ),
    );
    let n = 0;
    for (const row of selected)
      for (const claim of row.claims)
        if (typeof claim.claimType === "string" && kinds.has(claim.claimType))
          enter({
            ...claim,
            id: `urn:private-input:${++n}`,
            issuer: this.options.identity,
            subject: this.options.dataset,
            method: "recorded-by-authority",
            asOf: at,
            terms: inputTerms as unknown as JsonObject,
          });
    for (const rule of protocol.rules)
      if ("completeness" in rule.params)
        enter({
          id: `urn:private-completeness:${++n}`,
          issuer: this.options.identity,
          subject: this.options.dataset,
          claimType: rule.params.completeness,
          complete: true,
          forClaim: rule.params.input,
          period: rule.params.period,
          method: "recorded-by-authority",
          asOf: at,
          terms: inputTerms as unknown as JsonObject,
        });
    const evaluated = evaluateRule({
      rules: protocol.rules,
      rule: protocol.rule,
      memory,
      task,
      subject: this.options.dataset,
      deriver: this.options.identity,
      at,
      purpose: g.purpose,
      assurance: "by-source",
    });
    if (!evaluated.ok) return required(this.release("evidence", evaluated.reason));
    // One source-private snapshot commitment, never per-person rows or identifiers.
    const statement = evaluated.statement,
      derivation = statement.derivation as JsonObject;
    statement.id = `urn:query-answer:${digestOf({
      grant: stored.grantDigest,
      request: digestOf(r),
      nonce: stored.nonce,
      query: stored.count,
    }).slice(8)}`;
    derivation.inputs = [...new Set(leaves.map((l) => l.kind))].map((kind) => ({
      id: `urn:dataset-snapshot:${digestOf({ dataset: g.dataset, kind, nonce: stored.nonce }).slice(8)}`,
      digest: digestOf({ rows: selected, kind, nonce: stored.nonce }),
      issuer: this.options.identity,
      claimType: kind,
      method: "recorded-by-authority",
      asOf: at,
      period: null,
      currency: null,
      validUntil: null,
    }));
    derivation.chain = [];
    derivation.basis = (derivation.inputs as JsonObject[]).map(() => "recorded-by-authority");
    derivation.queryGrant = digestOf(g);
    derivation.query = stored.count;
    statement.terms = inputTerms as unknown as JsonObject;
    this.release("evidence");
    const answer = await signStatement(this.options.key, TYP.statement, statement);
    const decision = {
      part: "outbound-gate" as const,
      kind: "decision" as const,
      outcome: "go" as const,
      reason: "evidence-complete" as const,
      caption: "The holder releases only the signed derived answer after saving its counter.",
    };
    this.gate.record("query-answer", { grant: g.id, answerDigest: digestOf(statement) });
    this.options.sink?.(decision);
    return { ok: true as const, jws: answer };
  }
}

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("required capability value is missing");
  return value;
}
