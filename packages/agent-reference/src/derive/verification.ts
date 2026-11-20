// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.2 Sol
/** Source-phase checks for opaque proofs and joint evidence. No prover-supplied policy. */
import { digestOf } from "../core/canonical.js";
import type { JsonObject } from "../core/types.js";
import type { GateContext } from "../gates/common.js";
import { queryVerificationMethod } from "../model/sparq-query.js";
import { queryPolicyOptions, SPARQ_ZK_QUERY } from "./adapters/sparq-zk-query.js";
import {
  resultPublicKey,
  resultSupportsSubject,
  SPARQ_ZK_RESULT,
} from "./adapters/sparq-zk-result.js";
import { resultRequestPolicy } from "./result-trust.js";
import { type DerivationRule, isBooleanRule, queryFor, ruleInputs } from "./rules.js";
import type { FixedJointSession, JointOutcome, ProofBinds } from "./verifiers.js";

// Claims are held across every asynchronous verifier and source check.
const inFlight = new WeakSet<object>();

/** A non-compute-only slot may also commit zero. This count is an upper bound. */
export function contributorUpperBound(
  fixed: FixedJointSession,
  verified?: readonly string[],
): number {
  const parties = verified && new Set(verified);
  const roster = (fixed.session.roster ?? []) as JsonObject[];
  return new Set(
    roster.flatMap(({ party, computeOnly }) =>
      typeof party === "string" && computeOnly !== true && (!parties || parties.has(party))
        ? [party]
        : [],
    ),
  ).size;
}

/** Bare outcome messages (including refusals) also verify before handler/core admission. */
export async function verifyJointMessageOutcome(
  gate: GateContext,
  value: JsonObject,
  purpose?: string,
): Promise<{ ok: boolean; reason?: string; detail?: string }> {
  const fixed = gate.fixedJointSessions?.[String(value.sessionId)];
  const protocol = fixed && gate.jointProtocols?.get(fixed.method);
  if (!fixed || !protocol) return { ok: false, reason: "source-not-accepted" };
  const accepted = gate.acceptedJoint?.find(
    (entry) =>
      entry.method === fixed.method &&
      entry.rule === fixed.rule &&
      entry.purposes.includes(fixed.purpose),
  );
  if (!accepted || (purpose !== undefined && purpose !== fixed.purpose))
    return { ok: false, reason: "method-not-accepted" };
  if (fixed.outcomeConsumed || inFlight.has(fixed)) return { ok: false, reason: "replay-conflict" };
  inFlight.add(fixed);
  try {
    const checked = await protocol.verifyOutcome({
      session: fixed.session,
      outcome: value.outcome as unknown as JointOutcome,
      contributions: value.contributions as JsonObject[],
    });
    if (!checked.ok)
      return {
        ok: false,
        reason: "derivation-not-verified",
        detail: `${checked.reason}; check: ${checked.check ?? "unknown"}; roster index: ${checked.index ?? "unknown"}; party at fault: ${checked.partyAtFault ?? "unknown"}`,
      };
    const outcome = value.outcome as JsonObject;
    if (
      !["below-minimum-group", "too-few-contributors"].includes(String(outcome.type)) &&
      contributorUpperBound(fixed, checked.contributors) < accepted.minimumContributors
    )
      return {
        ok: false,
        reason: "derivation-not-verified",
        detail: "The upper bound on contributors with inputs is below the receiver's minimum.",
      };
    fixed.outcomeConsumed = true;
    gate.saveDerivationState?.();
    return { ok: true };
  } catch {
    return {
      ok: false,
      reason: "derivation-not-verified",
      detail: "Outcome verifier refused the message.",
    };
  } finally {
    inFlight.delete(fixed);
  }
}

