// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import {
  type AuditRecord,
  GATE_DECISION_REASONS,
  MAX_RECORD_ANCHOR_BYTES,
} from "@jeswr/agent-audit";
import {
  type BridgeMessage,
  type ChannelParseRefusalReason,
  DIRECT,
  type ProposalContext,
  readEnvelope,
} from "@jeswr/agent-channels";
import type { ProposalRelease } from "@jeswr/agent-executor";
import { type ActionProposal, digestBytes, digestOf } from "@jeswr/agent-model";
import {
  AgentRuntime,
  type AgentRuntimeOptions,
  CONFIG_ED25519,
  DEFAULT_LIMITS,
  FileLedger,
  FileStateStore,
  readAgent,
  type SigningKey,
  type StepResult,
  signCompact,
  TrustStore,
  type TrustStoreData,
  verifyCompact,
  verifyLedger,
} from "@jeswr/agent-reference";
import {
  LEDGER_GENESIS,
  type LedgerHead,
  verifyLedgerAtHead,
} from "@jeswr/agent-reference/store/ledger";
import { readRuntimeStateFile } from "@jeswr/agent-reference/store/state";
import { randomUUID } from "crypto";
import { constants } from "fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import { z } from "zod";
import { readPrivate, syncDirectory, writePrivate } from "./local.js";
import { createOutboundGate, type OutboundMapping } from "./outbound.js";

export type { OutboundMapping } from "./outbound.js";

export type GateOutcome = "admitted" | "unstructured" | "refused";
export interface GateVerdict {
  readonly outcome: GateOutcome;
  readonly reason?: string;
  readonly messageId?: string;
  readonly conversation?: string;
  readonly digest: string;
}
type GateIdentity = { actor: string; party: string };
export interface InboundGatePort {
  check(input: {
    binding: string;
    account: string;
    message: BridgeMessage;
    replayKey?: string;
  }): Promise<GateVerdict>;
  /** Record a body-free refusal before the daemon can commit the cursor. */
  recordParseRefusal?(input: ParseRefusalInput): Promise<GateVerdict>;
  /** Durable ports open only inside the daemon's process lease. */
  open?(identity: GateIdentity): Promise<Gate>;
}
export type DaemonGatePort = InboundGatePort &
  (
    | { open(identity: GateIdentity): Promise<Gate> }
    | (Pick<Gate, "head" | "anchor" | "release"> &
        Partial<
          Pick<
            Gate,
            "decisions" | "evidence" | "verifyAnchor" | "recoverAnchor" | "setReleaseAudit"
          >
        >)
  );
type CheckInput = Parameters<InboundGatePort["check"]>[0];
export type ParseRefusal = {
  reason: ChannelParseRefusalReason;
} & ({ raw: string | Uint8Array } | { digest: string });
type ParseRefusalInput = { binding: string; account: string; replayKey?: string } & ParseRefusal;
type GateOptions = {
  directory: string;
  now?: () => Date;
  outbound?: OutboundMapping;
  /** Trusted host configuration for operations that admit evidence into a named task. */
  admission?: Pick<NonNullable<AgentRuntimeOptions["gates"]>, "reliance"> & {
    taskId: string;
    handlers: AgentRuntimeOptions["handlers"];
  };
};
const filePattern = /^verdict-([a-f0-9]{64}(?:-[a-f0-9]{64})?)\.json$/;
const reasonCode = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const gateReason = z.enum(GATE_DECISION_REASONS);
export function auditGateReason(reason: string): (typeof GATE_DECISION_REASONS)[number] {
  return gateReason.safeParse(reason).data ?? "indeterminate";
}
type AuditDecision = Extract<AuditRecord, { type: "gate-decision" }>;
type ProjectionTask = Pick<AuditDecision, "taskId" | "conversation">;
type DecisionFields = Pick<AuditDecision, "direction" | "outcome" | "reason" | "messageDigest"> &
  ProjectionTask;
const decisionDigest = z
  .string()
  .length(72)
  .regex(/^sha-256:[a-f0-9]{64}$/);
