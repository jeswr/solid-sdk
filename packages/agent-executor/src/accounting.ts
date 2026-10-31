// AUTHORED-BY Codex GPT-6.1-Sol
import { AGENT } from "@jeswr/agent-mandate";
import { canonicalJson } from "@jeswr/agent-model";
import { MAX_TRANSMISSION_ATTEMPTS } from "./transmission.js";
import type { AccountingMandate, OutboxEntry, TransmissionRecord } from "./types.js";

/** Union by proposal id: the outbox and ledger often describe the SAME committed effect. */
export function transmissionRecords(records: readonly TransmissionRecord[]): TransmissionRecord[] {
  const unique = new Map<string, TransmissionRecord>();
  for (const record of records) {
    if (
      !Number.isInteger(record.attempts) ||
      record.attempts < 1 ||
      record.attempts > MAX_TRANSMISSION_ATTEMPTS ||
      !Number.isFinite(Date.parse(record.startedAt)) ||
      !Number.isFinite(Date.parse(record.updatedAt)) ||
      !Number.isFinite(Date.parse(record.committedAt)) ||
      !["attempting", "sent", "not-sent", "uncertain"].includes(record.status) ||
      !Number.isFinite(record.amount.value) ||
      record.amount.value < 0 ||
      !/^[A-Z]{3}$/.test(record.amount.currency)
    )
      throw new Error("Invalid accounting record");
    if (
      [
        record.proposal,
        record.binding,
        record.account,
        record.wireDigest,
        record.termsDigest,
        record.conversation,
        record.recipientHash,
        record.underMandate,
      ].some((value) => typeof value !== "string" || value.length === 0)
    )
      throw new Error("Invalid accounting identity");
    const old = unique.get(record.proposal);
    const identity = (r: TransmissionRecord) =>
      canonicalJson({
        proposal: r.proposal,
        binding: r.binding,
        account: r.account,
        wireDigest: r.wireDigest,
        termsDigest: r.termsDigest,
        startedAt: r.startedAt,
        conversation: r.conversation,
        recipientHash: r.recipientHash,
        amount: r.amount,
      });
    if (old && identity(old) !== identity(record))
      throw new Error("Conflicting accounting records");
    // Sent is positive evidence; a stale not-sent record must not erase an obligation.
    if (
      !old ||
      record.status === "sent" ||
      (old.status !== "sent" && Date.parse(record.updatedAt) >= Date.parse(old.updatedAt))
    )
      unique.set(record.proposal, {
        ...record,
        attempts: Math.max(old?.attempts ?? 0, record.attempts),
      });
    else if (record.attempts > old.attempts)
      unique.set(record.proposal, { ...old, attempts: record.attempts });
  }
  return [...unique.values()];
}

export function committedRecords(records: readonly TransmissionRecord[]): TransmissionRecord[] {
  return transmissionRecords(records).filter((r) => r.status !== "not-sent");
}

/** UTC calendar periods for global/spend limits; recipient contact rate uses rolling 24 h. */
export function periodStart(at: Date, period: "day" | "week" | "month"): number {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (period === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === "month") start.setUTCDate(1);
  return start.getTime();
}

export function checkLimits(
  mandate: AccountingMandate,
  entry: OutboxEntry,
  records: readonly TransmissionRecord[],
  now: Date,
): { readonly status: "refused" | "confirm-required"; readonly reason: string } | undefined {
  const committed = committedRecords(records);
  const prior = committed.find((r) => r.proposal === entry.proposal.id);
  const others = committed.filter((r) => r.proposal !== entry.proposal.id);
  let soft: { status: "confirm-required"; reason: string } | undefined;
  for (const limit of mandate.limits) {
    const operand = limit.leftOperand.slice(AGENT.length);
    const spend = ["spendPerDay", "spendPerWeek", "spendPerMonth"].includes(operand);
    const contact = operand === "perRecipientPerDay";
    const supported = spend || contact || operand === "sendsPerDay";
    let invalid =
      !limit.leftOperand.startsWith(AGENT) ||
      !supported ||
      limit.operator !== "lteq" ||
      !Number.isFinite(limit.rightOperand) ||
      limit.rightOperand < 0;
    const start = contact
      ? now.getTime() - 86400000
      : periodStart(
          now,
          operand === "spendPerWeek" ? "week" : operand === "spendPerMonth" ? "month" : "day",
        );
    const active = others.filter((r) => Date.parse(r.committedAt) >= start);
    if (spend)
      invalid ||=
        !mandate.currency ||
        mandate.currency !== entry.proposal.intent.amount.currency ||
        active.some((r) => r.amount.value > 0 && r.amount.currency !== mandate.currency);
    // A retry replaces its own reservation; an unresolved prior send still counts exactly once.
    const candidate = prior ?? { ...entry.proposal.intent, committedAt: now.toISOString() };
    const candidates = Date.parse(candidate.committedAt) >= start ? [...active, candidate] : active;
    const used = candidates.reduce(
      (sum, r) =>
        sum +
        (spend
          ? r.amount.value
          : contact
            ? Number(r.recipientHash === entry.proposal.intent.recipientHash)
            : 1),
      0,
    );
    const exceeds =
      spend && !invalid
        ? candidates.reduce((sum, record) => sum + amountUnits(record.amount.value), 0n) >
          amountUnits(limit.rightOperand)
        : used > limit.rightOperand;
    if (invalid || exceeds) {
      const reason = invalid ? "limit-context-unavailable" : `limit:${operand}`;
      if (limit.enforcement !== "soft") return { status: "refused", reason };
      soft = { status: "confirm-required", reason };
    }
  }
  return soft;
}

/** Exact decimal value of the JSON number, scaled to cover even the smallest subnormal. */
function amountUnits(value: number): bigint {
  const [mantissa, exponent = "0"] = String(value).split("e") as [string, string?];
  const [integer, fraction = ""] = mantissa.split(".") as [string, string?];
  return BigInt(integer + fraction) * 10n ** BigInt(324 + Number(exponent) - fraction.length);
}
