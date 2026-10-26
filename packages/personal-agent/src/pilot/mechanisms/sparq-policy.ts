/**
 * SPARQ policy engine: the pilot's ODRL policies decided by the Rust `sparq-policy`
 * evaluator (`decide`, three-valued) through its opt-in `sparq-policy-decide` binary.
 *
 * - Local only: one child process per decision (`spawnSync`, no shell, empty environment),
 *   bounded input (the adapter refuses > 256 KiB), bounded output (64 KiB) and a timeout.
 * - Typed context: action/target plus `odrl:dateTime` (xsd:dateTime), `odrl:purpose` and
 *   `odrl:recipient` (IRIs). No party is sent: the pilot binds the policy's assignee in the
 *   composition layer (rules and policies not assigned to this subject are definite
 *   non-matches and are not sent), so SPARQ never defaults `odrl:recipient` to the subject
 *   — a missing recipient stays missing context.
 * - Fail closed, no fallback: a missing binary, timeout, non-zero exit, oversized or
 *   unparsable output, or an unexpected protocol/evaluator identity is `indeterminate`.
 *   This engine never consults `@jeswr/solid-odrl`.
 * - Identity: every verdict carries the evaluator crate/version/function the binary reports.
 */
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import type { OdrlPolicy, OdrlRule } from "@jeswr/solid-odrl";
import { DataFactory, type Quad, type Term, Writer } from "n3";
import { derivedUrn } from "../core/canonical.js";
import type { EngineRequest, EngineVerdict, PolicyEngine } from "./policy-engine.js";

const { namedNode, literal, quad, blankNode } = DataFactory;
const ODRL = "http://www.w3.org/ns/odrl/2/";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XSD = "http://www.w3.org/2001/XMLSchema#";

export const SPARQ_DECIDE_API = "sparq-policy-decide/1";
/** Cap on the adapter's response (a decision document is well under 4 KiB). */
const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

function objectFor(left: string, value: string | number): Term {
  if (typeof value === "number")
    return literal(
      String(value),
      namedNode(`${XSD}${Number.isInteger(value) ? "integer" : "decimal"}`),
    );
  if (left === "dateTime") return literal(value, namedNode(`${XSD}dateTime`));
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? namedNode(value) : literal(value);
}

/**
 * Serialise one pilot-subset ODRL policy (the solid-odrl JSON shape) as Turtle for SPARQ,
 * keeping only rules assigned to `agent` (or unassigned). Rule nodes are the rule ids, so
 * SPARQ's matched rules are the pilot's rule identifiers.
 */
export function odrlPolicyToTurtle(policy: OdrlPolicy, agent: string): string {
  const quads: Quad[] = [];
  const p = namedNode(policy.id);
  quads.push(quad(p, namedNode(`${RDF}type`), namedNode(`${ODRL}Set`)));
  if (policy.conflict)
    quads.push(quad(p, namedNode(`${ODRL}conflict`), namedNode(`${ODRL}${policy.conflict}`)));
  const writer = new Writer({ prefixes: { odrl: ODRL, xsd: XSD } });
  const emit = (rules: readonly OdrlRule[] | undefined, kind: "permission" | "prohibition") => {
    (rules ?? []).forEach((r, i) => {
      const assignee = r.assignee ?? policy.assignee;
      if (assignee && assignee !== agent) return; // definite non-match for this subject
      const node = namedNode(r.id ?? derivedUrn("rule", { policy: policy.id, kind, i }));
      quads.push(quad(p, namedNode(`${ODRL}${kind}`), node));
      quads.push(quad(node, namedNode(`${ODRL}action`), namedNode(`${ODRL}${r.action}`)));
      if (r.target) quads.push(quad(node, namedNode(`${ODRL}target`), namedNode(r.target)));
      for (const c of r.constraints ?? []) {
        const cn = blankNode();
        quads.push(quad(node, namedNode(`${ODRL}constraint`), cn));
        quads.push(quad(cn, namedNode(`${ODRL}leftOperand`), namedNode(`${ODRL}${c.leftOperand}`)));
        quads.push(quad(cn, namedNode(`${ODRL}operator`), namedNode(`${ODRL}${c.operator}`)));
        const values = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
        const objects = values.map((v) => objectFor(c.leftOperand, v as string | number));
        const right = Array.isArray(c.rightOperand)
          ? writer.list(objects as never)
          : (objects[0] as Term);
        quads.push(quad(cn, namedNode(`${ODRL}rightOperand`), right as never));
      }
      // Duties are outside the pilot subset (refused before any engine call).
      if ((r.duties ?? []).length > 0)
        throw new Error("duties are not serialised for the pilot subset");
    });
  };
  emit(policy.permissions, "permission");
  emit(policy.prohibitions, "prohibition");
  writer.addQuads(quads);
  // Without an output stream, N3's Writer calls `end`'s callback synchronously.
  let text: string | undefined;
  let failure: unknown;
  writer.end((e, out) => {
    failure = e;
    text = out;
  });
  if (failure || text === undefined) throw failure ?? new Error("Turtle writer did not complete");
  return text;
}

