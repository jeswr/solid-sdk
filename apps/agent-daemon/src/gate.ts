// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.2 Sol
import {
  type BridgeMessage,
  type ChannelParseRefusalReason,
  DIRECT,
  readEnvelope,
} from "@jeswr/agent-channels";
import { digestBytes } from "@jeswr/agent-model";
import {
  AgentRuntime,
  type AgentRuntimeOptions,
  CONFIG_ED25519,
  FileLedger,
  FileStateStore,
  readAgent,
  type StepResult,
  TrustStore,
  type TrustStoreData,
  verifyLedger,
} from "@jeswr/agent-reference";
import { randomUUID } from "crypto";
import { lstat, readdir, rename, unlink } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import { z } from "zod";
import { readPrivate, syncDirectory, writePrivate } from "./local.js";

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
  check(input: { binding: string; account: string; message: BridgeMessage }): Promise<GateVerdict>;
  /** Record a body-free refusal before the daemon can commit the cursor. */
  recordParseRefusal?(input: ParseRefusalInput): Promise<GateVerdict>;
  /** Durable ports open only inside the daemon's process lease. */
  open?(identity: GateIdentity): Promise<Gate>;
}
type CheckInput = Parameters<InboundGatePort["check"]>[0];
export type ParseRefusal = {
  reason: ChannelParseRefusalReason;
} & ({ raw: string | Uint8Array } | { digest: string });
type ParseRefusalInput = { binding: string; account: string } & ParseRefusal;
type GateOptions = {
  directory: string;
  now?: () => Date;
  /** Trusted host configuration for operations that admit evidence into a named task. */
  admission?: Pick<NonNullable<AgentRuntimeOptions["gates"]>, "reliance"> & {
    taskId: string;
    handlers: AgentRuntimeOptions["handlers"];
  };
};
const filePattern = /^verdict-([a-f0-9]{64}(?:-[a-f0-9]{64})?)\.json$/;
const reasonCode = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const time = z.iso.datetime();
const finalFields = { time, transaction: z.uuid().optional() };
const storedVerdict = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("checking"), time }),
  z.strictObject({
    outcome: z.literal("admitted"),
    verified: z.literal(true).optional(),
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
  put(hex: string, verdict: StoredVerdict): Promise<void>;
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
    async put(hex, verdict) {
      const name = `verdict-${hex}.json`;
      if (verdict.outcome === "checking") {
        await writePrivate(directory, name, JSON.stringify(verdict));
        return;
      }
      const record = JSON.stringify({ ...verdict, transaction: randomUUID() });
      const digest = digestBytes(record);
      const staged = `verdict-${hex}.prepared`;
      await writePrivate(directory, staged, digest);
      await writePrivate(directory, name, record);
      // Publish proof only after both writes have completed their directory syncs.
      const commit = join(directory, `verdict-${hex}.commit`);
      await rename(join(directory, staged), commit);
      try {
        await syncDirectory(directory);
      } catch (error) {
        await unlink(commit)
          .then(() => syncDirectory(directory))
          .catch(() => {});
        throw error;
      }
      // A surviving commit alone cannot prove that its directory sync succeeded.
      await writePrivate(directory, `verdict-${hex}.confirmed`, digest);
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

type GateRuntime = Pick<AgentRuntime, "receive" | "commitBindingEvent" | "admittedFacts" | "close">;

export function createGate(
  rt: GateRuntime,
  verdicts: VerdictStore,
  ledger: { entries(): Parameters<typeof verifyLedger>[0] },
  peers: readonly { subject: string; thumbprint: string }[],
  now: () => Date,
) {
  let pending: Promise<unknown> = Promise.resolve();
  let closed = false;
  async function check(input: CheckInput | ParseRefusalInput): Promise<GateVerdict> {
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
        await event("binding-rejection", priorRefusal);
        return { ...refused(priorRefusal), digest };
      }
      const carrier = message && collectCarriers(message);
      const jws = carrier?.copies.values().next().value;
      const failure = "reason" in input ? input.reason : carrier?.failure;
      const parityMismatch =
        jws !== undefined && message?.warnings.includes("human-parity-unverified");
      if (!failure && !parityMismatch && jws !== undefined && previous?.outcome === "admitted") {
        await event("channel-observation", "cached-verdict");
        return {
          outcome: "admitted",
          messageId: previous.messageId,
          conversation: previous.conversation,
          digest,
        };
      }
      if (!failure && jws === undefined && previous) {
        await event("channel-observation", "no-structured-content");
        return { outcome: "unstructured", digest };
      }
      const key =
        failure === "human-parity-mismatch" || (!failure && parityMismatch) ? accountKey : hex;
      const write = (decision: Decision | { outcome: "checking" }) =>
        verdicts.put(key, { ...decision, time: now().toISOString() });
      await write({ outcome: "checking" });
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
              checkEmailParity: () =>
                parityMismatch
                  ? "The readable channel copy does not match the structured message."
                  : undefined,
            },
          ),
        );
      }
      await write(decision);
      return { ...decision, digest };
    } catch {
      try {
        await event("binding-rejection", "indeterminate");
      } catch {
        // A broken ledger cannot turn an indeterminate check into an admission.
      }
      return { ...refused("indeterminate"), digest };
    }
  }
  function enqueue(input: CheckInput | ParseRefusalInput): Promise<GateVerdict> {
    if (closed) return Promise.reject(new Error("Inbound gate is closed"));
    const result = pending.then(() => check(input));
    pending = result.catch(() => undefined);
    return result;
  }
  return {
    check: (input: CheckInput) => enqueue(input),
    recordParseRefusal: (input: ParseRefusalInput) => enqueue(input),
    facts() {
      if (closed) throw new Error("Inbound gate is closed");
      return rt.admittedFacts();
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
  { now = () => new Date(), admission }: GateOptions,
): Promise<Gate> {
  const trust = await TrustStore.load(stored.trust);
  const store = new FileStateStore(join(stored.dir, "state.json"));
  try {
    const ledger = new FileLedger(join(stored.dir, "ledger.jsonl"));
    if (!verifyLedger(ledger.entries()).ok)
      throw new Error("Inbound gate ledger failed verification");
    const runtime = await AgentRuntime.create({
      identity: stored.identity,
      actorKeys: [stored.actorKey],
      trust,
      mandateJws: stored.mandateJws,
      representationJws: stored.representationJws,
      accepted: [CONFIG_ED25519],
      handlers: admission?.handlers ?? [],
      ...(admission && { gates: { taskId: admission.taskId, reliance: admission.reliance } }),
      store,
      ledger,
      now,
    });
    return createGate(runtime, fileVerdicts(stored.dir), ledger, pinnedPeers(stored.trust), now);
  } catch (error) {
    store.close();
    throw error;
  }
}

/** The daemon opens the durable gate under its existing process lease. */
export function createInboundGate(options: GateOptions): InboundGatePort & Pick<Gate, "facts"> {
  let active: Gate | undefined;
  return {
    async check() {
      throw new Error("Inbound gate requires an active daemon lease");
    },
    facts() {
      if (!active) throw new Error("Inbound gate requires an active daemon lease");
      return active.facts();
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
