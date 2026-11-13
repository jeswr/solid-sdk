// AUTHORED-BY Codex GPT-6
/** A closed, deterministic template set. These rules contain data, never executable text. */
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import type { JsonObject } from "../core/types.js";
import type { ContextItem, GateMemory } from "../gates/common.js";
import { claimTime, evaluateItemTerms, fitnessOf } from "../gates/quality.js";

const name = z.string().min(1);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const period = z.strictObject({
  start: z.string().refine((v) => month.safeParse(v).success || Number.isFinite(Date.parse(v))),
  end: z.string().refine((v) => month.safeParse(v).success || Number.isFinite(Date.parse(v))),
});
const common = {
  id: z.string().regex(/^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]+$/i),
  output: name,
  inputsFrom: z.array(name).min(1),
  assurances: z
    .array(z.enum(["recomputed", "by-source", "proved", "joint", "attested"]))
    .default(["recomputed"]),
};
const aggregate = { input: name, field: name.default("value"), period, completeness: name };
export const ruleSchema = z.discriminatedUnion("template", [
  z.strictObject({
    ...common,
    template: z.enum(["sum", "count", "min", "max"]),
    params: z.strictObject(aggregate),
  }),
  z.strictObject({
    ...common,
    template: z.literal("annualise-consecutive-months"),
    params: z.strictObject({
      input: name,
      months: z.number().int().min(1).max(120),
      field: name.default("value"),
      period: period.optional(),
    }),
  }),
  z.strictObject({
    ...common,
    template: z.literal("ratio"),
    params: z.strictObject({ numerator: name, denominator: name }),
  }),
  z.strictObject({
    ...common,
    template: z.literal("threshold"),
    params: z
      .strictObject({
        input: name,
        operator: z.enum(["lt", "lte", "eq", "gte", "gt"]),
        value: z.number().optional(),
        compareWith: name.optional(),
      })
      .refine(
        (p) => (p.value === undefined) !== (p.compareWith === undefined),
        "exactly one comparison operand",
      ),
  }),
  z.strictObject({
    ...common,
    template: z.enum(["all-of", "any-of"]),
    params: z.strictObject({ inputs: z.array(name).min(1) }),
  }),
]);
export type DerivationRule = z.infer<typeof ruleSchema>;
export function ruleInputs(r: DerivationRule): string[] {
  const p = r.params;
  if ("inputs" in p) return p.inputs;
  if ("numerator" in p) return [p.numerator, p.denominator];
  return [
    p.input,
    ...("compareWith" in p && p.compareWith ? [p.compareWith] : []),
    ...("completeness" in p ? [p.completeness] : []),
  ];
}
export function validateRules(rules: readonly DerivationRule[]): void {
  if (
    new Set(rules.map((r) => r.id)).size !== rules.length ||
    new Set(rules.map((r) => r.output)).size !== rules.length
  )
    throw new Error("duplicate rule id or output");
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (r: DerivationRule) => {
    if (visiting.has(r.id)) throw new Error("rule cycle");
    if (done.has(r.id)) return;
    visiting.add(r.id);
    for (const input of ruleInputs(r)) {
      const dependency = rules.find(
        (candidate) => candidate.output === input || candidate.id === input,
      );
      if (dependency) visit(dependency);
    }
    visiting.delete(r.id);
    done.add(r.id);
  };
  rules.forEach(visit);
}
export type DerivedResult =
  | { ok: true; statement: JsonObject; inputs: readonly ContextItem[] }
  | {
      ok: false;
      reason:
        | "completeness-not-established"
        | "rule-not-accepted"
        | "derivation-not-verified"
        | "deriver-not-accepted"
        | "source-not-authoritative"
        | "purpose-not-permitted";
    };
function monthIndex(value: string): number {
  if (!month.safeParse(value).success) return NaN;
  return Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
}

