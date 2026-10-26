// AUTHORED-BY Codex GPT-6.1-Sol

/** Checked before inspecting, copying or sorting any version. */
export const MAX_INPUT_VERSIONS = 100_000;
export const DEFAULT_MAX_VERSIONS = 100;
export const DEFAULT_MAX_BYTES = 1024 ** 3;

export interface ManagedVersion {
  readonly id: string;
  readonly createdAt: number;
  readonly sizeBytes: number;
  readonly labelled: boolean;
}

export interface RetentionLimits {
  readonly maxVersions?: number;
  readonly maxBytes?: number;
}

export interface RetentionPlan {
  readonly keep: string[];
  readonly delete: string[];
  readonly freedBytes: number;
  /** Total retained usage, including labels and the protected newest version. */
  readonly overBudget: boolean;
}

export type RetentionErrorCode = "TOO_MANY_VERSIONS" | "DUPLICATE_VERSION" | "INVALID_VERSION";

/** Messages contain only a code, never caller-supplied version identifiers. */
export class RetentionError extends Error {
  constructor(public readonly code: RetentionErrorCode) {
    super(`Drive retention: ${code}`);
    this.name = "RetentionError";
  }
}

function valid(condition: unknown): asserts condition {
  if (!condition) throw new RetentionError("INVALID_VERSION");
}

function record(value: unknown, keys: readonly string[]): void {
  valid(typeof value === "object" && value !== null && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  valid(prototype === Object.prototype || prototype === null);
  for (const key of Reflect.ownKeys(value)) {
    valid(typeof key === "string" && keys.includes(key));
    const descriptor = Object.getOwnPropertyDescriptor(value, key) as PropertyDescriptor;
    valid(descriptor.enumerable && "value" in descriptor);
  }
}

function nonnegativeInteger(value: unknown): void {
  valid(Number.isSafeInteger(value) && (value as number) >= 0);
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Epoch arithmetic gives UTC clock buckets, including dates before 1970. */
function bucket(createdAt: number, now: number): string | undefined {
  const age = now - createdAt;
  if (age < DAY) return undefined;
  if (age < 7 * DAY) return `hour:${Math.floor(createdAt / HOUR)}`;
  const day = Math.floor(createdAt / DAY);
  if (age <= 30 * DAY) return `day:${day}`;
  // 1970-01-01 was Thursday: +3 anchors weeks to Monday, including ISO year edges.
  return `week:${Math.floor((day + 3) / 7)}`;
}

/**
 * Compute a deletion plan without changing the input or consulting a system clock.
 * Limits prune unlabelled candidates only; labels and the newest version survive.
 * Exactly 30 days remains in the daily band. See QUESTIONS.md for policy readings.
 * Numeric inputs must be safe integers; freedBytes must also be exactly representable.
 */
export function planRetention(
  versions: readonly ManagedVersion[],
  now: number,
  limits: RetentionLimits = {},
): RetentionPlan {
  valid(Array.isArray(versions));
  if (versions.length > MAX_INPUT_VERSIONS) throw new RetentionError("TOO_MANY_VERSIONS");
  valid(Number.isSafeInteger(now));
  record(limits, ["maxVersions", "maxBytes"]);
  const maxVersions = limits.maxVersions === undefined ? DEFAULT_MAX_VERSIONS : limits.maxVersions;
  const maxBytes = limits.maxBytes === undefined ? DEFAULT_MAX_BYTES : limits.maxBytes;
  nonnegativeInteger(maxVersions);
  nonnegativeInteger(maxBytes);

  const ids = new Set<string>();
  for (const version of versions) {
    record(version, ["id", "createdAt", "sizeBytes", "labelled"]);
    valid(typeof version.id === "string");
    valid(Number.isSafeInteger(version.createdAt) && version.createdAt <= now);
    nonnegativeInteger(version.sizeBytes);
    valid(typeof version.labelled === "boolean");
    if (ids.has(version.id)) throw new RetentionError("DUPLICATE_VERSION");
    ids.add(version.id);
  }

  const sorted = [...versions].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return Number(a.id > b.id) - Number(a.id < b.id);
  });
  const buckets = new Set<string>();
  const retained = new Set<string>();
  let unlabelledCount = 0;
  let unlabelledBytes = BigInt(0);
  for (const version of sorted) {
    const key = bucket(version.createdAt, now);
    const representative = key === undefined || !buckets.has(key);
    if (key !== undefined) buckets.add(key);
    if (version.labelled || representative) {
      retained.add(version.id);
      if (!version.labelled) {
        unlabelledCount++;
        unlabelledBytes += BigInt(version.sizeBytes);
      }
    }
  }

  const byteLimit = BigInt(maxBytes);
  for (let index = sorted.length - 1; index > 0; index--) {
    if (unlabelledCount <= maxVersions && unlabelledBytes <= byteLimit) break;
    const version = sorted[index] as ManagedVersion;
    if (version.labelled || !retained.has(version.id)) continue;
    retained.delete(version.id);
    unlabelledCount--;
    unlabelledBytes -= BigInt(version.sizeBytes);
  }

  const keep: string[] = [];
  const remove: string[] = [];
  let keptBytes = BigInt(0);
  let freedBytes = BigInt(0);
  for (const version of sorted) {
    if (retained.has(version.id)) {
      keep.push(version.id);
      keptBytes += BigInt(version.sizeBytes);
    } else {
      remove.push(version.id);
      freedBytes += BigInt(version.sizeBytes);
    }
  }
  valid(freedBytes <= BigInt(Number.MAX_SAFE_INTEGER));
  return {
    keep,
    delete: remove,
    freedBytes: Number(freedBytes),
    overBudget: keep.length > maxVersions || keptBytes > byteLimit,
  };
}