const decisionFields = z.object({
  direction: z.enum(["in", "out"]),
  outcome: z.enum(["admit", "refuse", "unstructured", "go", "stop", "ask-principal"]),
  reason: gateReason,
  messageDigest: decisionDigest,
  taskId: z.string().optional(),
  conversation: z.string().optional(),
});
const pendingDecisionName = "pending.json";
const pendingDecisionSchema = z.strictObject({
  binding: z.string(),
  fields: decisionFields.strict(),
  replayKey: decisionDigest.optional(),
  transaction: z.uuid(),
  completion: z
    .discriminatedUnion("type", [
      z.strictObject({
        type: z.literal("verdict"),
        hex: z.string().regex(/^[a-f0-9]{64}(?:-[a-f0-9]{64})?$/),
        digest: decisionDigest,
      }),
      z.strictObject({
        type: z.literal("release"),
        name: z.string().regex(/^release-[a-f0-9]{64}\.json$/),
        digest: decisionDigest,
      }),
    ])
    .optional(),
});
type PendingDecision = z.infer<typeof pendingDecisionSchema>;
type DecisionCompletion = PendingDecision["completion"];
type ReleaseAudit = {
  proposalDigest: string;
  task: ProjectionTask;
  record(result: ProposalRelease): Promise<ProposalRelease>;
};
type PublishAnchor = (jws: string) => Promise<void>;

export function inboundAuditDecision(verdict: GateVerdict): DecisionFields {
  const outcome = { admitted: "admit", refused: "refuse", unstructured: "unstructured" } as const;
  const defaultReason = {
    admitted: "admit",
    refused: "indeterminate",
    unstructured: "no-structured-content",
  };
  return {
    direction: "in",
    outcome: outcome[verdict.outcome],
    reason: auditGateReason(verdict.reason ?? defaultReason[verdict.outcome]),
    messageDigest: verdict.digest,
  };
}

export function outboundAuditDecision(
  proposal: ActionProposal,
  result: ProposalRelease,
): DecisionFields {
  return {
    direction: "out",
    outcome: result.ok ? "go" : result.reason === "ask-principal" ? "ask-principal" : "stop",
    reason: result.ok ? "go" : auditGateReason(result.reason),
    messageDigest: result.ok ? digestBytes(result.renderable.compactJws) : digestOf(proposal),
  };
}
const time = z.iso.datetime();
const finalFields = { time, transaction: z.uuid().optional() };
const storedVerdict = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("checking"), time }),
  z.strictObject({
    outcome: z.literal("admitted"),
    verified: z.literal(true).optional(),
    admissionReceipt: z.uuid().optional(),
    messageId: z.string(),
    conversation: z.string(),
    ...finalFields,
  }),
  z.strictObject({ outcome: z.literal("unstructured"), ...finalFields }),
  z.strictObject({ outcome: z.literal("refused"), reason: reasonCode, ...finalFields }),
]);
export type StoredVerdict = z.infer<typeof storedVerdict>;
type Decision =
  | { outcome: "admitted"; messageId: string; conversation: string }
  | { outcome: "unstructured" }
  | { outcome: "refused"; reason: string };
type VerdictStore = {
  get(hex: string): Promise<StoredVerdict | undefined>;
  put(
    hex: string,
    verdict: StoredVerdict,
    prepare?: (digest: string) => Promise<void>,
  ): Promise<void>;
  digests(): Promise<string[]>;
};

function fileVerdicts(directory: string): VerdictStore {
  return {
    async get(hex) {
      const text = await readPrivate(join(directory, `verdict-${hex}.json`));
      if (text === undefined) return undefined;
      const verdict = storedVerdict.parse(JSON.parse(text));
      if (verdict.outcome === "checking") return verdict;
      const { transaction, ...decision } = verdict;
      const commit = await readPrivate(join(directory, `verdict-${hex}.commit`));
      if (transaction && commit === digestBytes(text)) {
        const confirmed = await readPrivate(join(directory, `verdict-${hex}.confirmed`));
        if (confirmed === commit) return decision;
      }
      return { outcome: "checking", time: verdict.time };
    },
    async put(hex, verdict, prepare) {
      const name = `verdict-${hex}.json`;
      if (verdict.outcome === "checking") {
        await writePrivate(directory, name, JSON.stringify(verdict));
        return;
      }
      const record = JSON.stringify({ ...verdict, transaction: randomUUID() });
      const digest = digestBytes(record);
      await prepare?.(digest);
      const staged = `verdict-${hex}.prepared`;
      await writePrivate(directory, staged, digest);
      await writePrivate(directory, name, record);
      // Publish proof only after both writes have completed their directory syncs.
      const commit = join(directory, `verdict-${hex}.commit`);
      await rename(join(directory, staged), commit);
      try {
        await syncDirectory(directory);
        // A surviving commit alone cannot prove that its directory sync succeeded.
        await writePrivate(directory, `verdict-${hex}.confirmed`, digest);
      } catch (error) {
        await unlink(commit)
          .then(() => syncDirectory(directory))
          .catch(() => {});
        throw error;
      }
    },
    async digests() {
      return (await readdir(directory)).flatMap((name) => filePattern.exec(name)?.[1] ?? []).sort();
    },
  };
}

