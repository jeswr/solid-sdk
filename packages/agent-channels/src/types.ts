// AUTHORED-BY Codex GPT-6.1-Sol
import type { AnyMessage, ChannelCapability } from "@jeswr/agent-model";

/** Opaque daemon account reference; never a credential or raw channel handle. */
export interface AccountRef {
  readonly id: string;
}
/** Credential status is descriptive, never authorization to send. */
export type BindingState = ChannelCapability["credentialState"];
/** Opaque, account-scoped pagination token. */
export type Cursor = string;
/** Aggregate byte and item limits for one list call. */
export interface Bounds {
  readonly maxItems: number;
  readonly maxBytes: number;
}
/** An already signed logical message. Verification is injected by the executor. */
export interface RenderableProposal {
  readonly message: AnyMessage;
  readonly compactJws: string;
}
/** Exact wire bytes represented as UTF-8 text, with their content identity. */
export interface Wire {
  readonly bytes: string;
  readonly mediaType: string;
  readonly digest: string;
}
/** A definitive provider acknowledgement, preserving the pilot result vocabulary. */
export type ProviderSendResult =
  | { readonly outcome: "accepted"; readonly providerRef: string }
  | { readonly outcome: "rejected"; readonly detail: string };
/** Positive evidence is required to reconcile an uncertain send. */
export type ProviderLookupResult =
  | { readonly outcome: "found"; readonly providerRef: string }
  | { readonly outcome: "absent" }
  | { readonly outcome: "unknown"; readonly detail: string };
/** No effect occurs unless the executor explicitly enables the injected transport. */
export interface TransmissionIo {
  readonly account: AccountRef;
  readonly tokens: TokenProvider;
  readonly dryRun?: boolean;
}
/** Scope-separated grants, obtained through different provider consent paths. */
export interface ReadGrant {
  readonly access: "read";
  readonly accessToken: string;
}
export interface SendGrant {
  readonly access: "send";
  readonly accessToken: string;
}
/** Read and send must resolve separate grants, even for the same account. */
export interface TokenProvider {
  read(account: AccountRef): Promise<ReadGrant>;
  send(account: AccountRef): Promise<SendGrant>;
}
