// AUTHORED-BY Codex GPT-6
import { digestOf } from "../core/canonical.js";
import type { JsonObject } from "../core/types.js";
import type { LedgerEntry } from "../store/ledger.js";
import { readTerms } from "./properties.js";

export const faultKinds = [
  "withhold-receipt",
  "deny-acknowledged",
  "change-terms",
  "outside-purpose",
  "different-commitment",
  "after-withdrawal",
] as const;
export type FaultKind = (typeof faultKinds)[number];
export interface PartyRecord {
  party: string;
  actor: string;
  entries: readonly LedgerEntry[];
  /** Exact protected messages retained by this party, never an injected fault label. */
  messages: readonly { direction: string; jws: string }[];
}
export type Attribution =
  | { party: string; clause: string; evidence: readonly string[] }
  | { result: "cannot-tell"; reason: string; missingField: string };

/** Mechanical Cartesian product. A plan changes exactly one participant. */
export function generateFaults(parties: readonly string[]): { party: string; kind: FaultKind }[] {
  return [...new Set(parties)].flatMap((party) => faultKinds.map((kind) => ({ party, kind })));
}

/** Change the sender's commitment only. The caller signs it using that same sender's key. */
export function changeCommitment(message: JsonObject): JsonObject {
  const changed = structuredClone(message);
  const body = changed.body;
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("no commitment body");
  if (
    changed.kind === "propose" &&
    body.terms &&
    typeof body.terms === "object" &&
    !Array.isArray(body.terms)
  )
    body.terms = { ...body.terms, fee: Number(body.terms.fee ?? 0) + 1 };
  else if (changed.kind === "accept") body.termsDigest = "sha-256:e0-different-commitment";
  else throw new Error("no structured commitment");
  return changed;
}

/** A dishonest party sends new signed bytes after the checkpoint, preserving both identities. */
export function laterMessage(message: JsonObject, at: string, purpose?: string): JsonObject {
  const changed = structuredClone(message);
  changed.id = `urn:e0:fault:${digestOf({ original: message.id, at, purpose: purpose ?? null }).slice(8)}`;
  changed.createdAt = new Date(Date.parse(at) + 1000).toISOString();
  changed.expiresAt = new Date(Date.parse(at) + 61000).toISOString();
  if (purpose) {
    const body = changed.body as JsonObject;
    if (changed.kind === "invoke") body.purpose = purpose;
    else if (changed.kind === "propose") (body.terms as JsonObject).purpose = purpose;
    else {
      changed.kind = "invoke";
      changed.body = {
        operation: body.operation ?? { id: "urn:e0:operation", version: "0.1" },
        basis: { kind: "represented" },
        input: {},
        purpose,
      };
    }
  }
  return changed;
}

function intact(entries: readonly LedgerEntry[]): boolean {
  return entries.every(
    (e, i) =>
      e.hash === digestOf({ seq: e.seq, at: e.at, prev: e.prev, record: e.record }) &&
      (i === 0 || e.prev === entries[i - 1]?.hash),
  );
}

function payload(jws: string): JsonObject | undefined {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonObject)
      : undefined;
  } catch {
    return undefined;
  }
}

function purposeRestricted(
  terms: import("../gates/common.js").ItemTerms,
  purpose: string,
): boolean {
  const rules =
    terms.policy?.permissions?.filter((r) => r.action === "use" || r.action === "distribute") ?? [];
  const values = (c: { rightOperand: string | number | readonly (string | number)[] }) =>
    Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand];
  const forbidden = terms.policy?.prohibitions?.some(
    (r) =>
      (r.action === "use" || r.action === "distribute") &&
      r.constraints?.length &&
      r.constraints.every(
        (c) =>
          c.leftOperand === "purpose" &&
          ["eq", "isAnyOf"].includes(c.operator) &&
          values(c).includes(purpose),
      ),
  );
  return (
    !!forbidden ||
    (rules.length > 0 &&
      rules.every((r) =>
        r.constraints?.some(
          (c) =>
            c.leftOperand === "purpose" &&
            ["eq", "isAnyOf"].includes(c.operator) &&
            !values(c).includes(purpose),
        ),
      )) ||
    !!terms.inherited?.some((i) => i.terms && purposeRestricted(i.terms, purpose))
  );
}