function collectCarriers(message: BridgeMessage) {
  const copies = new Set<string>();
  for (const block of message.jsonLdBlocks ?? []) {
    try {
      copies.add(readEnvelope(block).compactJws);
    } catch {
      if (block.includes('"agent:SignedMessage"')) {
        return {
          copies,
          failure: Buffer.byteLength(block) > DIRECT.maxBytes ? "bounds-exceeded" : "malformed",
        };
      }
    }
  }
  return { copies, failure: copies.size > 1 ? "conflicting-structured-copies" : undefined };
}

function refused(reason: string): Extract<Decision, { outcome: "refused" }> {
  return { outcome: "refused", reason };
}

function refusalReason(previous: StoredVerdict | undefined) {
  if (previous?.outcome === "checking") return "result-uncertain";
  if (previous?.outcome === "refused") return previous.reason;
}

function inboundDecision(step: StepResult): Decision {
  switch (step.disposition) {
    case "accepted":
      if (step.reason) return refused(reasonCode.safeParse(step.reason).data ?? "indeterminate");
      if (step.admitted === true && step.messageId && step.conversation)
        return { outcome: "admitted", messageId: step.messageId, conversation: step.conversation };
      return refused("indeterminate");
    case "rejected":
      return refused(reasonCode.safeParse(step.reason).data ?? "indeterminate");
    case "pending-approval":
      return refused("ask-principal");
    case "duplicate":
      return refused("replay-conflict");
    default:
      return refused("indeterminate");
  }
}

type GateRuntime = Pick<
  AgentRuntime,
  | "identity"
  | "receive"
  | "commitBindingEvent"
  | "admittedFacts"
  | "publicKeys"
  | "recordHead"
  | "witnessRecordHead"
  | "close"
>;
type RecordHead = ReturnType<GateRuntime["recordHead"]>;
const decisionType = "suite-gate-decision";

function persistDecision(
  rt: GateRuntime,
  { binding, fields, replayKey, transaction }: PendingDecision,
) {
  return rt.commitBindingEvent({
    type: decisionType,
    binding,
    ...fields,
    ...(replayKey && { replayKey }),
    transaction,
  });
}

async function clearPendingDecision(directory: string) {
  await unlink(join(directory, pendingDecisionName));
  await syncDirectory(directory);
}

async function decisionCompleted(directory: string, completion: DecisionCompletion) {
  if (!completion) return true;
  if (completion.type === "release") {
    const receipt = await readPrivate(join(directory, completion.name));
    return receipt !== undefined && digestBytes(receipt) === completion.digest;
  }
  const base = join(directory, `verdict-${completion.hex}`);
  const verdict = await readPrivate(`${base}.json`);
  return (
    verdict !== undefined &&
    digestBytes(verdict) === completion.digest &&
    (await readPrivate(`${base}.commit`)) === completion.digest &&
    (await readPrivate(`${base}.confirmed`)) === completion.digest
  );
}

async function openDecisionJournal(directory: string) {
  const journal = join(directory, "decision-journal");
  await mkdir(journal, { mode: 0o700, recursive: true });
  const stat = await lstat(journal);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.())
    throw new Error("Unsafe gate decision journal");
  await syncDirectory(directory);
  return journal;
}