/** Called only with the runtime's memory. Unadmitted or foreign-task items are never inputs. */
export function evaluateRule(options: {
  rules: readonly DerivationRule[];
  rule: string;
  memory: GateMemory;
  task: string;
  subject: string;
  deriver: string;
  at: string;
  purpose: string;
  assurance?: "recomputed" | "by-source" | "attested";
  recordAt?: string;
  attestedDerivers?: readonly { deriver: string; rule: string; purposes: readonly string[] }[];
  sources?: Readonly<Record<string, string>>;
  reliance?: import("../gates/common.js").RelianceProfile;
}): DerivedResult {
  const { rules, memory, task, subject, deriver, at, purpose } = options;
  validateRules(rules);
  const seen = new Set<string>();
  const evaluate = (id: string, depth: number): DerivedResult => {
    const r = rules.find((candidate) => candidate.id === id || candidate.output === id);
    if (!r) return { ok: false, reason: "rule-not-accepted" };
    if (depth > 3 || seen.has(r.id)) return { ok: false, reason: "completeness-not-established" };
    const assurance = options.assurance ?? "recomputed";
    if (!r.assurances.includes(assurance)) return { ok: false, reason: "rule-not-accepted" };
    seen.add(r.id);
    const inputs: ContextItem[] = [];
    const chain: JsonObject[] = [];
    const pool = memory
      .context(task)
      .filter(
        (i) =>
          i.accepted === true &&
          memory.facts.get(i.id)?.digest === i.digest &&
          i.subject === subject &&
          i.statement &&
          (!options.reliance ||
            fitnessOf({ ...i.statement, claimType: i.claimType }, options.reliance, at).verdict ===
              "pass") &&
          (!i.statement.validUntil || Date.parse(String(i.statement.validUntil)) > Date.parse(at)),
      );
    const get = (kind: string): JsonObject[] | undefined => {
      const dependency = rules.find((rule) => rule.output === kind || rule.id === kind);
      if (dependency) {
        const result = evaluate(dependency.id, depth + 1);
        if (!result.ok) return undefined;
        inputs.push(...result.inputs);
        chain.push(result.statement);
        return [result.statement];
      }
      const matching = pool
        .toSorted((a, b) => a.digest.localeCompare(b.digest))
        .filter(
          (i) =>
            i.claimType === kind &&
            r.inputsFrom.map((source) => options.sources?.[source] ?? source).includes(i.source),
        );
      if (!matching.length) return undefined;
      inputs.push(...matching);
      return matching.map((i) => i.statement as JsonObject);
    };
    const scalar = (kind: string): number | boolean | undefined => {
      const values = get(kind);
      if (values?.length !== 1) return undefined;
      const value = values[0]?.value;
      return typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
        ? value
        : undefined;
    };
    let value: number | boolean | undefined;
    const p = r.params;
    if ("inputs" in p) {
      const values = p.inputs.map(scalar);
      if (values.every((v) => typeof v === "boolean"))
        value = r.template === "all-of" ? values.every(Boolean) : values.some(Boolean);
    } else if ("numerator" in p) {
      const n = scalar(p.numerator),
        d = scalar(p.denominator);
      if (typeof n === "number" && typeof d === "number" && d !== 0) value = n / d;
    } else if ("operator" in p) {
      const a = scalar(p.input),
        b = p.value ?? (p.compareWith ? scalar(p.compareWith) : undefined);
      if (typeof a === "number" && typeof b === "number")
        value = { lt: a < b, lte: a <= b, eq: a === b, gte: a >= b, gt: a > b }[p.operator];
    } else {
      const statements = get(p.input);
      const allRows = statements?.flatMap((s) => (Array.isArray(s.monthly) ? s.monthly : [s]));
      const timeOf = (row: unknown) =>
        row && typeof row === "object" && !Array.isArray(row)
          ? String(
              (row as JsonObject).month ??
                (row as JsonObject).date ??
                (row as JsonObject).asOf ??
                "",
            )
          : "";
      const periodTime = (value: string, end = false) =>
        month.safeParse(value).success
          ? Date.UTC(
              Number(value.slice(0, 4)),
              Number(value.slice(5)) - (end ? 0 : 1),
              end ? 0 : 1,
              end ? 23 : 0,
              end ? 59 : 0,
              end ? 59 : 0,
              end ? 999 : 0,
            )
          : Date.parse(value) + (end && /^\d{4}-\d{2}-\d{2}$/.test(value) ? 86_399_999 : 0);
      const rows =
        "months" in p || !p.period
          ? allRows
          : allRows?.filter((row) => {
              const when = periodTime(timeOf(row));
              return when >= periodTime(p.period.start) && when <= periodTime(p.period.end, true);
            });
      const numeric = rows?.map((row) =>
        row && typeof row === "object" && !Array.isArray(row) ? row[p.field] : undefined,
      );
      const currency = new Set(statements?.map((s) => s.currency).filter((c) => c !== undefined));
      const dates = rows?.map((row) =>
        row && typeof row === "object" && !Array.isArray(row) ? String(row.month) : "",
      );
      const ordered = dates?.map(monthIndex).sort((a, b) => a - b);
      const consecutive = ordered?.every(
        (m, i) => Number.isFinite(m) && (i === 0 || m === (ordered[i - 1] as number) + 1),
      );
      const bounded =
        !p.period ||
        (!!ordered?.length &&
          ordered[0] === monthIndex(p.period.start) &&
          ordered.at(-1) === monthIndex(p.period.end));
      let complete = false;
      if ("months" in p) complete = !!consecutive && numeric?.length === p.months && bounded;
      else {
        const completeness = get(p.completeness);
        complete =
          !!completeness?.some(
            (s) =>
              s.complete === true &&
              s.forClaim === p.input &&
              digestOf(s.period) === digestOf(p.period),
          ) &&
          periodTime(p.period.start) <= periodTime(p.period.end, true) &&
          !!allRows?.every((row) => Number.isFinite(periodTime(timeOf(row))));
      }
      if (
        complete &&
        currency.size <= 1 &&
        numeric !== undefined &&
        (r.template === "count" ||
          numeric.every((v) => typeof v === "number" && Number.isFinite(v)))
      ) {
        const ns = numeric as number[];
        if (r.template === "count") value = ns.length;
        else if (r.template === "min") value = Math.min(...ns);
        else if (r.template === "max") value = Math.max(...ns);
        else value = ns.reduce((a, b) => a + b, 0) * ("months" in p ? 12 / p.months : 1);
      }
    }
    seen.delete(r.id);
    if (
      value === undefined ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      !inputs.length
    )
      return { ok: false, reason: "completeness-not-established" };
    const unique = [...new Map(inputs.map((input) => [input.digest, input])).values()].sort(
      (a, b) => a.digest.localeCompare(b.digest),
    );
    if (
      unique.some(
        (i) =>
          !r.inputsFrom.map((source) => options.sources?.[source] ?? source).includes(i.source),
      )
    )
      return { ok: false, reason: "completeness-not-established" };
    if (new Set(unique.map((i) => i.statement?.currency).filter((c) => c !== undefined)).size > 1)
      return { ok: false, reason: "completeness-not-established" };
    if (unique.some((i) => !i.terms && i.admittedPurpose !== purpose))
      return { ok: false, reason: "purpose-not-permitted" };
    if (
      unique.some(
        (i) =>
          evaluateItemTerms(i.terms, { agent: deriver, action: "use", target: i.id, purpose, at })
            .verdict !== "pass",
      )
    )
      return { ok: false, reason: "purpose-not-permitted" };
    if (assurance === "by-source" && unique.some((i) => i.source !== deriver))
      return { ok: false, reason: "deriver-not-accepted" };
    const terms = {
      policy: { id: `urn:derived-terms:${digestOf(unique.map((i) => i.digest)).slice(8)}` },
      inherited: unique.map((i) => ({ target: i.id, terms: i.terms ?? null })),
    };
    const oldest = unique
      .map(
        (i) =>
          i.asOf ??
          (i.statement
            ? claimTime(i.statement as unknown as import("../gates/quality.js").QualityClaim)
            : undefined) ??
          "",
      )
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
    if (!oldest || !Number.isFinite(Date.parse(oldest)))
      return { ok: false, reason: "completeness-not-established" };
    const statement: JsonObject = {
      id: `urn:derived:${digestOf({ rule: r, inputs: unique.map((i) => i.digest), subject, value }).slice(8)}`,
      issuer: deriver,
      ...((): JsonObject => {
        const expiries = unique
          .map((i) => i.statement?.validUntil)
          .filter((v): v is string => typeof v === "string")
          .sort((a, b) => Date.parse(a) - Date.parse(b));
        return expiries[0] ? { validUntil: expiries[0] } : {};
      })(),
      subject,
      claimType: r.output,
      value,
      method: "derived",
      asOf: oldest ?? at,
      terms: terms as unknown as JsonObject,
      derivation: {
        rule: r.id,
        ruleDigest: digestOf(r),
        params: r.params as unknown as JsonObject,
        chain,
        inputs: unique.map((i) => ({
          id: i.id,
          digest: i.digest,
          issuer: i.source,
          claimType: i.claimType,
          method: i.method ?? "unknown",
          asOf:
            i.asOf ??
            (i.statement
              ? claimTime(i.statement as unknown as import("../gates/quality.js").QualityClaim)
              : undefined) ??
            at,
          period: i.statement?.period ?? null,
          currency: i.statement?.currency ?? null,
          validUntil: i.statement?.validUntil ?? null,
        })),
        assurance,
        deriver,
        at: options.recordAt ?? at,
        outputDigest: digestOf(value),
        basis: unique.map((i) => i.method ?? "unknown"),
      },
    };
    return { ok: true, statement, inputs: unique };
  };
  return evaluate(options.rule, 1);
}
export function verifyDerivation(
  statement: JsonObject,
  options: Omit<Parameters<typeof evaluateRule>[0], "rule" | "deriver" | "assurance">,
): DerivedResult {
  const d = statement.derivation;
  if (!d || typeof d !== "object" || Array.isArray(d))
    return { ok: false, reason: "derivation-not-verified" };
  const rule = options.rules.find(
    (r) => r.id === d.rule && digestOf(r) === d.ruleDigest && r.output === statement.claimType,
  );
  if (!rule) return { ok: false, reason: "rule-not-accepted" };
  if (d.assurance !== "recomputed" && d.assurance !== "by-source" && d.assurance !== "attested")
    return { ok: false, reason: "derivation-not-verified" };
  if (
    statement.method !== "derived" ||
    digestOf(d.params) !== digestOf(rule.params) ||
    !Number.isFinite(Date.parse(String(d.at))) ||
    Date.parse(String(d.at)) > Date.parse(options.at) ||
    (typeof statement.value !== "number" && typeof statement.value !== "boolean") ||
    ["threshold", "all-of", "any-of"].includes(rule.template) !==
      (typeof statement.value === "boolean")
  )
    return { ok: false, reason: "derivation-not-verified" };
  if (statement.issuer !== d.deriver)
    return {
      ok: false,
      reason: d.assurance === "by-source" ? "deriver-not-accepted" : "derivation-not-verified",
    };
  if (!rule.assurances.includes(d.assurance)) return { ok: false, reason: "rule-not-accepted" };
  if (
    !Array.isArray(d.inputs) ||
    !d.inputs.length ||
    d.inputs.some(
      (i) =>
        !i ||
        typeof i !== "object" ||
        Array.isArray(i) ||
        typeof i.id !== "string" ||
        typeof i.digest !== "string" ||
        typeof i.issuer !== "string" ||
        typeof i.claimType !== "string" ||
        typeof i.method !== "string" ||
        !Number.isFinite(Date.parse(String(i.asOf))),
    )
  )
    return { ok: false, reason: "derivation-not-verified" };
  const inputRecords = d.inputs as JsonObject[];
  const expiry = inputRecords
    .map((input) => input.validUntil)
    .filter((v): v is string => typeof v === "string")
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  if (statement.validUntil !== expiry) return { ok: false, reason: "derivation-not-verified" };
  const oldest = inputRecords
    .map((input) => String(input.asOf))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  if (
    statement.asOf !== oldest ||
    digestOf(d.basis) !== digestOf(inputRecords.map((input) => input.method))
  )
    return { ok: false, reason: "derivation-not-verified" };
  const leaves = (r: DerivationRule): string[] =>
    ruleInputs(r).flatMap((kind) => {
      const dependency = options.rules.find(
        (candidate) => candidate.id === kind || candidate.output === kind,
      );
      return dependency ? leaves(dependency) : [kind];
    });
  validateRules(options.rules);
  const declared = new Set(leaves(rule));
  if (d.inputs.some((input) => !declared.has(String((input as JsonObject).claimType))))
    return { ok: false, reason: "derivation-not-verified" };
  if (d.assurance === "attested") {
    if (
      !options.attestedDerivers?.some(
        (a) =>
          a.deriver === d.deriver && a.rule === rule.id && a.purposes.includes(options.purpose),
      )
    )
      return { ok: false, reason: "source-not-authoritative" };
    return digestOf(statement.value) === d.outputDigest
      ? { ok: true, statement, inputs: [] }
      : { ok: false, reason: "derivation-not-verified" };
  }
  if (d.assurance === "by-source") {
    if (
      statement.issuer !== d.deriver ||
      !rule.inputsFrom
        .map((source) => options.sources?.[source] ?? source)
        .includes(String(statement.issuer)) ||
      !Array.isArray(d.inputs) ||
      !d.inputs.length ||
      d.inputs.some(
        (i) => !i || typeof i !== "object" || Array.isArray(i) || i.issuer !== statement.issuer,
      )
    )
      return { ok: false, reason: "deriver-not-accepted" };
    return digestOf(statement.value) === d.outputDigest
      ? { ok: true, statement, inputs: [] }
      : { ok: false, reason: "derivation-not-verified" };
  }
  const result = evaluateRule({
    ...options,
    rule: rule.id,
    deriver: String(statement.issuer),
    assurance: "recomputed",
    recordAt: String(d.at),
  });
  if (!result.ok) return result;
  const expected = result.statement.derivation as JsonObject;
  return digestOf(statement.value) === d.outputDigest &&
    d.outputDigest === expected.outputDigest &&
    digestOf(d.inputs) === digestOf(expected.inputs) &&
    digestOf(d.chain) === digestOf(expected.chain) &&
    digestOf(statement.terms) === digestOf(result.statement.terms) &&
    statement.asOf === result.statement.asOf
    ? { ok: true, statement, inputs: result.inputs }
    : { ok: false, reason: "derivation-not-verified" };
}