/** Only records enter here. No scenario, expected answer, path name or injected label. */
export function whoWasAtFault(recordA: PartyRecord, recordB: PartyRecord): Attribution {
  if (![recordA, recordB].every((r) => intact(r.entries)))
    return {
      result: "cannot-tell",
      reason: "A supplied record has a broken hash chain.",
      missingField: "A valid signed record segment and the peer's checkpoint",
    };
  const findings: { party: string; clause: string; evidence: string[] }[] = [];
  const messages = [recordA, recordB]
    .flatMap((r) => r.messages)
    .map((m) => payload(m.jws))
    .filter((m): m is JsonObject => !!m);
  const accepted = [recordA, recordB]
    .flatMap((r) => r.entries)
    .flatMap((e) => {
      const signatures = e.record.signatures;
      return signatures && typeof signatures === "object"
        ? Object.values(signatures).flatMap((jws) => {
            const value = typeof jws === "string" ? payload(jws) : undefined;
            return value?.operation === "accept" ? [value] : [];
          })
        : [];
    });
  for (const record of [recordA, recordB]) {
    const peer = record === recordA ? recordB : recordA;
    const received = peer.messages
      .filter((m) => m.direction === "in")
      .map((m) => payload(m.jws))
      .filter((m): m is JsonObject => !!m);
    for (const message of received) {
      const from = message.from as JsonObject | undefined;
      const actor = from?.actor ?? message.actor;
      const sentAt = typeof message.createdAt === "string" ? message.createdAt : message.at;
      if (actor !== record.actor || typeof sentAt !== "string") continue;
      const withdrawal = record.entries.findLast(
        (e) => e.record.type === "mandate-revoked" && Date.parse(e.at) < Date.parse(sentAt),
      );
      if (
        withdrawal &&
        !record.entries.some(
          (e) =>
            e.seq > withdrawal.seq &&
            e.record.type === "grant" &&
            e.record.kind === "owner-mandate" &&
            e.record.digest !== withdrawal.record.digest,
        )
      )
        findings.push({
          party: record.party,
          clause: "CORE-OUT-10",
          evidence: [withdrawal.hash, digestOf(message)],
        });
      if (typeof message.termsDigest === "string" && typeof message.agreement === "string") {
        const previous = accepted.find(
          (a) =>
            a.actor === record.actor &&
            a.agreement === message.agreement &&
            a.termsDigest !== message.termsDigest,
        );
        if (previous)
          findings.push({
            party: record.party,
            clause: "CORE-OUT-7",
            evidence: [digestOf(previous), digestOf(message)],
          });
      }
      const body = message.body as JsonObject | undefined;
      if (message.kind === "accept" && typeof body?.termsDigest === "string") {
        for (const approval of record.entries.filter(
          (e) => e.record.type === "approval" && e.record.decision === "approve",
        )) {
          const authorised = record.entries.find(
            (e) =>
              e.record.type === "authorisation-decision" &&
              e.record.actionDigest === approval.record.actionDigest,
          );
          const action = authorised?.record.action as JsonObject | undefined;
          const parameters = action?.parameters as JsonObject | undefined;
          if (
            action?.conversation === message.conversation &&
            typeof parameters?.termsDigest === "string" &&
            parameters.termsDigest !== body.termsDigest
          )
            findings.push({
              party: record.party,
              clause: "CORE-OUT-7",
              evidence: [approval.hash, authorised?.hash ?? "", digestOf(message)],
            });
        }
      }
      const terms = body?.terms as JsonObject | undefined;
      const purpose = body?.purpose ?? terms?.purpose;
      if (typeof purpose !== "string") continue;
      const carried = Array.isArray(message.evidence)
        ? message.evidence.flatMap((e) => {
            if (
              !e ||
              typeof e !== "object" ||
              Array.isArray(e) ||
              e.role !== "credential" ||
              typeof e.value !== "string"
            )
              return [];
            const claim = payload(e.value);
            return claim ? [claim] : [];
          })
        : [];
      for (const claim of carried) {
        if (typeof claim.id !== "string" || !claim.terms) continue;
        const item = {
          id: claim.id,
          digest: digestOf(claim),
          kind: "statement" as const,
          label: "Recorded claim",
          claimType: String(claim.claimType),
          source: String(claim.issuer),
          terms: claim.terms as unknown as import("../gates/common.js").ItemTerms,
        };
        const state = {
          actor: record.actor,
          at: sentAt,
          withdrawn: false,
          items: [item],
          approvals: {},
          admissionDigests: [],
          shownDigests: [],
        };
        const proposal = {
          action: "distribute",
          target: claim.id,
          operation: String((body?.operation as JsonObject | undefined)?.id ?? "urn:e0:operation"),
          conversation: String(message.conversation),
          recipient: peer.party,
          purpose,
          parameters: { evidence: [claim.id] },
        };
        if (
          purposeRestricted(item.terms, purpose) &&
          readTerms(item.terms, item, state, proposal) === "deny"
        )
          findings.push({
            party: record.party,
            clause: "CORE-OUT-5",
            evidence: [digestOf(claim), digestOf(message)],
          });
      }
    }
    for (const denial of messages) {
      const from = denial.from as JsonObject | undefined;
      const body = denial.body as JsonObject | undefined;
      const observed = body?.observed as JsonObject | undefined;
      const actor = denial.issuer ?? from?.actor;
      const received = denial.received ?? observed?.received;
      const ref = denial.message ?? observed?.message;
      if (actor !== record.actor || received !== false || typeof ref !== "string") continue;
      const acknowledgement = messages.find((m) => {
        const sender = m.from as JsonObject | undefined,
          content = m.body as JsonObject | undefined;
        const observation = content?.observed as JsonObject | undefined;
        return (
          sender?.actor === record.actor &&
          m.kind === "receipt" &&
          m.id !== denial.id &&
          observation?.received !== false &&
          (m.inReplyTo === ref || content?.ref === ref)
        );
      });
      if (acknowledgement)
        findings.push({
          party: record.party,
          clause: "AC-2",
          evidence: [digestOf(acknowledgement), digestOf(denial)],
        });
    }
  }
  const unique = findings.filter(
    (f, i) => findings.findIndex((g) => g.party === f.party && g.clause === f.clause) === i,
  );
  if (unique.length === 1) return unique[0] as NonNullable<(typeof unique)[0]>;
  return {
    result: "cannot-tell",
    reason:
      unique.length > 1
        ? "The records contain more than one independently attributable breach."
        : "The records do not bind a breached duty or the principal's displayed commitment to an observed act. Absence of a receipt alone proves no withholding.",
    missingField:
      "A peer-acknowledged receipt deadline, signed denial linked to an acknowledgement, displayed terms digest, or witnessed use with item, purpose and time",
  };
}