async function recoverDecision(
  rt: GateRuntime,
  ledger: FileLedger,
  directory: string,
  journal: string,
) {
  const text = await readPrivate(join(journal, pendingDecisionName));
  if (text === undefined) return;
  const decision = pendingDecisionSchema.parse(JSON.parse(text));
  const committed = ledger
    .entries()
    .some(
      ({ record }) => record.type === decisionType && record.transaction === decision.transaction,
    );
  // A crash can leave the journal on either side of the ledger checkpoint.
  if (!committed && (await decisionCompleted(directory, decision.completion)))
    await persistDecision(rt, decision);
  await clearPendingDecision(journal);
}

type ReferenceEntries = Parameters<typeof verifyLedger>[0];
const witnessSeq = z.number().int().positive();
function gateWitnesses(entries: ReferenceEntries, { actor, party }: Partial<GateIdentity>) {
  return entries.flatMap(({ record }) => {
    if (record.type !== "record-anchor-receipt" || record.actor !== actor || record.party !== party)
      return [];
    return [
      {
        seq: witnessSeq.parse(record.seq),
        hash: decisionDigest.parse(record.hash),
      },
    ];
  });
}

export async function validAnchorSignature(
  jws: string,
  { kid, alg, publicJwk }: Pick<SigningKey, "kid" | "alg" | "publicJwk">,
) {
  const result = await verifyCompact(jws, {
    resolve: (id) => (id === kid ? { kid, alg, publicJwk } : undefined),
    typ: "awp-record-anchor+jws",
    allowedAlgs: ["EdDSA"],
    limits: { ...DEFAULT_LIMITS, maxEnvelopeBytes: MAX_RECORD_ANCHOR_BYTES },
  });
  return result.outcome === "valid";
}

function assertAnchorSize(jws: string): void {
  // Compact JWS is ASCII, so each character is one byte.
  if (jws.length > MAX_RECORD_ANCHOR_BYTES) throw new Error("Record anchor exceeds size bound");
}

