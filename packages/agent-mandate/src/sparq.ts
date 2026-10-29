// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { credentialToRdf } from "@jeswr/solid-vc";
import { SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
// biome-ignore lint/style/useNodejsImportProtocol: the agent import guard requires bare module names
import { spawnSync } from "child_process";
import { Store } from "n3";
import { actionIri, encodePolicy, leftOperandIri } from "./codec.js";
import { candidate, knownOperand, supportedPolicy } from "./policy.js";
import { Node, node, turtle } from "./rdf.js";
import {
  AGENT,
  type Constraint,
  type Effect,
  type Intent,
  ODRL,
  type PolicyEngine,
  type Rule,
} from "./types.js";

/** SPARQ membership uses scalar text and a delimiter encoding, with no member escaping. */
function representableSet(c: Constraint, value: unknown): boolean {
  if (c.operator === "isAllOf") return false; // Unsupported by the backend.
  if (c.operator !== "isAnyOf" && c.operator !== "isNoneOf") return true;
  if (
    c.leftOperand === "dateTime" ||
    (c.datatype !== undefined && c.datatype !== "http://www.w3.org/2001/XMLSchema#string")
  )
    return false;
  const rights: unknown[] = Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  return [value, ...rights].every(
    (member) =>
      typeof member === "string" &&
      member.length > 0 &&
      !/[\s\u0085|,]/u.test(member) &&
      !Number.isFinite(Number(member)),
  );
}

/** SPARQ reads operand types from RDF literals, not the signed codec's agent:datatype. */
function sparqOperands(store: Store): Store {
  const policy = node(store, "urn:example:sparq-envelope")
    .one("https://www.w3.org/2018/credentials#credentialSubject")
    .one(`${AGENT}policy`);
  for (const rule of [
    ...policy.values(`${ODRL}permission`),
    ...policy.values(`${ODRL}prohibition`),
  ]) {
    for (const constraint of rule.values(`${ODRL}constraint`)) {
      const datatype = constraint.values(`${AGENT}datatype`).length
        ? constraint.iri(`${AGENT}datatype`)
        : constraint.iri(`${ODRL}leftOperand`) === leftOperandIri("dateTime")
          ? "http://www.w3.org/2001/XMLSchema#dateTime"
          : undefined;
      if (datatype === undefined) continue;
      const rights = SetFrom.subjectPredicate(
        constraint,
        `${ODRL}rightOperand`,
        TermAs.instance(Node),
        TermFrom.instance,
      );
      const values = [...rights];
      rights.clear();
      for (const value of values)
        rights.add(
          new Node(
            constraint.factory.literal(value.value, constraint.factory.namedNode(datatype)),
            store,
            constraint.factory,
          ),
        );
    }
  }
  return store;
}

/** The pilot's local binary protocol, selected explicitly without fallback. */
export const SPARQ_DECIDE_API = "sparq-policy-decide/1";
/** Testable process result. */
export interface ProcessResult {
  readonly stdout: string;
  readonly status: number | null;
  readonly error?: unknown;
}
/** Process invocation; no shell, no inherited environment, bounded input/output/time. */
export interface ProcessOptions {
  input: string;
  encoding: "utf8";
  timeout: number;
  maxBuffer: number;
  env: Record<string, string>;
  shell: false;
}
/** Optional local binary adapter. The root/browser entry point never imports this module. */
export function sparqPolicyEngine(
  options: {
    binary?: string;
    timeoutMs?: number;
    run?: (binary: string, options: ProcessOptions) => ProcessResult;
  } = {},
): PolicyEngine {
  return {
    id: "sparq-policy",
    async evaluate(policy, request) {
      try {
        if (
          !options.binary ||
          (options.timeoutMs !== undefined &&
            (!Number.isFinite(options.timeoutMs) ||
              options.timeoutMs <= 0 ||
              options.timeoutMs > 30000)) ||
          !supportedPolicy(policy) ||
          (policy.obligations ?? []).length > 0 ||
          [...(policy.permissions ?? []), ...(policy.prohibitions ?? [])].some(
            (r) => (r.duties ?? []).length > 0,
          )
        )
          return { effect: "indeterminate" };
        const attributes: NonNullable<Intent["attributes"]> = {
          ...request.attributes,
          dateTime: request.at,
        };
        const comparable = (r: Rule) =>
          (r.constraints ?? []).every(
            (c) =>
              knownOperand(c, attributes[c.leftOperand]) &&
              representableSet(c, attributes[c.leftOperand]),
          );
        const missing = [...(policy.permissions ?? []), ...(policy.prohibitions ?? [])]
          .filter((r) => candidate(r, policy, request))
          .some((r) => !comparable(r));
        // Only a definite prohibition may decide a policy with unresolved candidates.
        if (
          missing &&
          !(policy.prohibitions ?? []).some((r) => candidate(r, policy, request) && comparable(r))
        )
          return { effect: "indeterminate" };
        // The backend's use umbrella is broader than the shared suite profile.
        // Select candidates here, then use one exact action for rules and request.
        const lower = (rules: readonly Rule[] = []) =>
          rules
            .filter((r) => candidate(r, policy, request) && comparable(r))
            .map(({ assignee: _assignee, assigner: _assigner, ...rule }) => ({
              ...rule,
              action: "use",
            }));
        const graph = credentialToRdf({
          id: "urn:example:sparq-envelope",
          issuer: "https://owner.example/#me",
          credentialSubject: {
            [`${AGENT}policy`]: encodePolicy({
              ...policy,
              assigner: undefined,
              assignee: undefined,
              permissions: lower(policy.permissions),
              prohibitions: lower(policy.prohibitions),
            }),
          },
        });
        const context = Object.entries(attributes).map(([leftOperand, value]) => ({
          leftOperand: leftOperandIri(leftOperand),
          value: {
            type:
              leftOperand === "dateTime"
                ? "dateTime"
                : typeof value === "number"
                  ? "decimal"
                  : typeof value === "string" && value.includes(":")
                    ? "iri"
                    : "string",
            value,
          },
        }));
        const input = JSON.stringify({
          api: SPARQ_DECIDE_API,
          policy: { format: "turtle", text: await turtle(sparqOperands(new Store(graph))) },
          request: {
            action: actionIri("use"),
            target: request.target,
            context,
          },
        });
        if (new TextEncoder().encode(input).length > 256 * 1024) return { effect: "indeterminate" };
        const run =
          options.run ??
          ((binary, args) => {
            const result = spawnSync(binary, [], args);
            return { ...result, stdout: result.stdout };
          });
        const result = run(options.binary, {
          input,
          encoding: "utf8",
          timeout: options.timeoutMs ?? 5000,
          maxBuffer: 64 * 1024,
          env: {},
          shell: false,
        });
        if (
          result.error ||
          result.status !== 0 ||
          new TextEncoder().encode(result.stdout).length > 64 * 1024
        )
          return { effect: "indeterminate" };
        const doc = JSON.parse(result.stdout);
        if (
          doc?.api !== SPARQ_DECIDE_API ||
          doc.error !== undefined ||
          doc.evaluator?.crate !== "sparq-policy" ||
          doc.evaluator.function !== "decide" ||
          typeof doc.evaluator.version !== "string" ||
          !Array.isArray(doc.matchedRules) ||
          !doc.matchedRules.every((r: unknown) => typeof r === "string")
        )
          return { effect: "indeterminate" };
        if (doc.effect === "permit" && Array.isArray(doc.unresolved) && doc.unresolved.length > 0)
          return { effect: "indeterminate" };
        const effect: Effect =
          doc.effect === "permit"
            ? "permit"
            : doc.effect === "deny"
              ? doc.matchedRules.length > 0
                ? "prohibited"
                : "not-applicable"
              : "indeterminate";
        return { effect: missing && effect !== "prohibited" ? "indeterminate" : effect };
      } catch {
        return { effect: "indeterminate" };
      }
    },
  };
}
