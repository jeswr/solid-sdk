// AUTHORED-BY Codex GPT-6
/**
 * Persistent runtime state with crash-safe snapshots and a conservative process lock.
 *
 * Snapshots: the whole state is written to a temporary file, fsync'd, atomically renamed
 * over the previous snapshot, and the containing directory is fsync'd so the rename itself
 * survives power loss where the platform honours directory fsync. (On macOS, fsync does not
 * force the drive cache to stable media — F_FULLFSYNC is not exposed by Node — so power-loss
 * durability there is weaker than on Linux; a crash of the process alone is covered.)
 *
 * Lock protocol (one live writer per state path, across and within processes):
 *  - the lock file is created by hard-linking a fully written temporary file, so a lock is
 *    never observed empty or half written;
 *  - it records pid, host and a random ownership token; any live pid (including this
 *    process's own) holds it — a second store for the same path in the same process fails;
 *  - a lock whose pid is dead on this host is removed only while holding a separate
 *    recovery marker (created with O_EXCL), so two recoverers cannot both remove a lock;
 *  - an unreadable lock, a lock from another host, or a leftover recovery marker is never
 *    removed automatically: the operator must check and remove it;
 *  - close() removes the lock only if it still carries this store's token.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import type { ConversationState } from "../core/conversation.js";
import type {
  ActionIntent,
  Agreement,
  Iri,
  Json,
  JsonObject,
  OutcomeConclusion,
} from "../core/types.js";
import type { TransmissionRecord } from "../runtime/transmission.js";

export interface SeenEntry {
  readonly digest: string;
  readonly expiresAt: string;
  /** `processing` while (or if interrupted while) dispatching; then the final disposition. */
  readonly disposition: string;
  /** Outbound message ids produced for this inbound message (recorded as they are made). */
  readonly responses: readonly Iri[];
  readonly conversation?: Iri;
}

export interface OutboxEntry {
  readonly id: Iri;
  readonly conversation: Iri;
  readonly kind: string;
  readonly toActor?: Iri;
  readonly wire: WireMessage;
  readonly createdAt: string;
  /** Set when a binding confirmed it took the message (only with hand-off tracking). */
  readonly handedOff?: string;
  /**
   * The action authorised when this message was emitted (propose/accept/invoke/deliver
   * under the mandate). Provider transmission re-authorises exactly this intent.
   */
  readonly intent?: ActionIntent;
  /**
   * Payload-free authorisation basis of a protected disclosure (domain conditions such as an
   * access grant); re-evaluated by the hosting role's checkers before every transmission.
   */
  readonly conditions?: readonly { readonly kind: string; readonly ref: JsonObject }[];
}

/** A binding-neutral wire unit: a compact JWS, or an unsigned public request. */
export type WireMessage =
  | { readonly format: "awp-jws-compact/0.1"; readonly jws: string }
  | { readonly format: "awp-unsigned-json/0.1"; readonly payload: string };

/**
 * Effect lifecycle: `planned` (recorded, definitely not attempted) → `attempting` (the
 * attempt is durable; outcome unknown until concluded or reconciled) → `concluded`.
 * A concluded effect whose receipt is owed has `receiptSent: false` until the receipt is
 * in the outbox — both are persisted in the same snapshot.
 */
export interface EffectState {
  readonly key: string;
  readonly adapter: string;
  readonly activity: Iri;
  /** Conversation id, or a local task id for effects without a peer. */
  readonly conversation: Iri;
  readonly basis: Iri;
  readonly params: Json;
  readonly intentDigest: string;
  readonly activityType?: string;
  readonly status: "planned" | "attempting" | "concluded";
  readonly conclusion?: OutcomeConclusion;
  readonly observed?: Json;
  readonly attempts: number;
  readonly receiptSent: boolean;
  readonly uncertainReported?: boolean;
  readonly startedAt: string;
  readonly endedAt?: string;
}

export interface PendingAction {
  readonly actionDigest: string;
  readonly intent: ActionIntent;
  readonly conversation: Iri;
  /** The serialisable continuation the runtime resumes once approved. */
  readonly continuation: Json;
  readonly createdAt: string;
}