export function createGate(
  rt: GateRuntime,
  verdicts: VerdictStore,
  ledger: { entries(): Parameters<typeof verifyLedger>[0] },
  peers: readonly { subject: string; thumbprint: string }[],
  now: () => Date,
  admittedReceipts = new Set<string>(),
  outbound?: Awaited<ReturnType<typeof createOutboundGate>>,
  durable?: { journal: string },
) {
  let pending: Promise<unknown> = Promise.resolve();
  let closed = false;
  let releaseAudit: ReleaseAudit | undefined;
  let decisionFault: { error: unknown } | undefined;
  const recorded = new Map<string, string>();
  for (const { record } of ledger.entries()) {
    if (record.type === decisionType && typeof record.replayKey === "string")
      recorded.set(record.replayKey, digestOf(decisionFields.parse(record)));
  }

  function decisionWriter(binding: string, replayKey?: string) {
    const key = replayKey === undefined ? undefined : decisionDigest.parse(replayKey);
    let staged: PendingDecision | undefined;
    let stagedFingerprint: string | undefined;
    async function prepare(fields: DecisionFields, completion?: DecisionCompletion) {
      if (!durable) return;
      const fingerprint = digestOf(fields);
      if (
        stagedFingerprint === fingerprint ||
        (!staged && key && recorded.get(key) === fingerprint)
      )
        return;
      const decision = { binding, fields, replayKey: key, transaction: randomUUID(), completion };
      await writePrivate(durable.journal, pendingDecisionName, JSON.stringify(decision));
      staged = decision;
      stagedFingerprint = fingerprint;
    }
    async function commit(fields: DecisionFields) {
      const fingerprint = digestOf(fields);
      try {
        if (!key || recorded.get(key) !== fingerprint) {
          await prepare(fields);
          await persistDecision(
            rt,
            staged ?? { binding, fields, replayKey: key, transaction: randomUUID() },
          );
          if (key) recorded.set(key, fingerprint);
        }
        if (staged && durable) await clearPendingDecision(durable.journal);
      } catch (error) {
        decisionFault = { error };
        throw error;
      }
    }
    return { prepare, commit };
  }

  async function checked(input: CheckInput | ParseRefusalInput) {
    const writer = decisionWriter(input.binding, input.replayKey);
    const verdict = await check(input, (verdict, completion) =>
      writer.prepare(inboundAuditDecision(verdict), completion),
    );
    await writer.commit(inboundAuditDecision(verdict));
    return verdict;
  }

  async function check(
    input: CheckInput | ParseRefusalInput,
    prepare: (verdict: GateVerdict, completion: DecisionCompletion) => Promise<void>,
  ): Promise<GateVerdict> {
    const { binding, account } = input;
    const message = "message" in input ? input.message : undefined;
    const digest =
      "message" in input
        ? `sha-256:${input.message.rawSha256}`
        : "raw" in input
          ? digestBytes(input.raw)
          : input.digest;
    const validDigest = /^sha-256:[a-f0-9]{64}$/.test(digest);
    const hex = digest.slice(8);
    const event = (type: string, reason: string) =>
      rt.commitBindingEvent({ type, binding, ...(validDigest ? { digest } : {}), reason });
    try {
      if (!validDigest) throw new Error("Invalid raw digest");
      const accountKey = `${hex}-${digestBytes(account).slice(8)}`;
      const previous = await verdicts.get(hex);
      const priorRefusal = refusalReason(previous) ?? refusalReason(await verdicts.get(accountKey));
      if (priorRefusal) {
        await prepare({ ...refused(priorRefusal), digest }, undefined);
        await event("binding-rejection", priorRefusal);
        return { ...refused(priorRefusal), digest };
      }
      const carrier = message && collectCarriers(message);
      const jws = carrier?.copies.values().next().value;
      const failure = "reason" in input ? input.reason : carrier?.failure;
      const parityMismatch =
        jws !== undefined && message?.warnings.includes("human-parity-unverified");
      if (!failure && !parityMismatch && jws !== undefined && previous?.outcome === "admitted") {
        const verdict = {
          outcome: "admitted",
          messageId: previous.messageId,
          conversation: previous.conversation,
          digest,
        } as const;
        await prepare(verdict, undefined);
        await event("channel-observation", "cached-verdict");
        return verdict;
      }
      if (!failure && jws === undefined && previous) {
        await prepare({ outcome: "unstructured", digest }, undefined);
        await event("channel-observation", "no-structured-content");
        return { outcome: "unstructured", digest };
      }
      const key =
        failure === "human-parity-mismatch" ||
        (!failure && parityMismatch) ||
        (failure && previous?.outcome === "admitted")
          ? accountKey
          : hex;
      await verdicts.put(key, { outcome: "checking", time: now().toISOString() });
      const admissionReceipt = randomUUID();
      let decision: Decision;
      if (failure) {
        await event("binding-rejection", failure);
        decision = refused(failure);
      } else if (jws === undefined) {
        await event("channel-observation", "no-structured-content");
        decision = { outcome: "unstructured" };
      } else if (parityMismatch && previous?.outcome === "admitted") {
        await event("binding-rejection", "human-parity-mismatch");
        decision = refused("human-parity-mismatch");
      } else {
        decision = inboundDecision(
          await rt.receive(
            { format: "awp-jws-compact/0.1", jws },
            {
              binding,
              admissionReceipt,
              checkEmailParity: () =>
                parityMismatch
                  ? "The readable channel copy does not match the structured message."
                  : undefined,
            },
          ),
        );
      }
      await verdicts.put(
        key,
        {
          ...decision,
          time: now().toISOString(),
          ...(decision.outcome === "admitted" && { admissionReceipt }),
        },
        (hash) => prepare({ ...decision, digest }, { type: "verdict", hex: key, digest: hash }),
      );
      if (decision.outcome === "admitted") admittedReceipts.add(admissionReceipt);
      return { ...decision, digest };
    } catch {
      try {
        await event("binding-rejection", "indeterminate");
      } catch {
        throw new Error("Inbound gate could not record the check");
      }
      return { ...refused("indeterminate"), digest };
    }
  }
  function enqueue<T>(work: () => T | Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error("Agent gate is closed"));
    const result = pending.then(() => {
      if (decisionFault) throw decisionFault.error;
      return work();
    });
    pending = result.catch(() => undefined);
    return result;
  }
  async function verifyAnchor(record: Extract<AuditRecord, { type: "record-anchor" }>) {
    const { actor, party } = rt.identity;
    const key = rt.publicKeys().find(({ alg }) => alg === "EdDSA");
    return (
      !!key &&
      record.agent === actor &&
      record.owner === party &&
      (await validAnchorSignature(record.jws, key))
    );
  }
  return {
    check: (input: CheckInput) => enqueue(() => checked(input)),
    recordParseRefusal: (input: ParseRefusalInput) => enqueue(() => checked(input)),
    release(proposal: ActionProposal) {
      const audit = releaseAudit;
      return enqueue<ProposalRelease>(async () => {
        if (audit && audit.proposalDigest !== digestOf(proposal))
          throw new Error("Outbox gate release mismatch");
        const writer = decisionWriter(
          "suite-outbound",
          digestOf({ proposal: proposal.id, direction: "out" }),
        );
        const fields = (result: ProposalRelease) => ({
          ...outboundAuditDecision(proposal, result),
          ...audit?.task,
        });
        const result = (await outbound
          ?.release(proposal, (result, name, digest) =>
            writer.prepare(fields(result), { type: "release", name, digest }),
          )
          .catch((error) => {
            decisionFault = { error };
            throw error;
          })) ?? {
          ok: false,
          reason: "unsupported-operation",
        };
        await writer.commit(fields(result));
        await audit?.record(result);
        return result;
      });
    },
    setReleaseAudit(audit: ReleaseAudit | undefined) {
      releaseAudit = audit;
    },
    decisions(after: number) {
      return committedEntries().flatMap(({ seq, hash, record }) =>
        seq > after && record.type === decisionType
          ? [{ ...decisionFields.parse(record), gateSeq: seq, gateHash: hash }]
          : [],
      );
    },
    evidence() {
      const entries = ledger.entries();
      const head = entries.length ? rt.recordHead() : LEDGER_GENESIS;
      return gateEvidence(entries, rt.identity, checkGateLedger(entries, head).prunedThroughSeq);
    },
    verifyAnchor,
    recoverAnchor: (record: Extract<AuditRecord, { type: "record-anchor" }>) =>
      enqueue(async () => {
        const { actor, party } = rt.identity;
        if (!party || !(await verifyAnchor(record)))
          throw new Error("Cannot witness an invalid audit anchor");
        if (
          gateWitnesses(committedEntries(), rt.identity).some(
            ({ seq, hash }) => seq === record.seq && hash === record.hash,
          )
        )
          return;
        await rt.witnessRecordHead({ actor, party, seq: record.seq, hash: record.hash });
      }),
    head(): RecordHead {
      return rt.recordHead();
    },
    anchor: (head: RecordHead, publish?: PublishAnchor) =>
      enqueue(async () => {
        const { actor, party } = rt.identity;
        if (!party) throw new Error("record signing key unavailable");
        return (
          await rt.witnessRecordHead(
            { actor, party, seq: head.seq, hash: head.hash },
            [],
            async (jws) => {
              assertAnchorSize(jws);
              await publish?.(jws);
            },
          )
        ).jws;
      }),
    verifyOwn: (compactJws: string, expected: ProposalContext | undefined) =>
      enqueue(() => {
        if (!outbound) throw new Error("Outbound gate is not configured");
        return outbound.verifyOwn(compactJws, expected);
      }),
    facts() {
      if (closed) throw new Error("Inbound gate is closed");
      return rt
        .admittedFacts({
          includeSuperseded: true,
          isAdmittedReceipt: (receipt) => admittedReceipts.has(receipt),
        })
        .map(({ admittingDelivery: _delivery, ...fact }) => fact);
    },
    async status() {
      await pending;
      return gateStatus(verdicts, ledger, peers);
    },
    async close() {
      closed = true;
      await pending;
      rt.close();
    },
  };

  function committedEntries() {
    const entries = ledger.entries();
    const last = entries.at(-1);
    if (last && rt.recordHead().hash !== last.hash)
      throw new Error("Gate ledger changed while reading decisions");
    return entries;
  }
}

