// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * PURE converters between the FSM/model data ({@link ProtocolData} /
 * {@link ToleranceConclusionData}) and the durable cache records
 * ({@link StoredProtocol} / {@link StoredConclusion}), plus the record factories
 * that mint a stable `ulid` + pod URL. No I/O — the actual pod write lives in
 * `diary/sync.ts`, the cache write in the session actions.
 *
 * A protocol is a SINGLE resource updated in place across its lifetime, so
 * {@link newProtocolRecord} mints the id/url ONCE and {@link updateProtocolRecord}
 * preserves them on every phase transition (the pod PUT overwrites the same URL).
 * A malformed cached date is dropped (→ `undefined`) rather than fed to the engine
 * as a `NaN` Date — the same fail-closed rule the diary cache-bridge uses.
 */
import {
  conclusionSubject,
  type ProtocolData,
  protocolSubject,
  type ToleranceConclusionData,
} from "@jeswr/solid-health-diary";
import { ulid } from "ulid";
import type { StoredConclusion, StoredProtocol } from "../cache/diary-store";
import { conclusionUrl, protocolUrl } from "../pod/layout";

/** ISO → `Date`, or `undefined` when absent / unparseable (fail-closed). */
function toDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** `Date` → ISO, or `undefined`. */
function toIso(d: Date | undefined): string | undefined {
  return d ? d.toISOString() : undefined;
}

// --- protocols ---------------------------------------------------------------

/** Convert a cached protocol to the model {@link ProtocolData} the engine reasons over. */
export function storedProtocolToData(sp: StoredProtocol): ProtocolData {
  const data: ProtocolData = {
    id: protocolSubject(sp.url),
    targetTrigger: sp.targetTrigger,
    phase: sp.phase,
    created: toDate(sp.createdAt),
  };
  const phaseStarted = toDate(sp.phaseStarted);
  if (phaseStarted) data.phaseStarted = phaseStarted;
  const phasePlannedEnd = toDate(sp.phasePlannedEnd);
  if (phasePlannedEnd) data.phasePlannedEnd = phasePlannedEnd;
  if (sp.challengeStep !== undefined) data.challengeStep = sp.challengeStep;
  if (sp.patient) data.patient = sp.patient;
  return data;
}

/**
 * Mint a fresh `pending` {@link StoredProtocol} for a newly-started protocol — a
 * stable `ulid` + pod URL, reused for the protocol's whole lifetime.
 */
export function newProtocolRecord(
  data: ProtocolData,
  storageRoot: string,
  now: Date = new Date(),
): StoredProtocol {
  const id = ulid((data.created ?? now).getTime());
  return {
    kind: "protocol",
    ulid: id,
    url: protocolUrl(storageRoot, id),
    targetTrigger: data.targetTrigger,
    phase: data.phase,
    phaseStarted: toIso(data.phaseStarted),
    phasePlannedEnd: toIso(data.phasePlannedEnd),
    challengeStep: data.challengeStep,
    patient: data.patient,
    createdAt: (data.created ?? now).toISOString(),
    updatedAt: now.toISOString(),
    sync: "pending",
  };
}

/**
 * Update an existing cached protocol with a new FSM state, PRESERVING its `ulid`,
 * `url`, and `createdAt` (the resource identity is stable across transitions). The
 * record is marked `pending` again so the outbox re-PUTs it.
 */
export function updateProtocolRecord(
  prev: StoredProtocol,
  data: ProtocolData,
  now: Date = new Date(),
): StoredProtocol {
  return {
    ...prev,
    targetTrigger: data.targetTrigger,
    phase: data.phase,
    phaseStarted: toIso(data.phaseStarted),
    phasePlannedEnd: toIso(data.phasePlannedEnd),
    challengeStep: data.challengeStep,
    patient: data.patient ?? prev.patient,
    updatedAt: now.toISOString(),
    sync: "pending",
    error: undefined,
  };
}

// --- conclusions -------------------------------------------------------------

/** Convert a cached conclusion to the model {@link ToleranceConclusionData}. */
export function storedConclusionToData(sc: StoredConclusion): ToleranceConclusionData {
  const data: ToleranceConclusionData = {
    // Preserve identity + created so a re-sync is idempotent and due-review surfacing
    // keeps a stable `conclusionId` (the review UI keys off it).
    id: conclusionSubject(sc.url),
    aboutTrigger: sc.aboutTrigger,
    verdict: sc.verdict,
    confidence: sc.confidence,
    created: toDate(sc.createdAt),
  };
  if (sc.note) data.note = sc.note;
  const reviewAfter = toDate(sc.reviewAfter);
  if (reviewAfter) data.reviewAfter = reviewAfter;
  if (sc.patient) data.patient = sc.patient;
  if (sc.derivedFrom && sc.derivedFrom.length > 0) data.derivedFrom = [...sc.derivedFrom];
  return data;
}

/** Mint a fresh `pending` {@link StoredConclusion} from a derived tolerance conclusion. */
export function newConclusionRecord(
  data: ToleranceConclusionData,
  storageRoot: string,
  protocolUlid?: string,
  now: Date = new Date(),
): StoredConclusion {
  const id = ulid(now.getTime());
  return {
    kind: "conclusion",
    ulid: id,
    url: conclusionUrl(storageRoot, id),
    aboutTrigger: data.aboutTrigger,
    verdict: data.verdict,
    // A conclusion only ever exists here from a completed protocol ⇒ `confirmed`.
    confidence: data.confidence ?? "confirmed",
    note: data.note,
    reviewAfter: toIso(data.reviewAfter),
    patient: data.patient,
    derivedFrom: data.derivedFrom ? [...data.derivedFrom] : undefined,
    protocolUlid,
    createdAt: now.toISOString(),
    sync: "pending",
  };
}
