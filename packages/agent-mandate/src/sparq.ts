// AUTHORED-BY Codex GPT-6.1-Sol

import { credentialToRdf } from "@jeswr/solid-vc";
// biome-ignore lint/style/useNodejsImportProtocol: the agent import guard requires bare module names
import { spawnSync } from "child_process";
import { Store } from "n3";
import { encodePolicy } from "./codec.js";
import { supportedPolicy } from "./policy.js";
import { turtle } from "./rdf.js";
import { AGENT, type Effect, ODRL, type PolicyEngine } from "./types.js";

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
          !supportedPolicy(policy) ||
          (policy.obligations ?? []).length > 0 ||
          [...(policy.permissions ?? []), ...(policy.prohibitions ?? [])].some(
            (r) => (r.duties ?? []).length > 0,
          )
        )
          return { effect: "indeterminate" };
        const filter = (rules = policy.permissions) =>
          (rules ?? []).filter(
            (r) =>
              (r.assignee ?? policy.assignee) === undefined ||
              (r.assignee ?? policy.assignee) === request.agent,
          );
        const graph = credentialToRdf({
          id: "urn:example:sparq-envelope",
          issuer: "https://owner.example/#me",
          credentialSubject: {
            [`${AGENT}policy`]: encodePolicy({
              ...policy,
              permissions: filter(policy.permissions),
              prohibitions: filter(policy.prohibitions),
            }),
          },
        });
        const attributes = { ...request.attributes, dateTime: request.at };
        const context = Object.entries(attributes).map(([leftOperand, value]) => ({
          leftOperand: leftOperand.includes(":") ? leftOperand : `${ODRL}${leftOperand}`,
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
          policy: { format: "turtle", text: await turtle(new Store(graph)) },
          request: {
            action: request.action.includes(":") ? request.action : `${ODRL}${request.action}`,
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
        if (result.error || result.status !== 0 || result.stdout.length > 64 * 1024)
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
        const effect: Effect =
          doc.effect === "permit"
            ? "permit"
            : doc.effect === "deny"
              ? doc.matchedRules.length > 0
                ? "prohibited"
                : "not-applicable"
              : "indeterminate";
        return { effect };
      } catch {
        return { effect: "indeterminate" };
      }
    },
  };
}