export interface DerivationStep {
  clause: string;
  ok: boolean;
  reason: string;
  text: string;
}
export function opaqueDerivation(statement: JsonObject): boolean {
  const d = statement.derivation as JsonObject | undefined;
  return !!d && (!!d.proof || d.assurance === "joint" || d.assurance === "proved");
}
export function proofPolicy(
  gate: GateContext,
  rule: DerivationRule,
  subject: string,
  accepted: (issuer: string, kind: string) => boolean,
): JsonObject {
  const kinds = ruleInputs(rule);
  const sources = rule.inputsFrom.map((source) => gate.sourceAliases?.[source] ?? source);
  if (
    gate.proofSystems?.get(SPARQ_ZK_QUERY.method)?.kind === "real" &&
    gate.acceptedProofs?.some(
      (entry) => entry.rule === rule.id && entry.method === SPARQ_ZK_QUERY.method,
    )
  ) {
    const dataset = gate.queryProofPolicies?.find(
      (d) => d.rule === rule.id && d.subject === subject,
    );
    if (!dataset) throw new Error("No verifier-pinned query dataset for the requested subject");
    const members = dataset.coverage.flatMap(({ issuer, key, claimTypes }) => {
      const parsed = resultPublicKey.safeParse(key);
      return parsed.success &&
        sources.includes(issuer) &&
        kinds.some((kind) => claimTypes.includes(kind) && accepted(issuer, kind))
        ? [{ issuer, verificationMethod: queryVerificationMethod(issuer), ...parsed.data }]
        : [];
    });
    if (!members.length) throw new Error("No trusted query issuer for the rule");
    return {
      ...queryPolicyOptions.parse(dataset.policy),
      trustedIssuers: [...new Set(members.map(({ publicKey }) => publicKey))],
      trustMembers: [...new Map(members.map((member) => [digestOf(member), member])).values()],
    };
  }
  if (
    gate.proofSystems?.get(SPARQ_ZK_RESULT.method)?.kind === "real" &&
    gate.acceptedProofs?.some(
      (entry) => entry.rule === rule.id && entry.method === SPARQ_ZK_RESULT.method,
    )
  )
    return resultRequestPolicy(gate, sources, (issuer, claimTypes) =>
      kinds.every((kind) => claimTypes.includes(kind) && accepted(issuer, kind)),
    );
  return {
    issuerKeys: (gate.proofIssuerKeys ?? [])
      .filter((k) => kinds.some((kind) => k.claimTypes.includes(kind) && accepted(k.issuer, kind)))
      .map((k) => k.key),
    claims: Object.fromEntries(
      kinds.map((kind) => [
        kind,
        (gate.proofIssuerKeys ?? [])
          .filter((k) => k.claimTypes.includes(kind) && accepted(k.issuer, kind))
          .map((k) => k.key),
      ]),
    ),
    status: gate.proofStatusPolicy ?? {},
    ...(gate.proofDatasets?.find((d) => d.rule === rule.id)
      ? { dataset: gate.proofDatasets.find((d) => d.rule === rule.id) as unknown as JsonObject }
      : {}),
  };
}
export async function verifyOpaqueDerivation(input: {
  statement: JsonObject;
  gate: GateContext;
  purpose: string;
  acceptsSource: (issuer: string, kind: string) => boolean;
  event: (step: DerivationStep) => void;
}): Promise<
  | { ok: true; statement: JsonObject; reportedBySubject?: boolean; verifiedCondition?: false }
  | { ok: false; reason: string }
