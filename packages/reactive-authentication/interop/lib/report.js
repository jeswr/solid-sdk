// Result model of an interoperability run. Only safe metadata is kept: target and scenario ids, statuses,
// redacted reasons, durations, check counts, flows and versions — never tokens, codes, cookies or accounts.
import { redact } from "./redact.js";

export const PASS = "PASS";
export const FAIL = "FAIL";
/** Not run: the target is not configured here (missing credentials, stack or runtime). Never counts as coverage. */
export const UNTESTED = "UNTESTED";
/** Not applicable: the manifest documents that the target lacks the capability (with a reason). */
export const UNSUPPORTED = "UNSUPPORTED";

export const reportSchema = "reactive-authentication-interop-report/v1";

export class Report {
  #targets = new Map();
  #errors = [];

  constructor(meta) {
    this.meta = meta;
    this.startedAt = new Date().toISOString();
  }

  /** Declares a target (so that a target with no recorded scenario still appears, as untested). */
  target(target, extra = {}) {
    if (!this.#targets.has(target.id)) {
      this.#targets.set(target.id, {
        id: target.id,
        name: target.name,
        adapter: target.adapter,
        category: target.category,
        software: target.software,
        scenarios: [],
        ...(target.knownIncompatible === undefined
          ? {}
          : { knownIncompatible: Object.keys(target.knownIncompatible) }),
        ...extra,
      });
    }
    return this.#targets.get(target.id);
  }

  /** A run-level failure (setup, adapter or teardown); always fails the verdict. Pass redacted text only. */
  error(message) {
    this.#errors.push(redact(message).slice(0, 600));
  }

  get errors() {
    return [...this.#errors];
  }

  /** Records every scenario of `targetId` not yet recorded, e.g. after an aborted setup or adapter. */
  fill(targetId, scenarioIds, status, reason) {
    const entry = this.#targets.get(targetId);
    for (const id of scenarioIds) {
      if (!entry.scenarios.some((s) => s.id === id)) this.record(targetId, { id, status, reason });
    }
  }

  /** Adds safe, non-secret facts about a target (server versions, runtime, flow). */
  annotate(targetId, facts) {
    const entry = this.#targets.get(targetId);
    entry.facts = { ...entry.facts, ...sanitize(facts) };
  }

  record(targetId, result) {
    const { id, status, reason, durationMs, checks, flow } = result;
    if (![PASS, FAIL, UNTESTED, UNSUPPORTED].includes(status))
      throw new TypeError(`Unknown status ${status}`);
    if (status === PASS && !(checks > 0))
      throw new TypeError(`${targetId}/${id}: a PASS needs at least one check`);
    if (status !== PASS && !reason)
      throw new TypeError(`${targetId}/${id}: ${status} needs a reason`);
    const entry = this.#targets.get(targetId);
    if (entry === undefined) throw new TypeError(`Undeclared target ${targetId}`);
    if (entry.scenarios.some((s) => s.id === id))
      throw new TypeError(`${targetId}/${id} recorded twice`);
    entry.scenarios.push({
      id,
      status,
      ...(reason === undefined ? {} : { reason: redact(reason).slice(0, 600) }),
      ...(durationMs === undefined ? {} : { durationMs: Math.round(durationMs) }),
      ...(checks === undefined ? {} : { checks }),
      ...(flow === undefined ? {} : { flow: sanitize(flow) }),
    });
  }

  get targets() {
    return [...this.#targets.values()];
  }

  totals() {
    const totals = { [PASS]: 0, [FAIL]: 0, [UNTESTED]: 0, [UNSUPPORTED]: 0 };
    for (const t of this.targets) for (const s of t.scenarios) totals[s.status]++;
    return totals;
  }

  /**
   * Whether the run succeeded:
   * - any FAIL fails the run;
   * - a required target must have run every scenario it supports (no UNTESTED) and pass at least one;
   * - with `strict`, every selected target is treated as required;
   * - with `verifyKnownIncompatible`, every declared known incompatibility of a selected target must have been
   *   reproduced in this run (so a declaration cannot silently turn into a skip).
   */
  verdict({ required = [], strict = false, verifyKnownIncompatible = false } = {}) {
    const problems = this.#errors.map((e) => `run error: ${e}`);
    if (this.#targets.size === 0) problems.push("no targets were selected");
    for (const t of this.targets) {
      for (const s of t.scenarios) if (s.status === FAIL) problems.push(`${t.id}/${s.id} failed`);
    }
    const mustCover = strict ? this.targets.map((t) => t.id) : required;
    for (const id of mustCover) {
      const t = this.#targets.get(id);
      if (t === undefined) {
        problems.push(`${id} is required but was not selected or does not exist`);
        continue;
      }
      const untested = t.scenarios.filter((s) => s.status === UNTESTED);
      if (untested.length > 0)
        problems.push(
          `${id} is required but ${untested.length} scenario(s) were untested: ${untested[0].reason}`,
        );
      if (t.scenarios.length === 0) problems.push(`${id} is required but no scenario was recorded`);
      else if (!t.scenarios.some((s) => s.status === PASS))
        problems.push(`${id} is required but has no passing scenario`);
    }
    // Nothing passed: the run verified no compatibility, whatever else it recorded. The only exception is an
    // explicit check of known incompatibilities that reproduced (evidence of a documented incompatibility).
    const verified = this.targets
      .flatMap((t) => t.scenarios)
      .filter(
        (s) =>
          s.status === UNSUPPORTED &&
          s.reason.startsWith("known incompatibility, verified this run"),
      ).length;
    if (this.totals()[PASS] === 0 && !(verifyKnownIncompatible && verified > 0))
      problems.push("no scenario passed: this run verified no compatibility");
    if (verifyKnownIncompatible) {
      for (const t of this.targets) {
        for (const id of t.knownIncompatible ?? []) {
          const s = t.scenarios.find((s) => s.id === id);
          if (
            !(
              s?.status === UNSUPPORTED &&
              s.reason.startsWith("known incompatibility, verified this run")
            )
          ) {
            problems.push(
              `${t.id}/${id}: the declared known incompatibility was not reproduced (${s?.status ?? "not run"})`,
            );
          }
        }
      }
    }
    return { ok: problems.length === 0, problems };
  }

  toJSON(options) {
    return {
      schema: reportSchema,
      ...sanitize(this.meta),
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      totals: this.totals(),
      errors: this.errors,
      verdict: this.verdict(options),
      targets: this.targets.map((t) => ({ ...t, status: targetStatus(t) })),
    };
  }

  toMarkdown(options) {
    const json = this.toJSON(options);
    const lines = [
      `# Interoperability report`,
      ``,
      `- Library: ${json.library?.name}@${json.library?.version}${json.library?.commit ? ` (${json.library.commit})` : ""}`,
      `- Runtime: Node.js ${json.runtime?.node} on ${json.runtime?.platform}/${json.runtime?.arch}${json.runtime?.browsers ? `; browsers ${json.runtime.browsers}` : ""}`,
      `- Selection: ${json.selection?.suite ?? "custom"}${json.selection?.strict ? " (strict)" : ""}; required: ${json.selection?.required?.join(", ") || "none"}`,
      `- Totals: ${Object.entries(json.totals)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ")}`,
      `- Verdict: ${json.verdict.ok ? "OK" : `FAILED — ${json.verdict.problems.join("; ")}`}`,
      ``,
      `| Target | Status | Scenario | Result | Notes |`,
      `| --- | --- | --- | --- | --- |`,
    ];
    for (const t of json.targets) {
      if (t.scenarios.length === 0)
        lines.push(`| ${t.id} | ${t.status} | — | — | ${escapeCell(t.reason ?? "")} |`);
      for (const s of t.scenarios)
        lines.push(
          `| ${t.id} | ${t.status} | ${s.id} | ${s.status} | ${escapeCell(s.reason ?? (s.checks ? `${s.checks} checks` : ""))} |`,
        );
    }
    return `${lines.join("\n")}\n`;
  }
}

/** A target is covered only when everything it supports passed; untested and failed are never folded into it. */
export function targetStatus(t) {
  const statuses = new Set(t.scenarios.map((s) => s.status));
  if (statuses.has(FAIL)) return "failed";
  if (t.scenarios.length === 0 || (statuses.has(UNTESTED) && !statuses.has(PASS)))
    return "untested";
  if (statuses.has(UNTESTED)) return "partial";
  if (!statuses.has(PASS)) return "unsupported";
  return "covered";
}

function escapeCell(text) {
  return String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** Deep copy of plain metadata with every string redacted. */
function sanitize(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)]));
  return value;
}
