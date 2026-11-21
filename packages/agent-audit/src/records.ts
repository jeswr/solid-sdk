// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { canonicalJson, digestOf, isIri } from "@jeswr/agent-model/core/canonical";
import { z } from "zod";

/** No free-form payloads: audit records contain references, digests and counts only. */
const LEGACY_ENTRY_KINDS = [
  "ingest",
  "proposal",
  "decision",
  "approval-seen",
  "transmission",
  "receipt",
  "control",
  "mandate-change",
  "model-call",
  "tool-call",
  "tamper-suspected",
  "conversation",
] as const;
export const ENTRY_KINDS = [...LEGACY_ENTRY_KINDS, "gate-decision", "record-anchor"] as const;
const iri = z
  .string()
  .max(2048)
  .refine(isIri)
  .refine((value) => !/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(value));
const label = z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/);
const instrumentationLabel = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => !/[^a-zA-Z0-9_.-]/.test(value));
/** Opaque runtime-assigned experiment label; never a prompt or user-supplied title. */
export const taskIdSchema = instrumentationLabel;
export const digestSchema = z.string().regex(/^sha-256:[a-f0-9]{64}$/);
export const recipientHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const instantSchema = z.iso.datetime({ precision: 3 });
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** Exact body-free terms signed by an approval. Hash the message bytes separately. */
export const termsSchema = z.strictObject({
  action: iri,
  target: iri,
  binding: label,
  accountId: label,
  recipientHashes: z.array(recipientHashSchema).min(1).max(100),
  messageDigest: digestSchema,
  purpose: iri.optional(),
  /** Commits the executor's full intent, carrier, preview and expiry without exposing them. */
  proposalDigest: digestSchema.optional(),
});
const recordSchema = z.strictObject({
  type: z.enum(LEGACY_ENTRY_KINDS),
  id: iri,
  agent: iri,
  owner: iri,
  taskId: taskIdSchema.optional(),
  conversation: iri.optional(),
  proposal: iri.optional(),
  mandate: iri.optional(),
  approval: iri.optional(),
  decisionRecord: iri.optional(),
  transmission: iri.optional(),
  receipt: iri.optional(),
  terms: termsSchema.optional(),
  termsDigest: digestSchema.optional(),
  messageDigest: digestSchema.optional(),
  decision: z.enum(["permit", "confirm-required", "prohibited", "refuse-all"]).optional(),
  status: z.enum(["attempting", "sent", "not-sent", "uncertain", "refused"]).optional(),
  reason: label.optional(),
  accountId: label.optional(),
  recipientHashes: z.array(recipientHashSchema).max(100).optional(),
  context: z.enum(["reader", "proposer"]).optional(),
  provider: z.enum(["openai", "anthropic"]).optional(),
  model: label.optional(),
  modelCall: iri.optional(),
  tool: instrumentationLabel.optional(),
  tokens: count.optional(),
  inputTokens: count.optional(),
  outputTokens: count.optional(),
  toolCalls: count.optional(),
  latencyMs: count.optional(),
  retries: count.optional(),
});
const identityFields = { id: iri, agent: iri, owner: iri };
const linkedDigest = digestSchema.length(72);
/** Body-free reference and daemon verdict codes admitted to gate decisions. */
export const GATE_DECISION_REASONS = Object.freeze([
  // integrity / authentication (local rejections, not replied to)
  "malformed",
  "bounds-exceeded",
  "unsigned-not-allowed",
  "unknown-key",
  "bad-signature",
  "disallowed-header",
  "configuration-mismatch",
  "sender-key-mismatch",
  "wrong-audience",
  "expired",
  "not-yet-valid",
  "lifetime-too-long",
  "replay-conflict",
  "capacity",
  // binding
  "no-structured-content",
  "conflicting-structured-copies",
  "human-parity-mismatch",
  // interaction
  "unsupported-profile",
  "unsupported-configuration",
  "unsupported-operation",
  "unsupported-kind",
  "unsupported-term",
  "protocol-violation",
  "terms-digest-mismatch",
  "round-limit",
  "conversation-closed",
  // representation / authority / authorisation
  "representation-missing",
  "representation-invalid",
  "representation-expired",
  "representation-out-of-scope",
  "source-not-authoritative",
  "evidence-invalid",
  "not-authorised",
  "mandate-invalid",
  "assurance-insufficient",
  "approval-required",
  "approval-denied",
  "approval-mismatch",
  "missing-context",
  "indeterminate-policy",
  "grant-invalid",
  "grant-expired",
  "grant-revoked",
  "insufficient-scope",
  "purpose-not-permitted",
  "no-agreement",
  "amount-differs",
  "payee-differs",
  "receipt-mismatch",
  "context-not-clear",
  "terms-not-acceptable",
  "structured-form-required",
  "method-not-accepted",
  "source-unknown",
  "lookup-failed",
  "status-withdrawn",
  "mandate-withdrawn",
  "prohibited",
  "confidence-too-low",
  "superseded-by-better-source",
  "partial-result",
  "completeness-not-established",
  "rule-not-accepted",
  "deriver-not-accepted",
  "form-not-available",
  "rule-unbounded",
  "limit-exceeded",
  "budget-exceeded",
  "stopped-by-principal",
  "record-unavailable",
  "derivation-not-verified",
  "result-uncertain",
  "evidence-missing",
  // domain
  "invalid-terms",
  "no-acceptable-slot",
  "fee-not-acceptable",
  "excessive-scope",
  "stale-data",
  "credentials-required",
  "execution-failed",
  // Suite gate
  "admit",
  "go",
  "ask-principal",
  "indeterminate",
  "proposal-conflict",
] as const);
export const MAX_RECORD_ANCHOR_BYTES = 4096;
const gateDecisionSchema = z
  .strictObject({
    ...identityFields,
    type: z.literal("gate-decision"),
    direction: z.enum(["in", "out"]),
    messageDigest: linkedDigest,
    outcome: z.enum(["admit", "refuse", "unstructured", "go", "stop", "ask-principal"]),
    reason: z.enum(GATE_DECISION_REASONS),
    configuration: iri,
    gateSeq: count.min(1),
    gateHash: linkedDigest,
    taskId: taskIdSchema.optional(),
    conversation: iri.optional(),
  })
  .refine(
    ({ direction, outcome }) =>
      (direction === "in") ===
      (outcome === "admit" || outcome === "refuse" || outcome === "unstructured"),
  );