> {
  const { statement: s, gate, purpose, event } = input;
  const d = s.derivation as JsonObject;
  const step = (clause: string, ok: boolean, reason: string, text: string) => {
    event({ clause, ok, reason: ok ? "source-accepted" : reason, text });
    return ok;
  };
  const fail = (reason: string) => ({ ok: false as const, reason });
  const rule = gate.rules?.find(
    (r) => r.id === d.rule && digestOf(r) === d.ruleDigest && r.output === s.claimType,
  );
  if (
    !step(
      "DER-6",
      !!rule && rule.assurances.includes(String(d.assurance) as "proved"),
      "rule-not-accepted",
      "The receiver accepts this rule identifier, digest, output and assurance.",
    )
  )
    return fail("rule-not-accepted");
  if (!rule) return fail("rule-not-accepted");
  const proof = d.proof as JsonObject | undefined,
    joint = d.joint as JsonObject | undefined;
  const method = String(proof?.method ?? joint?.method ?? "");
  const holder = gate.attestedDerivers?.some(
    (a) => a.deriver === d.deriver && a.rule === rule.id && a.purposes.includes(purpose),
  );
  const proofEntry = gate.acceptedProofs?.find(
    (a) =>
      a.rule === rule.id &&
      a.method === method &&
      a.assurance === d.assurance &&
      a.purposes.includes(purpose),
  );
  const jointEntry = gate.acceptedJoint?.find(
    (a) => a.rule === rule.id && a.method === method && a.purposes.includes(purpose),
  );
  const verifier = gate.proofSystems?.get(method),
    protocol = gate.jointProtocols?.get(method);
  const realQuery = method === SPARQ_ZK_QUERY.method && verifier?.kind === "real";
  const booleanQuery = realQuery && isBooleanRule(rule);
  const resultSubject =
    method === SPARQ_ZK_RESULT.method && verifier?.kind === "real" && isBooleanRule(rule);
  const methodAccepted =
    d.assurance === "joint"
      ? !!protocol && !!jointEntry
      : !!verifier && (!!proofEntry || (!booleanQuery && d.assurance === "attested" && !!holder));
  if (
    !step(
      "DER-16",
      methodAccepted,
      "method-not-accepted",
      "The receiver has a verifier and accepts the named method for this rule and purpose.",
    )
  )
    return fail("method-not-accepted");
  const request = gate.derivedRequests?.[String(proof?.nonce ?? "")];
  const fixed =
    gate.fixedJointSessions?.[String((joint?.session as JsonObject | undefined)?.sessionId ?? "")];
  const acceptedAssurances =
    d.assurance === "joint" ? fixed?.assurances : (request?.assurances ?? rule.assurances);
  if (
    !step(
      "DER-16",
      !!acceptedAssurances?.includes(String(d.assurance) as "proved"),
      "assurance-insufficient",
      "The stated assurance is one this receiver requested.",
    )
  )
    return fail("assurance-insufficient");
  if (d.deriver !== s.issuer || s.method !== "derived" || d.outputDigest !== digestOf(s.value)) {
    step(
      "DER-17",
      false,
      "derivation-not-verified",
      "The output and deriver must match the signed statement.",
    );
    return fail("derivation-not-verified");
  }
  if (d.assurance === "joint" && joint && fixed && protocol && jointEntry) {
    if (fixed.consumed || inFlight.has(fixed)) return fail("replay-conflict");
    inFlight.add(fixed);
    try {
      const same =
        fixed.method === method &&
        fixed.rule === rule.id &&
        fixed.purpose === purpose &&
        digestOf(fixed.session) === digestOf(joint.session) &&
        fixed.ruleDigest === (joint.session as JsonObject).ruleDigest &&
        joint.assumption === protocol.assumption &&
        digestOf(joint.parties) ===
          digestOf(((fixed.session.roster ?? []) as JsonObject[]).map((p) => p.party));
      const contributions = Array.isArray(joint.contributions)
        ? (joint.contributions as JsonObject[])
        : [];
      let checked: Awaited<ReturnType<typeof protocol.verifyOutcome>>;
      try {
        checked = await protocol.verifyOutcome({
          session: fixed.session,
          outcome: joint.outcome as unknown as JointOutcome,
          contributions,
        });
      } catch {
        checked = { ok: false, reason: "verifier failed" };
      }
      const outcome = joint.outcome as unknown as JointOutcome;
      const released =
        outcome?.type === "threshold-verdict"
          ? outcome.verdict
          : outcome?.type === "release"
            ? fixed.session.statistic === "count"
              ? outcome.count
              : fixed.session.statistic === "sum"
                ? outcome.sum
                : { count: outcome.count, sum: outcome.sum }
            : undefined;
      const enough =
        checked.ok &&
        contributorUpperBound(fixed, checked.contributors) >= jointEntry.minimumContributors;
      const ok =
        same && enough && released !== undefined && digestOf(released) === digestOf(s.value);
      if (
        !step(
          "DER-14",
          ok,
          "derivation-not-verified",
          checked.ok
            ? !enough
              ? "The upper bound on contributors with inputs is below the receiver's minimum."
              : `Every roster contribution verifies; assumption: ${protocol.assumption}`
            : `Joint evidence failed: ${checked.reason}; check: ${checked.check ?? "unknown"}; roster index: ${checked.index ?? "unknown"}; party at fault: ${checked.partyAtFault ?? "unknown"}.`,
        )
      )
        return fail("derivation-not-verified");
      fixed.consumed = true;
      gate.saveDerivationState?.();
      return { ok: true, statement: s };
    } finally {
      inFlight.delete(fixed);
    }
  }
  if (!verifier || !proof) return fail("derivation-not-verified");
  if (
    !step(
      "DER-16",
      !!request &&
        !request.consumed &&
        !inFlight.has(request) &&
        request.rule === rule.id &&
        request.ruleDigest === digestOf(rule) &&
        request.subject === s.subject &&
        request.purpose === purpose,
      "replay-conflict",
      "The nonce was durably issued by this receiver for this request and has not been consumed.",
    )
  )
    return fail("replay-conflict");
  if (!request) return fail("replay-conflict");
  inFlight.add(request);
  try {
    if (request.query !== queryFor(rule)) {
      step(
        "DER-17",
        false,
        "derivation-not-verified",
        "The stored request query differs from the verifier's installed profile rule.",
      );
      return fail("derivation-not-verified");
    }
    let checked: Awaited<ReturnType<typeof verifier.verify>>;
    try {
      checked = await verifier.verify({
        expectedQuery: queryFor(rule),
        presentation: proof.presentation as JsonObject,
        policy: request.policy,
        nonce: request.nonce,
        ...(booleanQuery ? { booleanResult: true } : {}),
        seenNonces: gate.saveDerivationState
          ? {
              has: () => request.consumed,
              add: () => {
                request.consumed = true;
                gate.saveDerivationState?.();
              },
            }
          : undefined,
      });
    } catch {
      checked = { ok: false, reason: "verifier failed" };
    }
    if (
      !step(
        "DER-17",
        checked.ok &&
          (resultSubject
            ? s.value === true && resultSupportsSubject(checked.released, request.subject)
            : (!booleanQuery || typeof checked.released === "boolean") &&
              digestOf(checked.released) === digestOf(s.value)),
        "derivation-not-verified",
        !checked.ok
          ? `The verifier refused: ${checked.reason}.`
          : resultSubject
            ? "The verifier checks the receiver's query, issuer/status policy and nonce. A verified row for the requested subject is required for the positive Boolean claim."
            : "The verifier checked the receiver's own query, issuer/status policy and nonce, and the released value equals the claim.",
      )
    )
      return fail("derivation-not-verified");
    if (!checked.ok) return fail("derivation-not-verified");
    const claimed = Array.isArray(d.proofBinds) ? (d.proofBinds as ProofBinds[]) : [];
    const bindsOk =
      Array.isArray(d.proofBinds) &&
      claimed.every((b) => checked.binds.includes(b)) &&
      checked.binds.every((b) => verifier.binds.includes(b)) &&
      (d.assurance !== "proved" ||
        ["rule", "issuers", "subject"].every(
          (b) => claimed.includes(b as ProofBinds) && checked.binds.includes(b as ProofBinds),
        ));
    if (
      !step(
        "DER-13",
        bindsOk,
        "derivation-not-verified",
        "The record does not overstate the method's confirmed bindings; proved also requires subject binding.",
      )
    )
      return fail("derivation-not-verified");
    let reportedBySubject = false;
    const profileBindingsMatch =
      !!proofEntry && proofEntry.binds.every((binding) => checked.binds.includes(binding));
    if ((booleanQuery || resultSubject) && proofEntry && !profileBindingsMatch) {
      step(
        "DER-13a",
        false,
        "assurance-insufficient",
        "The verifier did not confirm every binding required by the profile.",
      );
      return fail("assurance-insufficient");
    }
    if (d.assurance === "attested") {
      const accepted = profileBindingsMatch;
      if (!accepted && !holder) reportedBySubject = true;
      step(
        "DER-13a",
        true,
        "derivation-not-verified",
        `The proof establishes ${checked.binds.join(", ") || "no bindings"}. ${accepted ? "The profile accepts these limited bindings as attested." : holder ? "The accepted holder's signature attests the remaining claims." : "The remaining claims rest on the holder's signature and are treated as reported by subject; fitness decides."} No subject binding is inferred.`,
      );
    }
    const keys = checked.issuerKeys;
    const dataset =
      realQuery && request.policy.inputCommitment
        ? gate.queryProofPolicies?.find(
            (d) =>
              d.rule === rule.id &&
              d.subject === request.subject &&
              d.policy.inputCommitment === request.policy.inputCommitment,
          )
        : undefined;
    if (
      booleanQuery &&
      !step(
        "DER-17",
        !!dataset && checked.binds.includes("complete"),
        "derivation-not-verified",
        "The proof opens the verifier-pinned credential dataset for the requested subject.",
      )
    )
      return fail("derivation-not-verified");
    const sources = rule.inputsFrom.map((s) => gate.sourceAliases?.[s] ?? s);
    const kinds = ruleInputs(rule);
    const conditions = "conditions" in rule.params ? rule.params.conditions : undefined;
    const positiveKinds = kinds.filter(
      (kind) =>
        !conditions?.some((c) => c.input === kind && c.operator === "not-in") ||
        conditions.some((c) => c.input === kind && c.operator !== "not-in"),
    );
    const negativeOnlyKinds = kinds.filter((kind) => !positiveKinds.includes(kind));
    // Completeness can establish absence without a row from an issuer whose authority is
    // limited to a negative-only input. Keep the coverage requirement for positive suppliers.
    const sourcesOk = dataset
      ? sources.every(
          (issuer) =>
            dataset.coverage.some((source) => source.issuer === issuer) ||
            (checked.binds.includes("complete") &&
              negativeOnlyKinds.some((kind) => input.acceptsSource(issuer, kind)) &&
              !positiveKinds.some((kind) => input.acceptsSource(issuer, kind))),
        ) &&
        positiveKinds.every((kind) =>
          dataset.coverage.some((source) => source.claimTypes.includes(kind)),
        ) &&
        dataset.coverage.every((source) => {
          const keyDigest = digestOf(source.key);
          return (
            sources.includes(source.issuer) &&
            keys.some((key) => digestOf(key) === keyDigest) &&
            gate.proofIssuerKeys?.some(
              (pinned) =>
                pinned.issuer === source.issuer &&
                digestOf(pinned.key) === keyDigest &&
                source.claimTypes.every((kind) => pinned.claimTypes.includes(kind)),
            ) &&
            source.claimTypes.length > 0 &&
            source.claimTypes.every(
              (kind) => kinds.includes(kind) && input.acceptsSource(source.issuer, kind),
            )
          );
        }) &&
        keys.every((key) =>
          dataset.coverage.some((source) => digestOf(key) === digestOf(source.key)),
        )
      : keys.length > 0 &&
        keys.every((key) => {
          const pinned = gate.proofIssuerKeys?.find((k) => digestOf(k.key) === digestOf(key));
          return (
            pinned &&
            kinds.every(
              (kind) =>
                pinned.claimTypes.includes(kind) &&
                input.acceptsSource(pinned.issuer, kind) &&
                sources.includes(pinned.issuer),
            )
          );
        });
    if (
      !step(
        "DER-18",
        sourcesOk,
        "source-not-authoritative",
        dataset
          ? "The pinned dataset covers every required source and positive input with independently accepted issuer keys. Absence is checked against the complete dataset."
          : "This method does not bind an issuer to each fact. Every reported issuer key must therefore be independently accepted for every kind of claim the rule reads.",
      )
    )
      return fail("source-not-authoritative");
    request.consumed = true;
    gate.saveDerivationState?.();
    return {
      ok: true,
      statement: s,
      reportedBySubject,
      ...(booleanQuery && s.value === false ? { verifiedCondition: false as const } : {}),
    };
  } finally {
    inFlight.delete(request);
  }
}