export type Gate = ReturnType<typeof createGate>;

export async function readGate(directory: string) {
  const path = resolve(directory);
  const stat = await lstat(path);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.())
    throw new Error("Unsafe gate directory");
  const stored = await readAgent(dirname(path), basename(path));
  if (stored.ownerCustody !== "separate") throw new Error("Unsafe gate owner custody");
  return stored;
}

function checkGateLedger(entries: ReferenceEntries, head: LedgerHead) {
  const check = verifyLedgerAtHead(entries, head);
  if (!check.ok) throw new Error("Inbound gate ledger failed verification");
  return check;
}

function gateEvidence(
  entries: ReferenceEntries,
  identity: Partial<GateIdentity>,
  gatePrunedThroughSeq: number | undefined,
) {
  return {
    gateEntries: entries.map(({ seq, hash }) => ({ seq, hash })),
    gatePrunedThroughSeq,
    witnessedHeads: gateWitnesses(entries, identity),
  };
}

function savedGateLedger(ledger: FileLedger, saved: LedgerHead | undefined) {
  const rows = ledger.entries();
  const head = saved ?? LEDGER_GENESIS;
  const cutoff =
    saved && ledger.head().seq > saved.seq ? rows.findIndex(({ seq }) => seq > saved.seq) : -1;
  if (cutoff >= 0 && rows.slice(cutoff).some(({ seq }) => seq <= head.seq))
    throw new Error("Uncommitted gate rows precede the saved head");
  const entries = cutoff < 0 ? rows : rows.slice(0, cutoff);
  return { entries, check: checkGateLedger(entries, head), hasSuffix: cutoff >= 0 };
}

