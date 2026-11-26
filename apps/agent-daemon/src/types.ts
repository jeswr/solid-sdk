// AUTHORED-BY Codex GPT-6.1-Sol
import type { AuditRecord, LedgerEntry } from "@jeswr/agent-audit";
import type { Bounds, ChannelBinding, Cursor } from "@jeswr/agent-channels";
import type { createExecutor, OutboxEntry, ProposalRelease } from "@jeswr/agent-executor";
import type { ActionProposal } from "@jeswr/agent-model";
import type { Gateway, ModelCall, ProposerContext } from "@jeswr/agent-model-gateway";
import type { Interpreter } from "@jeswr/agentic-legacy-bridge";
import type { PodAuth } from "@jeswr/pod-auth";
import type { NotificationsClient, Timers } from "@jeswr/pod-notifications";
import type { ConnectorsJob } from "./connectors.js";
import type { DaemonGatePort } from "./gate.js";
import type { PodWorkspace } from "./workspace.js";

export interface DaemonAccount {
  /** Opaque local identifier; never an address, WebID or path. */
  readonly id: string;
  readonly binding: Pick<ChannelBinding, "id" | "ingest">;
  readonly category: "email" | "chat" | "social";
  readonly enabled: boolean;
}
/** Commit only after inbox, triage, proposals and audit writes succeed. */
export interface Checkpoints {
  get(account: string): Promise<Cursor | undefined>;
  put(account: string, cursor: Cursor): Promise<void>;
}
export interface ProposalResult {
  readonly proposals: readonly ActionProposal[];
  readonly calls: readonly ModelCall[];
  readonly refused?: readonly { id: string; reason: string }[];
}
/** Private, durable results keyed by account, source URL and inbound content digest. */
export interface ProposalResults {
  get(key: string): Promise<ProposalResult | undefined>;
  /** Persist atomically and fsync before resolving, before any proposal/audit effects. */
  put(key: string, result: ProposalResult): Promise<void>;
}
/** Hold through executor.drain(), including late sends. Never steal on age alone. */
export interface ProcessLease {
  acquire(): Promise<() => Promise<void>>;
}
export interface DaemonOptions {
  readonly gate: DaemonGatePort;
  /** Trusted connector composition; runs independently of channel ingest. */
  readonly connectors?: ConnectorsJob;
  readonly accounts: readonly DaemonAccount[];
  readonly workspace: PodWorkspace;
  readonly notifications: NotificationsClient;
  readonly executor: ReturnType<typeof createExecutor>;
  readonly lease: ProcessLease;
  readonly checkpoints: Checkpoints;
  readonly proposalResults: ProposalResults;
  readonly gateway: Gateway;
  readonly proposerContext: Omit<ProposerContext, "memoryRecall">;
  readonly memory: { recall(query: string): Promise<unknown> };
  /** Read trusted owner selections, never flags supplied by channel content. */
  readonly isFlagged: (account: string, thread: string) => Promise<boolean>;
  /**
   * Render and idempotently project the audited release before pod publication.
   * Use the supplied signer or the configured inbound gate factory's release.
   * Use createDaemonOutboxProjector to bind the channel's wire preview to the terms digest.
   * Persist and return the exact executor entry.
   * The daemon durably caches that finalized proposal before publishing it or its audit evidence.
   */
  readonly project: (
    proposal: ActionProposal,
    sign: () => Promise<ProposalRelease>,
  ) => Promise<OutboxEntry>;
  readonly audit: {
    append(record: AuditRecord, at: string): Promise<unknown>;
    /** Read the same durable ledger used by append, including failed mirror writes. */
    entries(): readonly LedgerEntry[];
    /** Retry mirroring the existing ledger without appending another event. */
    sync(): Promise<void>;
  };
  readonly ownerWebId: string;
  readonly agentWebId: string;
  readonly interpreter?: Interpreter;
  readonly limits?: Bounds;
  readonly now?: () => number;
  readonly timers?: Timers;
  readonly log?: (message: string) => void;
}
export interface Daemon {
  /** Cancellation prevents outbox execution after ingest; drain retains the lease. */
  once(signal?: AbortSignal): Promise<void>;
  /** No ingress server. Shutdown drains before releasing the lease. */
  run(signal: AbortSignal): Promise<void>;
}
export interface AuthenticatedComposition {
  readonly auth: PodAuth;
  readonly daemon: Daemon;
  readonly connectors?: ConnectorsJob;
  close(): Promise<void>;
}
