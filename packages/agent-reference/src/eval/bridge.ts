// AUTHORED-BY Codex GPT-6
/** E1 tool-action adapter. Trusted harness supplies labels; the core supplies only the call. */

import type { OdrlRule } from "@jeswr/solid-odrl";
import { appendFileSync } from "fs";
import { createInterface } from "readline";
import type { Readable, Writable } from "stream";
import { pathToFileURL } from "url";
import { digestOf } from "../core/canonical.js";
import type { ActionIntent, JsonObject } from "../core/types.js";
import { GateMemory } from "../gates/common.js";
import { OutboundGate } from "../gates/outbound.js";
import {
  actionDigest,
  evaluateIntent,
  type LoadedMandate,
  mandateSchema,
  type OwnerMandate,
} from "../mechanisms/mandate.js";
import { BASELINE } from "../suites/baseline.js";
import type { OutboundCheck, OutboundOutcome, TraceEventInput, Verdict } from "../trace/types.js";

export interface ToolDefinition {
  class: "read" | "change-own" | "change-own-sensitive" | "send";
  output: "own-record" | "content";
  recipient_args: string[];
  amount_args: string[];
  content_args: string[];
}

export interface Grant {
  tool: string;
  recipients: string[];
  amounts: number[];
}

export interface EvalMandate {
  kind: "fitted" | "standing";
  tools: Record<string, ToolDefinition>;
  grants?: Grant[];
  rules?: { id: number; [key: string]: unknown }[];
}

export interface BridgeRequest {
  mandate: EvalMandate;
  call: { tool: string; args: JsonObject };
  /** Resolved effects, including defaults from the environment; never core assertions. */
  recipients: { value: string; known: boolean; inInstruction: boolean }[];
  amounts: number[];
  freeText: boolean;
  context: { id: string; label: "own-record" | "content"; value: unknown }[];
  maxPayment: number;
}

export interface EvalCheck {
  check: OutboundCheck;
  gate: "reference" | "adapter";
  verdict: Verdict;
  reason: string;
  rule?: string;
}

export interface BridgeDecision {
  outcome: OutboundOutcome;
  reason: string;
  decidingCheck?: OutboundCheck;
  actionDigest: string;
  checks: EvalCheck[];
  /** Unmodified verdicts for audit; adapter replacements are never called reference. */
  referenceChecks: EvalCheck[];
  ownerMandate: OwnerMandate;
}

const ACTOR = "urn:e1:agent";
const OWNER = "urn:e1:principal";
const AT = "2026-11-13T00:00:00Z";
const target = (tool: string) => `urn:e1:tool:${encodeURIComponent(tool)}`;
const recipientSet = (recipients: string[]) =>
  `urn:e1:recipients:${digestOf([...new Set(recipients.map((r) => r.toLowerCase()))].sort()).slice(7)}`;

/** Compile only expressible scopes to the real mandate model. Amounts stay adapter checks. */
export function compileMandate(data: EvalMandate): OwnerMandate {
  const autonomous: OdrlRule[] = [];
  const withApproval: OdrlRule[] = [];
  if (data.kind === "fitted") {
    for (const [index, grant] of (data.grants ?? []).entries()) {
      autonomous.push({
        id: `urn:e1:fitted:${index}`,
        type: "permission",
        action: "use",
        target: target(grant.tool),
        constraints: [
          {
            leftOperand: "recipient",
            operator: "eq",
            rightOperand: recipientSet(grant.recipients),
          },
        ],
      });
    }
  } else {
    for (const [tool, definition] of Object.entries(data.tools)) {
      const rule = data.rules?.find((r) => r.class === definition.class);
      const outcome = rule?.outcome ?? (rule?.id === 4 ? "go" : "stop");
      if (outcome !== "go" && outcome !== "ask-principal") continue;
      (outcome === "go" ? autonomous : withApproval).push({
        id: `urn:e1:standing:${rule?.id}:${tool}`,
        type: "permission",
        action: "use",
        target: target(tool),
      });
    }
  }
  const mandate: OwnerMandate = {
    type: "OwnerMandate",
    id: `urn:e1:mandate:${data.kind}`,
    version: 1,
    issuer: OWNER,
    subject: ACTOR,
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
    autonomous: {
      id: "urn:e1:autonomous",
      type: "Set",
      conflict: "prohibit",
      permissions: autonomous,
    },
    withApproval: {
      id: "urn:e1:approval",
      type: "Set",
      conflict: "prohibit",
      permissions: withApproval,
    },
  };
  mandateSchema.parse(mandate);
  return mandate;
}

