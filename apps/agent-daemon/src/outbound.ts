// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6
import type { ProposalContext } from "@jeswr/agent-channels";
import type { ProposalRelease } from "@jeswr/agent-executor";
import {
  type ActionProposal,
  type AnyMessage,
  canonicalJson,
  digestBytes,
  digestOf,
  validateMessage,
} from "@jeswr/agent-model";
import type { AgentRuntime, OperationHandler, OutboundMessage } from "@jeswr/agent-reference";
import type { OutboundPlan } from "@jeswr/agent-reference/runtime/operations";
import { readdir } from "fs/promises";
import { join } from "path";
import { z } from "zod";
import { readPrivate, writePrivate } from "./local.js";

/** Host code maps a draft to an installed operation and binds its exact action and recipient. */
export interface OutboundMapping {
  readonly handlers: readonly OperationHandler[];
  plan(proposal: ActionProposal): { conversation: string; plan: OutboundPlan } | undefined;
}

const digest = z.string().regex(/^sha-256:[a-f0-9]{64}$/);
const receiptSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("checking"), proposal: digest }),
  z.strictObject({
    state: z.literal("refused"),
    proposal: digest,
    reason: z.string().min(1).max(1024),
  }),
  z.strictObject({
    state: z.literal("released"),
    proposal: digest,
    id: z.string(),
    conversation: z.string(),
    wire: digest,
    // Older receipts can be read, but require a fresh runtime release.
    mandate: digest.optional(),
  }),
]);
type Receipt = z.infer<typeof receiptSchema>;
type Released = Extract<Receipt, { state: "released" }>;
type Runtime = Pick<
  AgentRuntime,
  "activeMandateDigest" | "sendMessage" | "outboundVerifier" | "outboxMessages"
>;

function refused(reason: string): Extract<ProposalRelease, { ok: false }> {
  return { ok: false, reason };
}

function receiptName(proposalId: string): string {
  return `release-${digestOf(proposalId).slice(8)}.json`;
}