/** Read the saved gate prefix without taking the runtime lock or rolling back the files. */
export async function readSavedGateEvidence(directory: string, identity: Partial<GateIdentity>) {
  const saved = readRuntimeStateFile(join(directory, "state.json")).ledgerAuditHead;
  const { entries, check } = savedGateLedger(
    new FileLedger(join(directory, "ledger.jsonl")),
    saved,
  );
  return gateEvidence(entries, identity, check.prunedThroughSeq);
}

function pinnedPeers(data: TrustStoreData) {
  return data.keys
    .filter(({ role, subject }) => role === "actor" || (role === "party" && subject !== data.owner))
    .map(({ subject, kid }) => ({ subject, thumbprint: kid }));
}

async function gateStatus(
  verdicts: VerdictStore,
  ledger: { entries(): Parameters<typeof verifyLedger>[0] },
  peers: readonly { subject: string; thumbprint: string }[],
) {
  const counts = { admitted: 0, unstructured: 0, refused: 0 };
  const uncertainDigests = new Set<string>();
  for (const hex of await verdicts.digests()) {
    const verdict = await verdicts.get(hex);
    if (verdict?.outcome === "checking") uncertainDigests.add(`sha-256:${hex.slice(0, 64)}`);
    else if (verdict) counts[verdict.outcome]++;
  }
  return {
    peers,
    ledger: verifyLedger(ledger.entries()),
    verdicts: counts,
    uncertainDigests: [...uncertainDigests],
  };
}

/** Inspect retained public pins, verdict counts and the ledger without opening the runtime. */
export async function readGateStatus(directory: string) {
  const stored = await readGate(directory);
  await TrustStore.load(stored.trust);
  return gateStatus(
    fileVerdicts(stored.dir),
    new FileLedger(join(stored.dir, "ledger.jsonl")),
    pinnedPeers(stored.trust),
  );
}

export async function openGate(options: GateOptions): Promise<Gate> {
  return openStoredGate(await readGate(options.directory), options);
}

async function openStoredGate(
  stored: Awaited<ReturnType<typeof readGate>>,
  options: GateOptions,
): Promise<Gate> {
  const { now = () => new Date(), admission, outbound } = options;
  const { actor, party } = stored.identity;
  if (!party || stored.actorKey.alg !== "EdDSA") throw new Error("record signing key unavailable");
  // Prove that the largest safe-integer sequence and ISO timestamp fit for these exact identities.
  assertAnchorSize(
    await signCompact(stored.actorKey, "awp-record-anchor+jws", {
      type: "RecordAnchorReceipt",
      actor,
      party,
      subject: actor,
      subjectParty: party,
      seq: Number.MAX_SAFE_INTEGER,
      hash: digestBytes("anchor size check"),
      at: "+275760-09-13T00:00:00.000Z",
    }),
  );
  const { runtime, ledger } = await openRuntime(stored, options);
  try {
    const journal = await openDecisionJournal(stored.dir);
    await recoverDecision(runtime, ledger, stored.dir, journal);
    const verdicts = fileVerdicts(stored.dir);
    const admittedReceipts = new Set<string>();
    if (admission) {
      for (const hex of await verdicts.digests()) {
        const verdict = await verdicts.get(hex);
        if (verdict?.outcome === "admitted" && verdict.admissionReceipt)
          admittedReceipts.add(verdict.admissionReceipt);
      }
    }
    const outboundGate = outbound && (await createOutboundGate(runtime, stored.dir, outbound));
    return createGate(
      runtime,
      verdicts,
      ledger,
      pinnedPeers(stored.trust),
      now,
      admittedReceipts,
      outboundGate,
      { journal },
    );
  } catch (error) {
    runtime.close();
    throw error;
  }
}

