// AUTHORED-BY GPT-5.6 Codex
import { SecureStoreError } from "./errors.js";

export interface SecureStoreStatus {
  available: boolean;
  userPresence: boolean;
  hardwareBacked: boolean;
}

export interface SecureStoreEntry {
  value: string | null;
  version: number;
}

export interface SecureStoreSetOptions {
  userPresence: boolean;
  /** The version from get() or the last committed set(); a mismatch rejects with stale. */
  version: number;
}

/** The native `SuiteSecureStore` plugin. Only refresh tokens belong in this store. */
export interface SecureStorePlugin {
  status(): Promise<SecureStoreStatus>;
  get(options: { key: string }): Promise<SecureStoreEntry>;
  set(
    options: { key: string; value: string } & SecureStoreSetOptions,
  ): Promise<{ version: number }>;
  remove(options: { key: string }): Promise<Record<string, never>>;
  clear(): Promise<Record<string, never>>;
  cancel(): Promise<Record<string, never>>;
}

export interface SecureStore {
  status(): Promise<SecureStoreStatus>;
  get(key: string, signal?: AbortSignal): Promise<SecureStoreEntry>;
  set(key: string, value: string, options: SecureStoreSetOptions): Promise<{ version: number }>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  cancel(): Promise<void>;
}

const KEY = /^[a-z0-9][a-z0-9:._-]{0,127}$/;
const MAX_VALUE_BYTES = 16 * 1024;

function checkKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || KEY.exec(key)?.[0] !== key) {
    throw new SecureStoreError("invalid");
  }
}

function validValue(value: unknown): value is string {
  return typeof value === "string" && new TextEncoder().encode(value).byteLength <= MAX_VALUE_BYTES;
}

function validVersion(version: unknown): version is number {
  return typeof version === "number" && Number.isSafeInteger(version) && version >= 0;
}

function response(raw: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(raw, field))
  ) {
    throw new SecureStoreError("failed");
  }
  return raw as Record<string, unknown>;
}

function emptyResponse(raw: unknown): void {
  response(raw, []);
}

function nativeError(error: unknown): SecureStoreError {
  let code: unknown;
  try {
    code = (error as { code?: unknown } | null)?.code;
  } catch {
    return new SecureStoreError("failed");
  }
  switch (code) {
    case "cancelled":
    case "background":
    case "lockout":
    case "unavailable":
    case "stale":
    case "full":
    case "invalid":
    case "failed":
      return new SecureStoreError(code);
    default:
      return new SecureStoreError("failed");
  }
}

async function invoke<T>(work: () => Promise<unknown>, validate: (raw: unknown) => T): Promise<T> {
  try {
    return validate(await work());
  } catch (error) {
    throw nativeError(error);
  }
}

/** Validated native storage with version checks and cancellable unlocks; no web fallback. */
export function createSecureStore(plugin: SecureStorePlugin): SecureStore {
  const cancel = () => invoke(() => plugin.cancel(), emptyResponse);
  const read = (key: string) =>
    invoke(
      () => plugin.get({ key }),
      (raw): SecureStoreEntry => {
        const { value, version } = response(raw, ["value", "version"]);
        if ((value !== null && !validValue(value)) || !validVersion(version)) {
          throw new SecureStoreError("failed");
        }
        return { value, version };
      },
    );

  return {
    status() {
      return invoke(
        () => plugin.status(),
        (raw): SecureStoreStatus => {
          const { available, userPresence, hardwareBacked } = response(raw, [
            "available",
            "userPresence",
            "hardwareBacked",
          ]);
          if (
            typeof available !== "boolean" ||
            typeof userPresence !== "boolean" ||
            typeof hardwareBacked !== "boolean"
          ) {
            throw new SecureStoreError("failed");
          }
          return { available, userPresence, hardwareBacked };
        },
      );
    },

    async get(key, signal) {
      if (signal?.aborted) throw new SecureStoreError("cancelled");
      checkKey(key);
      if (!signal) return read(key);
      let rejectAborted!: (error: SecureStoreError) => void;
      const aborted = new Promise<never>((_, reject) => {
        rejectAborted = reject;
      });
      const onAbort = () => {
        rejectAborted(new SecureStoreError("cancelled"));
        void cancel().catch(() => undefined);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        // Abort settles even if native code never replies; late results are dropped.
        return await Promise.race([read(key), aborted]);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },

    async set(key, value, options) {
      checkKey(key);
      const userPresence = options?.userPresence;
      const version = options?.version;
      if (!validValue(value) || typeof userPresence !== "boolean" || !validVersion(version)) {
        throw new SecureStoreError("invalid");
      }
      return invoke(
        () => plugin.set({ key, value, userPresence, version }),
        (raw) => {
          const result = response(raw, ["version"]);
          if (!validVersion(result.version) || result.version <= version) {
            throw new SecureStoreError("failed");
          }
          return { version: result.version };
        },
      );
    },

    async delete(key) {
      checkKey(key);
      await invoke(() => plugin.remove({ key }), emptyResponse);
    },

    clear() {
      return invoke(() => plugin.clear(), emptyResponse);
    },

    cancel,
  };
}

export interface RefreshTokenIdentity {
  issuer: string;
  webId: string;
  clientId: string;
}

/** ADR-004's complete session identity, hashed without URL normalisation. */
export async function refreshTokenKey({
  issuer,
  webId,
  clientId,
}: RefreshTokenIdentity): Promise<string> {
  // JSON.stringify writes undefined, null and functions all as null, so an
  // unresolved field would share one key across accounts.
  for (const [field, value] of Object.entries({ issuer, webId, clientId })) {
    if (typeof value !== "string" || value === "") {
      throw new TypeError(`refreshTokenKey: ${field} must be a non-empty string`);
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify([issuer, webId, clientId]));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `pod-auth:refresh:${hex}`;
}