/** A local task: an effect with no peer conversation (e.g. a conventional-service booking). */
export interface TaskState {
  readonly id: Iri;
  readonly kind: string;
  readonly effectKey: string;
  readonly status: "pending-approval" | "denied" | "running" | "concluded";
  readonly conclusion?: OutcomeConclusion;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MandateRevocation {
  readonly id: Iri;
  readonly version: number;
  readonly digest: string;
  readonly at: string;
}

export interface RuntimeState {
  readonly version: 1;
  conversations: Record<Iri, ConversationState>;
  seen: Record<Iri, SeenEntry>;
  outbox: Record<Iri, OutboxEntry>;
  effects: Record<string, EffectState>;
  pending: Record<string, PendingAction>;
  approvals: Record<
    string,
    { id: Iri; decision: "approve" | "deny"; validUntil: string; jws: string }
  >;
  agreements: Record<Iri, Agreement>;
  /** Operation-scoped state; owned entries wrap their JSON as { owner, value }. Legacy/shared entries stay unowned. */
  domain: Record<string, Json>;
  /** Owner revocations of mandates (by id + version, and digest). Never dropped. */
  revokedMandates: MandateRevocation[];
  tasks: Record<Iri, TaskState>;
  /** Provider transmissions of outbound messages, keyed by message id (see transmission.ts). */
  transmissions: Record<Iri, TransmissionRecord>;
}

/** Explicit conversation/task ownership. Legacy JSON without this envelope has no owner. */
export function domainOwner(record: Json | undefined): Iri | undefined {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return undefined;
  return typeof record.owner === "string" && Object.hasOwn(record, "value")
    ? record.owner
    : undefined;
}

/** Keep callers' JSON view compatible with snapshots written before ownership was recorded. */
export function domainValue(record: Json | undefined): Json | undefined {
  if (domainOwner(record) === undefined) return record;
  return (record as { value: Json }).value;
}

export function emptyState(): RuntimeState {
  return {
    version: 1,
    conversations: {},
    seen: {},
    outbox: {},
    effects: {},
    pending: {},
    approvals: {},
    agreements: {},
    domain: {},
    revokedMandates: [],
    tasks: {},
    transmissions: {},
  };
}

/** Fill fields added after a snapshot was written (forward-compatible load). */
export function normaliseState(value: unknown): RuntimeState {
  const s = value as Partial<RuntimeState> & { version?: unknown };
  if (s.version !== 1) throw new Error(`unsupported state version ${String(s.version)}`);
  return { ...emptyState(), ...s } as RuntimeState;
}

export interface StateStore {
  load(): RuntimeState;
  save(state: RuntimeState): void;
  close(): void;
}

export class MemoryStateStore implements StateStore {
  private snapshot = JSON.stringify(emptyState());
  load(): RuntimeState {
    return normaliseState(JSON.parse(this.snapshot));
  }
  save(state: RuntimeState): void {
    this.snapshot = JSON.stringify(state);
  }
  close(): void {}
}

export class StateLockedError extends Error {
  constructor(
    path: string,
    readonly detail: string,
  ) {
    super(`state is locked: ${path} (${detail})`);
    this.name = "StateLockedError";
  }
}

export interface LockRecord {
  readonly pid: number;
  readonly host: string;
  readonly token: string;
  readonly createdAt: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(path: string): LockRecord | undefined | "missing" {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return undefined;
  }
  try {
    const r = JSON.parse(text) as Partial<LockRecord>;
    if (
      typeof r.pid === "number" &&
      Number.isInteger(r.pid) &&
      r.pid > 0 &&
      typeof r.host === "string" &&
      typeof r.token === "string" &&
      typeof r.createdAt === "string"
    ) {
      return r as LockRecord;
    }
  } catch {
    // fall through
  }
  return undefined;
}

/** fsync a directory so a rename/link inside it is durable (best effort where unsupported). */
export function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EISDIR" && code !== "EINVAL" && code !== "EPERM" && code !== "EBADF") throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeFileDurable(path: string, content: string, flags: string): void {
  const fd = openSync(path, flags, 0o600);
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export class FileStateStore implements StateStore {
  readonly lockPath: string;
  private readonly recoveryPath: string;
  private token: string | undefined;

  constructor(private readonly path: string) {
    this.lockPath = `${path}.lock`;
    this.recoveryPath = `${path}.lock.recovering`;
    mkdirSync(dirname(path), { recursive: true });
    this.acquire();
  }

  /** Whether a stale lock was recovered during acquisition (for the evidence ledger). */
  recoveredStaleLock: LockRecord | undefined;

  private acquire(): void {
    const token = randomUUID();
    const record: LockRecord = {
      pid: process.pid,
      host: hostname(),
      token,
      createdAt: new Date().toISOString(),
    };
    const tmp = `${this.lockPath}.${token}.tmp`;
    writeFileDurable(tmp, JSON.stringify(record), "wx");
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          linkSync(tmp, this.lockPath); // atomic: fails if a lock exists
          fsyncDir(dirname(this.lockPath));
          this.token = token;
          return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        this.recoverIfStale();
      }
      throw new StateLockedError(this.lockPath, "lock re-acquired by another process");
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  /** Remove the existing lock only if its holder is provably gone. Otherwise throw. */
  private recoverIfStale(): void {
    const holder = readLock(this.lockPath);
    if (holder === "missing") return;
    if (!holder) {
      throw new StateLockedError(
        this.lockPath,
        "unreadable lock file; verify no process uses this state, then remove it",
      );
    }
    if (holder.host !== hostname()) {
      throw new StateLockedError(
        this.lockPath,
        `held on another host (${holder.host}); cannot check liveness`,
      );
    }
    if (pidAlive(holder.pid)) {
      throw new StateLockedError(
        this.lockPath,
        holder.pid === process.pid
          ? "already open in this process"
          : `held by live process ${holder.pid}`,
      );
    }
    // The holder is dead. Serialise recovery with an O_EXCL marker.
    let marker: number;
    try {
      marker = openSync(this.recoveryPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new StateLockedError(
          this.lockPath,
          "another stale-lock recovery is in progress or was interrupted; check and remove the .recovering marker",
        );
      }
      throw error;
    }
    try {
      writeSync(marker, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      const again = readLock(this.lockPath);
      if (again === "missing") return;
      if (!again || again.token !== holder.token) {
        throw new StateLockedError(this.lockPath, "lock changed during stale recovery");
      }
      unlinkSync(this.lockPath);
      fsyncDir(dirname(this.lockPath));
      this.recoveredStaleLock = holder;
    } finally {
      closeSync(marker);
      rmSync(this.recoveryPath, { force: true });
    }
  }

  load(): RuntimeState {
    if (!existsSync(this.path)) return emptyState();
    return normaliseState(JSON.parse(readFileSync(this.path, "utf8")));
  }

  save(state: RuntimeState): void {
    if (!this.token) throw new Error("state store is closed");
    const tmp = `${this.path}.tmp-${this.token}`;
    writeFileDurable(tmp, JSON.stringify(state), "w");
    renameSync(tmp, this.path);
    fsyncDir(dirname(this.path));
  }

  close(): void {
    if (!this.token) return;
    const holder = readLock(this.lockPath);
    if (holder !== "missing" && holder?.token === this.token) {
      rmSync(this.lockPath, { force: true });
    }
    this.token = undefined;
  }
}
