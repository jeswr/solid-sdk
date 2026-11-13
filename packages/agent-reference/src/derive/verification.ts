// AUTHORED-BY Codex GPT-6
/** Source-phase checks for opaque proofs and joint evidence. No prover-supplied policy. */
import { digestOf } from "../core/canonical.js";
import type { JsonObject } from "../core/types.js";
import type { GateContext } from "../gates/common.js";
import { type DerivationRule, ruleInputs } from "./rules.js";
import type { JointOutcome, ProofBinds } from "./verifiers.js";

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
  accepted: (issuer: string, kind: string) => boolean,
): JsonObject {
  const kinds = ruleInputs(rule);
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
  { ok: true; statement: JsonObject; reportedBySubject?: boolean } | { ok: false; reason: string }
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
  const methodAccepted =
    d.assurance === "joint"
      ? !!protocol && !!jointEntry
      : !!verifier && (!!proofEntry || (d.assurance === "attested" && !!holder));
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
    const ok =
      same &&
      checked.ok &&
      new Set(checked.contributors).size >= jointEntry.minimumContributors &&
      released !== undefined &&
      digestOf(released) === digestOf(s.value);
    if (
      !step(
        "DER-14",
        ok,
        "derivation-not-verified",
        checked.ok
          ? `Every roster contribution verifies; assumption: ${protocol.assumption}`
          : `Joint evidence failed: ${checked.reason}; party at fault: ${checked.partyAtFault ?? "unknown"}.`,
      )
    )
      return fail("derivation-not-verified");
    return { ok: true, statement: s };
  }
  if (!verifier || !proof) return fail("derivation-not-verified");
  if (
    !step(
      "DER-16",
      !!request &&
        !request.consumed &&
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
  let checked: Awaited<ReturnType<typeof verifier.verify>>;
  try {
    checked = await verifier.verify({
      expectedQuery: request.query,
      presentation: proof.presentation as JsonObject,
      policy: request.policy,
      nonce: request.nonce,
    });
  } catch {
    checked = { ok: false, reason: "verifier failed" };
  }
  if (
    !step(
      "DER-17",
      checked.ok && digestOf(checked.released) === digestOf(s.value),
      "derivation-not-verified",
      checked.ok
        ? "The verifier checked the receiver's own query, issuer/status policy and nonce, and the released value equals the claim."
        : `The verifier refused: ${checked.reason}.`,
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
  if (d.assurance === "attested") {
    const accepted = !!proofEntry && proofEntry.binds.every((b) => checked.binds.includes(b));
    if (!accepted && !holder) reportedBySubject = true;
    step(
      "DER-13a",
      true,
      "derivation-not-verified",
      `The proof establishes ${checked.binds.join(", ") || "no bindings"}. ${accepted ? "The profile accepts these limited bindings as attested." : holder ? "The accepted holder's signature attests the remaining claims." : "The remaining claims rest on the holder's signature and are treated as reported by subject; fitness decides."} No subject binding is inferred.`,
    );
  }
  const keys = checked.issuerKeys;
  const sourcesOk =
    keys.length > 0 &&
    keys.every((key) => {
      const pinned = gate.proofIssuerKeys?.find((k) => digestOf(k.key) === digestOf(key));
      return (
        pinned &&
        ruleInputs(rule).every(
          (kind) =>
            pinned.claimTypes.includes(kind) &&
            input.acceptsSource(pinned.issuer, kind) &&
            rule.inputsFrom.map((s) => gate.sourceAliases?.[s] ?? s).includes(pinned.issuer),
        )
      );
    });
  if (
    !step(
      "DER-18",
      sourcesOk,
      "source-not-authoritative",
      "This method does not bind an issuer to each fact. Every reported issuer key must therefore be independently accepted for every kind of claim the rule reads.",
    )
  )
    return fail("source-not-authoritative");
  request.consumed = true;
  gate.saveDerivationState?.();
  return { ok: true, statement: s, reportedBySubject };
}