/** The typed request document for `sparq-policy-decide/1` (no party; see module doc). */
export function sparqRequest(turtle: string, r: EngineRequest): string {
  const context = [
    { leftOperand: `${ODRL}dateTime`, value: { type: "dateTime", value: r.at } },
    ...(r.purpose
      ? [{ leftOperand: `${ODRL}purpose`, value: { type: "iri", value: r.purpose } }]
      : []),
    ...(r.recipient
      ? [{ leftOperand: `${ODRL}recipient`, value: { type: "iri", value: r.recipient } }]
      : []),
  ];
  return JSON.stringify({
    api: SPARQ_DECIDE_API,
    policy: { format: "turtle", text: turtle },
    request: { action: `${ODRL}${r.action}`, target: r.target, context },
  });
}

interface DecideResponse {
  api?: unknown;
  error?: unknown;
  effect?: unknown;
  matchedRules?: unknown;
  reasons?: unknown;
  unresolved?: unknown;
  evaluator?: { crate?: unknown; version?: unknown; function?: unknown };
}

/** Map one adapter response (already bounded) to a verdict; anything unexpected is indeterminate. */
export function verdictFromResponse(
  stdout: string,
  status: number | null,
  binary: string,
): EngineVerdict {
  const fail = (why: string): EngineVerdict => ({
    effect: "indeterminate",
    reason: `policy evaluator unavailable (sparq-policy-decide via ${binary}): ${why}`,
  });
  let doc: DecideResponse;
  try {
    doc = JSON.parse(stdout) as DecideResponse;
  } catch {
    return fail(`unparsable output (exit ${status})`);
  }
  if (!doc || typeof doc !== "object" || doc.api !== SPARQ_DECIDE_API)
    return fail("unexpected protocol");
  if (status !== 0 || typeof doc.error === "string")
    return fail(`refused: ${String(doc.error ?? `exit ${status}`).slice(0, 200)}`);
  const ev = doc.evaluator;
  if (ev?.crate !== "sparq-policy" || ev.function !== "decide" || typeof ev.version !== "string")
    return fail("unexpected evaluator identity");
  const evaluator = `sparq-policy@${ev.version} decide() via ${SPARQ_DECIDE_API}`;
  const matched = Array.isArray(doc.matchedRules)
    ? doc.matchedRules.filter((x): x is string => typeof x === "string")
    : [];
  const reasons = Array.isArray(doc.reasons)
    ? doc.reasons
        .filter((x): x is string => typeof x === "string")
        .join("; ")
        .slice(0, 500)
    : "";
  const unresolved = Array.isArray(doc.unresolved)
    ? (doc.unresolved as Array<{ leftOperand?: unknown; kind?: unknown }>)
        .map((u) => `${String(u.kind)}: ${String(u.leftOperand)}`)
        .join(", ")
    : "";
  switch (doc.effect) {
    case "permit":
      return {
        effect: "permit",
        reason: reasons || "permitted",
        evaluator,
        ...(matched[0] ? { matchedRule: matched[0] } : {}),
      };
    case "deny":
      // A deny naming rules is a prohibition carve-out; an empty one is "no permission".
      return matched.length > 0
        ? { effect: "prohibited", reason: reasons, evaluator }
        : { effect: "not-applicable", reason: reasons, evaluator };
    case "indeterminate":
      return {
        effect: "indeterminate",
        reason: `${unresolved ? `unresolved (${unresolved}); ` : ""}${reasons}`,
        evaluator,
      };
    default:
      return fail("unknown effect");
  }
}

/**
 * An engine backed by a locally built `sparq-policy-decide` binary
 * (`cargo build -p sparq-policy --features json-cli --bin sparq-policy-decide`).
 */
export function sparqPolicyEngine(options: { binary: string; timeoutMs?: number }): PolicyEngine {
  const binary = options.binary;
  const label = basename(binary);
  return {
    id: `sparq-policy decide() via ${SPARQ_DECIDE_API} (${label})`,
    evaluate(policy, request) {
      let turtle: string;
      try {
        turtle = odrlPolicyToTurtle(policy, request.agent);
      } catch (e) {
        return {
          effect: "indeterminate",
          reason: `policy not serialisable for sparq-policy: ${(e as Error).message}`,
        };
      }
      const run = spawnSync(binary, [], {
        input: sparqRequest(turtle, request),
        encoding: "utf8",
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        env: {},
        shell: false,
        windowsHide: true,
      });
      if (run.error)
        return {
          effect: "indeterminate",
          reason: `policy evaluator unavailable (sparq-policy-decide via ${label}): ${run.error.message.slice(0, 200)}`,
        };
      return verdictFromResponse(run.stdout ?? "", run.status, label);
    },
  };
}