export function decide(request: BridgeRequest): BridgeDecision {
  const mandate = compileMandate(request.mandate);
  const definition = request.mandate.tools[request.call.tool];
  const intent: ActionIntent = {
    operation: target(request.call.tool),
    action: "use",
    target: target(request.call.tool),
    recipient: recipientSet(request.recipients.map((r) => r.value)),
    parameters: {
      call: request.call as unknown as JsonObject,
      resolvedRecipients: request.recipients.map((r) => r.value),
      resolvedAmounts: request.amounts,
    },
    purpose: "urn:e1:task",
    conversation: "urn:e1:task",
  };
  const loaded: LoadedMandate = {
    mandate,
    digest: digestOf(mandate),
    verification: {
      type: "verification",
      protectedObject: digestOf(mandate),
      property: "none-unsigned",
      mechanism: "trusted local data file (not a signature test)",
      verifier: ACTOR,
      at: AT,
      outcome: "not-applicable",
      limitations: ["E1 trusted fixture; mandate signing and owner authentication not exercised"],
    },
  };
  const events: TraceEventInput[] = [];
  const gate = new OutboundGate({
    identity: { actor: ACTOR, party: OWNER },
    now: () => AT,
    mandate: () => mandate,
    gate: { configuration: BASELINE, sink: { agent: ACTOR, emit: (e) => events.push(e) } },
    memory: new GateMemory(),
    isReplyTo: () => false,
    offerTerms: () => undefined,
  });
  const evaluated = evaluateIntent({ loaded, intent, decider: ACTOR, at: AT });
  const release = gate.release(intent, evaluated);
  const referenceChecks: EvalCheck[] = release.verdicts.map((v) => ({
    check: v.check as OutboundCheck,
    gate: "reference",
    verdict: v.verdict,
    reason: v.reason ?? "indeterminate-policy",
    ...(v.rule ? { rule: v.rule.id } : {}),
  }));
  const checks = referenceChecks.map((v) => ({ ...v }));
  const replace = (check: OutboundCheck, verdict: Verdict, reason: string, rule: string) => {
    const index = checks.findIndex((v) => v.check === check);
    const value: EvalCheck = { check, gate: "adapter", verdict, reason, rule };
    if (index < 0) checks.push(value);
    else checks[index] = value;
  };
  if (!definition) replace("mandate", "fail", "not-authorised", "standing:7/closed-tool-catalog");
  if (release.outcome !== "stop" && definition) {
    if (request.mandate.kind === "fitted") {
      const scope = recipientSet(request.recipients.map((r) => r.value));
      const amountMatch = request.mandate.grants?.some(
        (g) =>
          g.tool === request.call.tool &&
          recipientSet(g.recipients) === scope &&
          JSON.stringify(g.amounts) === JSON.stringify(request.amounts),
      );
      if (!amountMatch) replace("mandate", "fail", "not-authorised", "fitted:exact-amount-scope");
      // Fitted grants authorize disclosure to their exact recipient set, including free text.
      if (definition.class === "send") {
        replace("recipient", "pass", "recipient-established", "fitted:recipient-scope");
        replace("disclosure", "pass", "minimal-disclosure", "fitted:disclosure-scope");
        replace("data-terms", "pass", "terms-allow", "fitted:disclosure-scope");
      }
    } else if (definition.class === "send") {
      const unknown = request.recipients.some((r) => !r.known);
      replace(
        "recipient",
        unknown ? "ask-principal" : "pass",
        unknown
          ? String(request.mandate.rules?.find((r) => r.id === 4)?.reason)
          : "recipient-established",
        "standing:4",
      );
      const restricted = request.context.some((item) => item.label === "own-record");
      const clear = !restricted || request.recipients.every((r) => r.inInstruction);
      const unsafe = request.freeText && !clear;
      replace(
        "disclosure",
        unsafe ? "ask-principal" : "pass",
        unsafe ? "context-not-clear" : "minimal-disclosure",
        "standing:6/UNS-9",
      );
      replace(
        "data-terms",
        unsafe ? "ask-principal" : "pass",
        unsafe ? "context-not-clear" : "terms-allow",
        "standing:6/UNS-9",
      );
      if (request.amounts.some((amount) => amount > request.maxPayment)) {
        replace("limits-approval", "ask-principal", "limit-exceeded", "standing:5");
      }
    }
  }
  const order: OutboundCheck[] = [
    "mandate",
    "recipient",
    "disclosure",
    "data-terms",
    "limits-approval",
    "evidence",
  ];
  checks.sort((a, b) => order.indexOf(a.check) - order.indexOf(b.check));
  const deciding =
    checks.find((v) => v.verdict === "fail" || v.verdict === "indeterminate") ??
    checks.find((v) => v.verdict === "ask-principal");
  const outcome = deciding
    ? deciding.verdict === "ask-principal"
      ? "ask-principal"
      : "stop"
    : "go";
  if (outcome === "go") {
    gate.sealEffect(intent);
    const evidence = events.find((e) => e.check === "evidence");
    if (evidence?.verdict) {
      const v: EvalCheck = {
        check: "evidence",
        gate: "reference",
        verdict: evidence.verdict,
        reason: evidence.reason ?? "evidence-complete",
      };
      checks.push({ ...v, gate: "adapter", rule: "CORE-OUT-9:durable-journal" });
      referenceChecks.push(v);
    }
  }
  return {
    outcome,
    reason: deciding?.reason ?? "within-mandate",
    ...(deciding ? { decidingCheck: deciding.check } : {}),
    actionDigest: actionDigest(intent),
    checks,
    referenceChecks,
    ownerMandate: mandate,
  };
}

/** JSONL server. The journal append must succeed before Python can execute a call. */
export async function serve(
  journal: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    let result: BridgeDecision | { error: string; outcome: "stop"; reason: string };
    try {
      result = decide(JSON.parse(line) as BridgeRequest);
      try {
        appendFileSync(journal, `${JSON.stringify(result)}\n`, { flush: true });
      } catch {
        result = {
          ...result,
          outcome: "stop",
          reason: "record-unavailable",
          decidingCheck: "evidence",
          checks: [
            ...result.checks.filter((c) => c.check !== "evidence"),
            {
              check: "evidence",
              gate: "adapter",
              verdict: "fail",
              reason: "record-unavailable",
              rule: "CORE-OUT-9",
            },
          ],
        };
      }
    } catch (error) {
      result = { error: String(error), outcome: "stop", reason: "malformed" };
    }
    output.write(`${JSON.stringify(result)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const journal = process.argv[2];
  if (!journal) throw new Error("Usage: bridge.js <write-ahead-journal.jsonl>");
  await serve(journal);
}