async function openRuntime(
  stored: Awaited<ReturnType<typeof readGate>>,
  { now = () => new Date(), admission, outbound }: GateOptions,
) {
  const trust = await TrustStore.load(stored.trust);
  const store = new FileStateStore(join(stored.dir, "state.json"));
  try {
    const ledger = new FileLedger(join(stored.dir, "ledger.jsonl"));
    const saved = store.load().ledgerAuditHead;
    // Verify the same saved prefix that the offline auditor uses before rolling back writes.
    if (savedGateLedger(ledger, saved).hasSuffix && saved) ledger.recoverUncommittedSuffix(saved);
    const runtime = await AgentRuntime.create({
      identity: stored.identity,
      actorKeys: [stored.actorKey],
      trust,
      mandateJws: stored.mandateJws,
      representationJws: stored.representationJws,
      accepted: [CONFIG_ED25519],
      handlers: [...new Set([...(admission?.handlers ?? []), ...(outbound?.handlers ?? [])])],
      ...(admission && { gates: { taskId: admission.taskId, reliance: admission.reliance } }),
      store,
      ledger,
      now,
    });
    return { runtime, ledger };
  } catch (error) {
    store.close();
    throw error;
  }
}

/** The operator holds the daemon process lease while replacing an owner-signed mandate. */
export async function installGateMandate(options: {
  directory: string;
  path: string;
  now?: () => Date;
  identity?: GateIdentity;
}): Promise<void> {
  const file = await open(
    options.path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let jws: string;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > DEFAULT_LIMITS.maxEnvelopeBytes)
      throw new Error("Invalid gate mandate file");
    const bytes = Buffer.alloc(DEFAULT_LIMITS.maxEnvelopeBytes + 1);
    const { bytesRead } = await file.read(bytes);
    if (bytesRead !== stat.size) throw new Error("Gate mandate file changed while reading");
    jws = bytes.subarray(0, bytesRead).toString("utf8").trim();
  } finally {
    await file.close();
  }
  const stored = await readGate(options.directory);
  if (
    options.identity &&
    (stored.identity.actor !== options.identity.actor ||
      stored.identity.party !== options.identity.party)
  )
    throw new Error("Gate identity does not match daemon configuration");
  const { runtime } = await openRuntime(stored, options);
  try {
    await runtime.reloadMandate(jws);
    if (!runtime.activeMandateDigest()) throw new Error("Gate mandate was refused");
    await writePrivate(stored.dir, "mandate.jws", jws);
  } finally {
    runtime.close();
  }
}

/** The daemon opens the durable gate under its existing process lease. */
export function createInboundGate(
  options: GateOptions,
): InboundGatePort &
  Required<Pick<InboundGatePort, "open">> &
  Pick<Gate, "facts" | "verifyOwn" | "release"> {
  let active: Gate | undefined;
  return {
    async check() {
      throw new Error("Inbound gate requires an active daemon lease");
    },
    facts() {
      if (!active) throw new Error("Inbound gate requires an active daemon lease");
      return active.facts();
    },
    async release(proposal) {
      if (!active) throw new Error("Outbound gate requires an active daemon lease");
      return active.release(proposal);
    },
    async verifyOwn(compactJws, expected) {
      if (!active) throw new Error("Outbound gate requires an active daemon lease");
      return active.verifyOwn(compactJws, expected);
    },
    async open(identity) {
      const stored = await readGate(options.directory);
      if (stored.identity.actor !== identity.actor || stored.identity.party !== identity.party)
        throw new Error("Inbound gate identity does not match daemon configuration");
      const gate = await openStoredGate(stored, options);
      active = gate;
      return {
        ...gate,
        async close() {
          try {
            await gate.close();
          } finally {
            if (active === gate) active = undefined;
          }
        },
      };
    },
  };
}