const witnessHeader = z.strictObject({
  alg: z.literal("EdDSA"),
  kid: z
    .string()
    .length(43)
    .regex(/^[A-Za-z0-9_-]{43}$/),
  typ: z.literal("awp-record-anchor+jws"),
});
const witnessPayload = z.strictObject({
  type: z.literal("RecordAnchorReceipt"),
  actor: iri,
  party: iri,
  subject: iri,
  subjectParty: iri,
  seq: count.min(1),
  hash: linkedDigest,
  at: z.iso.datetime(),
});

function jwsJson(part: string): unknown {
  const bytes = Uint8Array.from(atob(part.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(text);
  if (JSON.stringify(value) !== text) throw new Error("Invalid witness JSON");
  return value;
}
const recordAnchorSchema = z
  .strictObject({
    ...identityFields,
    type: z.literal("record-anchor"),
    seq: count.min(1),
    hash: linkedDigest,
    jws: z
      .string()
      .max(MAX_RECORD_ANCHOR_BYTES)
      .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/)
      .refine((value) => !/\s/.test(value)),
  })
  .refine(({ agent, owner, seq, hash, jws }) => {
    // The wire is not an opaque text slot. Admit only the body-free self-witness shape.
    // The offline auditor also verifies the signature against the configured gate key.
    const [header, payload] = jws.split(".");
    try {
      if (!header || !payload || !witnessHeader.safeParse(jwsJson(header)).success) return false;
      const signed = witnessPayload.parse(jwsJson(payload));
      return (
        signed.actor === agent &&
        signed.subject === agent &&
        signed.party === owner &&
        signed.subjectParty === owner &&
        signed.seq === seq &&
        signed.hash === hash
      );
    } catch {
      return false;
    }
  }, "Invalid record head witness");
const auditRecordSchema = z.discriminatedUnion("type", [
  recordSchema,
  gateDecisionSchema,
  recordAnchorSchema,
]);
const checkpointSchema = z.strictObject({
  type: z.literal("ledger-checkpoint"),
  lastPrunedSeq: count.min(1),
  lastPrunedHash: digestSchema,
  lastPrunedGate: z.strictObject({ seq: count.min(1), hash: digestSchema }).optional(),
});
export const ledgerRecordSchema = z.union([auditRecordSchema, checkpointSchema]);
// Preserve optional property reads across kinds while keeping each kind's fields closed.
type AuditVariant = z.infer<typeof auditRecordSchema>;
type UnionKeys<T> = T extends unknown ? keyof T : never;
type AuditFields<T> = T extends unknown
  ? T & Partial<Record<Exclude<UnionKeys<AuditVariant>, keyof T>, never>>
  : never;
export type AuditRecord = AuditFields<AuditVariant>;
export type AuditTerms = z.infer<typeof termsSchema>;
export type LedgerRecord = AuditRecord | z.infer<typeof checkpointSchema>;
export function linkedGateHead(record: LedgerRecord): { seq: number; hash: string } | undefined {
  if (record.type === "ledger-checkpoint") return record.lastPrunedGate;
  if (record.type === "gate-decision") return { seq: record.gateSeq, hash: record.gateHash };
}
export const GENESIS = "sha-256:genesis";
/** Maximum published sequence the pod reader and mirror can process. */
export const MAX_AUDIT_SEQ = 200000;
export const entrySchema = z.strictObject({
  seq: count.min(1),
  at: instantSchema,
  prev: z.union([digestSchema, z.literal(GENESIS)]),
  record: ledgerRecordSchema,
  hash: digestSchema,
});
export type LedgerEntry = Omit<z.infer<typeof entrySchema>, "record"> & { record: LedgerRecord };

export class AuditHeadChangedError extends Error {
  constructor() {
    super("Audit head changed before anchoring");
  }
}

/** Reject getters, cycles and lossy JSON before validating the privacy allowlist. */
export function checkedRecord(value: unknown): LedgerRecord {
  const json = canonicalJson(value);
  if (new TextEncoder().encode(json).byteLength > 65536)
    throw new Error("Audit record exceeds bound");
  return ledgerRecordSchema.parse(JSON.parse(json));
}
export function seal(seq: number, at: string, prev: string, value: unknown): LedgerEntry {
  const record = checkedRecord(value);
  if (record.type === "record-anchor" && (record.seq !== seq - 1 || record.hash !== prev))
    throw new AuditHeadChangedError();
  return entrySchema.parse({ seq, at, prev, record, hash: digestOf({ seq, at, prev, record }) });
}
