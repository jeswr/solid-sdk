/**
 * Agent ROLES: which domain handlers, effect adapters and operator operations one persistent
 * agent directory hosts. A role composes existing domain code; the runtime (state machine,
 * verification, policy, replay, effects) stays generic and identical for every role.
 */
import type { ZodRawShape } from "zod";
import type { Iri } from "../core/types.js";
import type { SlotsClient } from "../domains/conventional/adapter.js";
import type { SyntheticCalendar } from "../domains/scheduling.js";
import type { SigningKey } from "../mechanisms/jws.js";
import type { OwnerMandate } from "../mechanisms/mandate.js";
import type { PolicyEngine } from "../mechanisms/policy-engine.js";
import type { TrustStoreData } from "../mechanisms/trust.js";
import type { AgentRuntime, OutboundMessage } from "../runtime/agent.js";
import type { DisclosureCheck, EffectAdapter, OperationHandler } from "../runtime/operations.js";
import type { ProcessedOutbound } from "../service.js";

export type Json = Record<string, unknown>;

/**
 * One operator operation (an owner/operator-side action, NOT a peer message). Exposed by local
 * interfaces such as MCP. Inputs are validated against `input`; every consequential action it
 * starts is still decided by the runtime (owner mandate, policy module, approvals).
 */
export interface OperatorOperation {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly input?: ZodRawShape;
  readonly readOnly?: boolean;
  run(args: Record<string, unknown>): Promise<Json>;
}

/** What an operation may use: the runtime and read-only views, never keys or trust edits. */
export interface OperationContext {
  readonly rt: AgentRuntime;
  readonly now: () => Date;
  readonly trust: TrustStoreData;
  readonly calendar: SyntheticCalendar;
  /** The pinned peer actor with its pinned party; throws if the actor is not pinned. */
  pinnedPeer(actor: Iri): { actor: Iri; party: Iri };
  /** Prepare reviewed outbound items (kept listable until acknowledged). */
  prepare(outbound: readonly OutboundMessage[]): Promise<ProcessedOutbound[]>;
  show(items: readonly ProcessedOutbound[]): Json[];
}

export interface RoleInstance {
  readonly handlers: OperationHandler[];
  readonly effects: EffectAdapter[];
  operations(ctx: OperationContext): OperatorOperation[];
  /** Role-specific status (payload-free), shown with the generic status. */
  status?(): Json;
  /**
   * Checkers for the disclosure conditions this role's handlers attach to protected deliveries
   * (by kind). The runtime re-evaluates them before every transmission; they must not create
   * effects.
   */
  readonly disclosureChecks?: Readonly<Record<string, DisclosureCheck>>;
}

export interface RoleBuildContext {
  readonly dir: string;
  readonly now: () => Date;
  readonly engine: PolicyEngine;
  readonly party: Iri;
  readonly actor: Iri;
  readonly calendar: SyntheticCalendar;
  readonly clients: ReadonlyMap<string, SlotsClient>;
  readonly wrapEffect: (adapter: EffectAdapter) => EffectAdapter;
  /** The role's own ISSUING key (see RoleDefinition.issuingKey), if it has one. */
  readonly issuerKey?: SigningKey;
  /** The pinned trust data (read-only), e.g. to verify statements presented to an operation. */
  readonly trust: TrustStoreData;
}

/**
 * A statement kind the OWNER may sign for this role with `awp-pilot owner-sign` (outside the
 * service, owner key from --owner-dir). The role builds and validates the exact payload from
 * narrow arguments; there is no free-form signing.
 */
export interface OwnerStatementKind {
  readonly description: string;
  readonly args: ZodRawShape;
  build(
    args: Record<string, unknown>,
    ctx: { party: Iri; actor: Iri; actorKid: string; now: Date },
  ): Json;
}

export interface RoleInitInput {
  readonly trust: TrustStoreData;
  readonly now: Date;
  readonly options: Readonly<Record<string, string | undefined>>;
}

/** Result of local role provisioning, computed BEFORE anything is written. */
export interface RoleInitResult {
  readonly trust: TrustStoreData;
  /** Role files to write into the new agent directory (mode 0600), by file name. */
  readonly files?: Readonly<Record<string, unknown>>;
}

type MandateFactory = (ids: {
  owner: Iri;
  actor: Iri;
  validFrom: string;
  validUntil: string;
}) => OwnerMandate;

export interface RoleDefinition {
  readonly id: string;
  readonly label: string;
  /** True for roles whose institutions, data and outcomes are synthetic fixtures. */
  readonly synthetic: boolean;
  /** Fixed synthetic identity (enterprise roles); personal agents supply their own. */
  readonly identity?: { readonly party: Iri; readonly actor: Iri; readonly operator?: Iri };
  /** Owner mandate factory, or undefined to use the CLI's personal mandate. */
  readonly mandate?: () => MandateFactory;
  readonly representationOperations: readonly Iri[];
  /** Accepted mechanism configurations (default: the signed configuration for the key alg). */
  readonly accepted?: readonly string[];
  /** Role-level inputs `init` accepts (`--role-input key=PATH`), with descriptions. */
  readonly inputs?: Readonly<Record<string, string>>;
  /**
   * The role holds its own ISSUING key (e.g. an access-token issuer, a data-authority issuer),
   * separate from the owner key and the actor key: generated at `init` into the service
   * directory; its public card is printed by `awp-pilot issuer-card` for peers to pin.
   */
  readonly issuingKey?: { readonly subject: Iri; readonly note: string };
  /** Statement kinds the owner may sign for this role (see OwnerStatementKind). */
  readonly ownerStatements?: Readonly<Record<string, OwnerStatementKind>>;
  /**
   * Local provisioning at init (source-authority anchors, wallet): validates the operator's
   * input files and returns the trust data and role files; writes nothing itself.
   */
  init?(input: RoleInitInput): Promise<RoleInitResult>;
  build(ctx: RoleBuildContext): RoleInstance;
}
