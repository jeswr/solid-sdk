// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReasonCode } from "@jeswr/agent-model";
import type { ChannelCapability } from "./capability.js";
import type { InboundRawMessage } from "./channel.js";
import type { BridgeMessage } from "./message.js";
import type {
  AccountRef,
  BindingState,
  Bounds,
  Cursor,
  ProviderLookupResult,
  ProviderSendResult,
  RenderableProposal,
  TransmissionIo,
  Wire,
} from "./types.js";

export interface ChannelBinding<Raw = unknown> {
  /** Stable id, lower-case: "gmail" | "graph-mail" | "graph-teams" | "matrix" | "slack" | … */
  readonly id: string;
  /** Carriage profile id advertised to peers, e.g. "email-mime/0.1", "slack-metadata/0.1". */
  readonly carriage: CarriageProfile;
  /** Every network origin this binding may contact. Enforced by the layer lint and by guarded-fetch at runtime. */
  readonly origins: ReadonlySet<string>;
  /** RDF capability descriptor (§3.3). Pure function of static config + credential state. */
  describe(state: BindingState): ChannelCapability;
  /** Ingest half — available to the Reader. Never holds send scopes. */
  readonly ingest: {
    /** Pull new items since `cursor` for one account. Bounded (max items, max bytes). */
    list(
      account: AccountRef,
      cursor: Cursor | undefined,
      limits: Bounds,
    ): Promise<{ items: InboundRawMessage<Raw>[]; next: Cursor }>;
    /** Pure, hostile-input-hardened transform. Throws ChannelParseError to skip one item. */
    parse(item: InboundRawMessage<Raw>): BridgeMessage;
    /** Optional: resolve the thread/room for a BridgeMessage (for conversation stitching). */
    threadKey?(m: BridgeMessage): string | undefined;
  };
  /** Send half — exported ONLY from the "./<id>/send" subpath; importable ONLY by @jeswr/agent-executor. */
  readonly send?: {
    /** Build the exact wire bytes for a proposal. Pure. The digest of `wire` is what the owner approves. */
    render(proposal: RenderableProposal, carriage: CarriageProfile): Promise<Wire>;
    /** Re-derive and check `wire` from the proposal (defence against a tampered outbox entry). */
    validate(
      wire: Wire,
      proposal: RenderableProposal,
    ): Promise<{ ok: true } | { ok: false; reason: ReasonCode }>;
    /** Transmit. Throws ProviderRejectedError when the provider definitively refused. */
    transmit(wire: Wire, io: TransmissionIo): Promise<ProviderSendResult>;
    /** Positive-evidence lookup for an uncertain send (§4.3). */
    lookup?(wire: Wire): Promise<ProviderLookupResult>;
    /** Whether `lookup` absence is causally final (A2A loopback: yes; mail providers: never). */
    readonly finalAbsence?: true;
  };
}
export interface CarriageProfile {
  readonly id: string; // "email-mime/0.1" …
  readonly structured:
    | "mime-part"
    | "metadata-field"
    | "event-content"
    | "footer-url-only"
    | "native";
  readonly envelopeMediaType?: string; // "application/ld+json" for the signed envelope where carried
  readonly footer: "required" | "optional" | "none";
  readonly maxBytes: number; // channel message limit the renderer must respect
}
