// AUTHORED-BY Claude Sonnet 5.5
import type { AudioReceipt } from "./receipts";

/**
 * The feedback draft holds a frozen record (answers, transcript, name, email) and signed
 * recording receipts. It is private to the signed-in account (or a separate signed-out
 * bucket) that created it, expires, and is removed when that account signs out.
 */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
/** Before this version the draft was one origin-wide key with no owner; it is never restored. */
export const legacyDraftKey = "suite.feedback.draft.v1";
const prefix = "suite.feedback.draft.v2:";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// Re-upload ten minutes early, so a device clock running slow cannot send expired receipts.
export const RENEW_MARGIN_MS = 10 * 60_000;
export const MAX_RECORDINGS = 10;

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface StoredDraft {
  submissionId: string;
  record: string;
  /** Indexed by recording number; a gap is null and never shifts later recordings. */
  receipts: (AudioReceipt | null)[];
  savedAt: number;
  /** True when an attempt may already have reached storage, so the record must stay frozen. */
  uncertain: boolean;
}
// Owners whose session ended: a submit still running in the page must not re-create their draft.
const revoked = new Set<string>();
/** Removes the owner's draft and blocks any in-flight save from writing it back. */
export function revokeDrafts(storage: DraftStorage | undefined, owner: string): void {
  revoked.add(owner);
  clearDraft(storage, owner);
}
/** A form for this owner is open again (a new session), so drafts may be written. */
export function allowDrafts(owner: string): void {
  revoked.delete(owner);
}

export const ownerOf = (accountId?: string | null) =>
  accountId ? `account:${accountId}` : "signed-out";
const keyFor = (owner: string) => `${prefix}${owner}`;

/** Same shape the upload response is held to, so a corrupt stored entry is never sent. */
export function isReceipt(value: unknown, submissionId: string): value is AudioReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    Object.keys(r).sort().join() === "ext,sha,sig,size,submissionId" &&
    r.submissionId === submissionId &&
    typeof r.sha === "string" &&
    /^[a-f0-9]{40,64}$/.test(r.sha) &&
    Number.isSafeInteger(r.size) &&
    (r.size as number) >= 1 &&
    (r.size as number) <= 3 * 1024 * 1024 &&
    (r.ext === "webm" || r.ext === "ogg" || r.ext === "m4a") &&
    typeof r.sig === "string" &&
    /^\d{13}\.[a-f0-9]{64}$/.test(r.sig)
  );
}
export const receiptExpiry = (receipt: AudioReceipt) => Number(receipt.sig.split(".")[0]);
export const receiptUsable = (receipt: AudioReceipt | null | undefined, now: number) =>
  !!receipt && receiptExpiry(receipt) - RENEW_MARGIN_MS > now;

export function saveDraft(
  storage: DraftStorage | undefined,
  owner: string,
  draft: Omit<StoredDraft, "savedAt">,
  now = Date.now(),
): void {
  if (revoked.has(owner)) return;
  try {
    storage?.setItem(keyFor(owner), JSON.stringify({ version: 2, owner, savedAt: now, ...draft }));
  } catch {
    /* Keep the in-memory record available when local storage is blocked or full. */
  }
}
export function clearDraft(storage: DraftStorage | undefined, owner: string): void {
  try {
    storage?.removeItem(keyFor(owner));
  } catch {
    /* Private browsing may block storage. */
  }
}
/**
 * The owner's unexpired draft, or undefined. A draft that is expired, malformed or stored
 * under an owner other than the requested one is removed rather than offered.
 */
export function loadDraft(
  storage: DraftStorage | undefined,
  owner: string,
  now = Date.now(),
): StoredDraft | undefined {
  try {
    const raw = storage?.getItem(keyFor(owner));
    if (!raw) return undefined;
    const draft = JSON.parse(raw);
    const fresh =
      Number.isFinite(draft?.savedAt) &&
      draft.savedAt <= now + 60_000 &&
      now - draft.savedAt < DRAFT_TTL_MS;
    if (
      draft?.version !== 2 ||
      draft.owner !== owner ||
      !fresh ||
      typeof draft.record !== "string" ||
      typeof draft.submissionId !== "string" ||
      !uuid.test(draft.submissionId) ||
      !Array.isArray(draft.receipts) ||
      draft.receipts.length > MAX_RECORDINGS
    ) {
      clearDraft(storage, owner);
      return undefined;
    }
    return {
      submissionId: draft.submissionId,
      record: draft.record,
      savedAt: draft.savedAt,
      // Drafts saved without the flag are treated as possibly stored.
      uncertain: draft.uncertain !== false,
      receipts: draft.receipts.map((entry: unknown) =>
        isReceipt(entry, draft.submissionId) ? entry : null,
      ),
    };
  } catch {
    clearDraft(storage, owner);
    return undefined;
  }
}
/** Removes the unowned legacy draft and every expired or unreadable draft of any owner. */
export function purgeDrafts(
  storage: (DraftStorage & Pick<Storage, "key" | "length">) | undefined,
  now = Date.now(),
): void {
  try {
    if (!storage) return;
    storage.removeItem(legacyDraftKey);
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      try {
        const draft = JSON.parse(storage.getItem(key) ?? "null");
        if (
          draft?.owner !== key.slice(prefix.length) ||
          !Number.isFinite(draft.savedAt) ||
          now - draft.savedAt >= DRAFT_TTL_MS
        )
          stale.push(key);
      } catch {
        stale.push(key);
      }
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    /* Private browsing may block storage. */
  }
}

interface RecordLike {
  transcript: { audio?: number[] | undefined }[];
}
/** Recording numbers the transcript points at. */
export function audioIndices(record: RecordLike): number[] {
  return [...new Set(record.transcript.flatMap((message) => message.audio ?? []))].sort(
    (a, b) => a - b,
  );
}
/**
 * Recording slots the page can no longer send: their receipt is missing, malformed or about to
 * expire, and the audio itself is not in memory (it never survives a reload) so it cannot be
 * uploaded again.
 */
export function lostRecordings(
  record: RecordLike,
  receipts: readonly (AudioReceipt | null | undefined)[],
  haveClip: (index: number) => boolean,
  now = Date.now(),
): number[] {
  // The server numbers recordings by position, so a missing earlier recording matters as much
  // as a referenced one: every slot up to the highest reference must be sendable.
  const count = Math.max(-1, ...audioIndices(record)) + 1;
  return Array.from({ length: count }, (_, i) => i).filter(
    (i) => !haveClip(i) && !receiptUsable(receipts[i], now),
  );
}
/** The record with every recording reference removed. */
export function withoutRecordings<
  M extends { audio?: number[] | undefined },
  T extends { transcript: M[] },
>(record: T): T {
  return {
    ...record,
    transcript: record.transcript.map(({ audio: _audio, ...message }) => message),
  } as T;
}