export async function createOutboundGate(rt: Runtime, directory: string, mapping: OutboundMapping) {
  const receipts = new Map<string, Receipt>();
  for (const name of await readdir(directory)) {
    if (!/^release-[a-f0-9]{64}\.json$/.test(name)) continue;
    const text = await readPrivate(join(directory, name));
    if (text === undefined) throw new Error("Missing gate release receipt");
    const receipt = receiptSchema.parse(JSON.parse(text));
    receipts.set(name, receipt);
  }

  function findMessage(receipt: Released): OutboundMessage {
    const retained = rt.outboxMessages(receipt.conversation).find(({ id }) => id === receipt.id);
    if (
      retained?.wire.format !== "awp-jws-compact/0.1" ||
      digestBytes(retained.wire.jws) !== receipt.wire
    )
      throw new Error("Released envelope is missing from the gate outbox");
    return retained;
  }

  async function verifyOwn(
    compactJws: string,
    expected: ProposalContext | undefined,
  ): Promise<AnyMessage> {
    const signed = await rt.outboundVerifier().verifyOwnEnvelope(compactJws);
    if (!signed.ok) throw new Error("Invalid gate envelope signature");
    const receipt = expected && receipts.get(receiptName(expected.proposalId));
    if (
      receipt?.state !== "released" ||
      receipt.conversation !== expected?.conversation ||
      receipt.id !== signed.messageId ||
      receipt.wire !== digestBytes(compactJws) ||
      receipt.mandate === undefined ||
      receipt.mandate !== rt.activeMandateDigest()
    )
      throw new Error(
        "Envelope was not released for this proposal and conversation under the active mandate",
      );
    const retained = findMessage(receipt);
    if (retained.wire.format !== "awp-jws-compact/0.1" || retained.wire.jws !== compactJws)
      throw new Error("Envelope does not match gate release");
    const checked = validateMessage(retained.message);
    if (!checked.ok || checked.message.conversation !== receipt.conversation)
      throw new Error("Unsupported suite message or mismatched conversation");
    return checked.message;
  }

  async function writeReceipt(
    name: string,
    receipt: Receipt,
    prepare?: (digest: string) => Promise<void> | undefined,
  ) {
    const text = canonicalJson(receipt);
    await prepare?.(digestBytes(text));
    await writePrivate(directory, name, text);
    receipts.set(name, receipt);
  }

  return {
    verifyOwn,
    async release(
      proposal: ActionProposal,
      prepare?: (result: ProposalRelease, name: string, digest: string) => Promise<void>,
    ): Promise<ProposalRelease> {
      const mapped = mapping.plan(proposal);
      if (!mapped) return refused("unsupported-operation");
      const { conversation } = mapped;
      const { intent, ...messagePlan } = structuredClone(mapped.plan);
      if (!intent) return refused("unsupported-operation");
      const plan = { ...messagePlan, intent };
      if (
        conversation !== proposal.intent.conversation ||
        intent.conversation !== conversation ||
        intent.operation !== proposal.intent.operation ||
        intent.target !== proposal.intent.target ||
        intent.purpose !== proposal.intent.purpose ||
        !intent.recipient ||
        (plan.body.purpose !== undefined && plan.body.purpose !== intent.purpose) ||
        (plan.kind !== "receipt" &&
          canonicalJson(plan.body.operation ?? null) !==
            canonicalJson({
              id: proposal.intent.operation,
              version: proposal.intent.operationVersion,
            }))
      )
        return refused("terms-digest-mismatch");

      // The projector replaces only the preview and terms digest. They are not draft identity.
      const { termsDigest: _digest, ...draftIntent } = proposal.intent;
      const { renderedPreview: _preview, ...draft } = proposal;
      const proposalDigest = digestOf({ ...draft, intent: draftIntent, plan });
      const name = receiptName(proposal.id);
      const previous = receipts.get(name);
      if (previous) {
        if (previous.proposal !== proposalDigest) return refused("proposal-conflict");
        if (previous.state === "checking") return refused("result-uncertain");
        if (previous.state === "refused") return refused(previous.reason);
        if (previous.mandate !== undefined && previous.mandate === rt.activeMandateDigest())
          return render(findMessage(previous));
      }

      // An interrupted or indeterminate release cannot cause a second signature on retry.
      await writeReceipt(name, { state: "checking", proposal: proposalDigest });
      const mandate = rt.activeMandateDigest();
      const step = await rt.sendMessage(conversation, plan, { compactJws: true });
      async function recordRefusal(reason: string) {
        const result = refused(reason);
        await writeReceipt(name, { state: "refused", proposal: proposalDigest, reason }, (digest) =>
          prepare?.(result, name, digest),
        );
        return result;
      }
      const [out] = step.outbound;
      if (step.disposition !== "local" || step.outbound.length !== 1 || !out)
        return recordRefusal(
          step.disposition === "pending-approval"
            ? "ask-principal"
            : (step.reason ?? step.decisions.at(-1)?.reason ?? "indeterminate"),
        );
      if (mandate === undefined || mandate !== rt.activeMandateDigest())
        return recordRefusal("mandate-invalid");
      const result = render(out);
      if (!result.ok) return recordRefusal(result.reason);
      await writeReceipt(
        name,
        {
          state: "released",
          proposal: proposalDigest,
          conversation: out.conversation,
          id: out.id,
          wire: digestBytes(result.renderable.compactJws),
          mandate,
        },
        (digest) => prepare?.(result, name, digest),
      );
      return result;
    },
  };
}

function render(out: OutboundMessage): ProposalRelease {
  if (out.wire.format !== "awp-jws-compact/0.1") return refused("unsupported-configuration");
  const checked = validateMessage(out.message);
  if (!checked.ok) return refused(checked.reason);
  const message = checked.message;
  const { body } = message;
  const preview = canonicalJson({
    kind: message.kind,
    ...("operation" in body && { operation: body.operation.id }),
    ...(message.to?.party !== undefined && { recipient: message.to.party }),
    ...("purpose" in body && body.purpose !== undefined && { purpose: body.purpose }),
    terms: body,
    ...(out.message.content && {
      contentDigests: out.message.content.map(({ digest }) => digest),
    }),
  });
  if (preview.length > 16384) return refused("bounds-exceeded");
  return { ok: true, renderable: { message, compactJws: out.wire.jws }, preview };
}
