// AUTHORED-BY Codex GPT-6
import type { ActionProposal } from "@jeswr/agent-model";
import { proposalTermsDigest } from "./executor.js";
import type { AccountRef, OutboxEntry, RenderableProposal, SendBinding } from "./types.js";

export type ProposalRelease =
  | { readonly ok: true; readonly renderable: RenderableProposal; readonly preview: string }
  | { readonly ok: false; readonly reason: string };

export class ProposalRefusedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ProposalRefusedError";
  }
}

/** Prepare an executor entry without writing to the outbox or requesting approval. */
export function createOutboxProjector(options: {
  readonly bindings: Readonly<Record<string, SendBinding>>;
  /** Trusted outbound account selection, keyed by binding. */
  readonly accounts: Readonly<Record<string, AccountRef>>;
  readonly sign: (proposal: ActionProposal) => Promise<ProposalRelease>;
}): (proposal: ActionProposal) => Promise<OutboxEntry> {
  const bindings = new Map(Object.entries(options.bindings));
  const accounts = new Map(Object.entries(options.accounts));
  return async (proposal) => {
    const id = proposal.intent.binding;
    const binding = bindings.get(id);
    const account = accounts.get(id);
    if (binding?.id !== id || !account) throw new ProposalRefusedError("unsupported-binding");

    const expected = { proposalId: proposal.id, conversation: proposal.intent.conversation };
    const release = await options.sign(proposal);
    if (!release.ok) throw new ProposalRefusedError(release.reason);
    const { renderable, preview } = release;
    const wire = await binding.send.render(renderable, binding.carriage, expected);
    const entry = {
      proposal: { ...proposal, renderedPreview: preview, intent: { ...proposal.intent } },
      renderable,
      account,
      wire,
      wireDigest: wire.digest,
    };
    entry.proposal.intent.termsDigest = proposalTermsDigest(entry);
    return entry;
  };
}
