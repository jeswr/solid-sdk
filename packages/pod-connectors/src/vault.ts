// AUTHORED-BY Codex GPT-6.1-Sol
/** Browser-safe encrypted refresh credentials. Hosts own the key and storage lifetime. */
export interface VaultKey {
  readonly connectorId: string;
  readonly account: string;
}
export type VaultJson =
  | null
  | boolean
  | number
  | string
  | VaultJson[]
  | { [key: string]: VaultJson };
export interface VaultRecord {
  readonly refreshToken: string;
  readonly scope?: string;
  readonly tokenType?: string;
  /** Epoch milliseconds. expiresAt, when present, is the refresh credential's expiry. */
  readonly obtainedAt: number;
  readonly expiresAt?: number;
  readonly providerMeta?: VaultJson;
}

/** Ciphertext-only port. IDs are canonical JSON tuples; list must be bounded. */
export interface VaultStore {
  get(id: string): Promise<string | undefined>;
  put(id: string, sealed: string): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
}
export const MAX_VAULT_RECORDS = 1000;
export const MAX_SEALED_CHARS = 64 * 1024;
const MAX_PLAINTEXT_BYTES = 32 * 1024;

/** Deliberately identical for validation, parsing, authentication and storage failures. */
export class ConnectorVaultError extends Error {
  constructor() {
    super("Connector vault operation failed.");
    this.name = "ConnectorVaultError";
  }
}

function wellFormed(value: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || !value.length || value.length > max || !wellFormed(value))
    throw new ConnectorVaultError();
}
export function vaultId(key: VaultKey): string {
  try {
    const connectorId = Object.getOwnPropertyDescriptor(key, "connectorId");
    const account = Object.getOwnPropertyDescriptor(key, "account");
    if (
      !connectorId ||
      !Object.hasOwn(connectorId, "value") ||
      !account ||
      !Object.hasOwn(account, "value")
    )
      throw new ConnectorVaultError();
    key = { connectorId: connectorId.value, account: account.value };
    text(key.connectorId, 64);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key.connectorId)) throw new ConnectorVaultError();
    text(key.account, 256);
    if (
      key.account.trim() !== key.account ||
      [...key.account].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new ConnectorVaultError();
    return JSON.stringify([key.connectorId, key.account]);
  } catch {
    throw new ConnectorVaultError();
  }
}
export function vaultKey(id: string): VaultKey {
  try {
    if (typeof id !== "string" || id.length > 2048) throw new ConnectorVaultError();
    const tuple = JSON.parse(id);
    if (!Array.isArray(tuple) || tuple.length !== 2) throw new ConnectorVaultError();
    const key = { connectorId: tuple[0], account: tuple[1] };
    if (vaultId(key) !== id) throw new ConnectorVaultError();
    return key;
  } catch {
    throw new ConnectorVaultError();
  }
}
export function validateSealed(value: string): void {
  if (typeof value !== "string" || value.length > MAX_SEALED_CHARS || !value.length)
    throw new ConnectorVaultError();
}

function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectorVaultError();
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new ConnectorVaultError();
}
/** Bounded traversal before stringify: no accessors, custom toJSON, cycles or exotic objects. */
function metadata(value: unknown): VaultJson {
  let nodes = 0;
  let chars = 0;
  const visit = (item: unknown, depth: number): VaultJson => {
    if (++nodes > 256 || depth > 8) throw new ConnectorVaultError();
    if (typeof item === "string") {
      if (item.length > 4096 || !wellFormed(item)) throw new ConnectorVaultError();
      chars += item.length;
    } else if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new ConnectorVaultError();
    } else if (item !== null && typeof item === "object") {
      const array = Array.isArray(item);
      if (array) {
        if (item.length > 256) throw new ConnectorVaultError();
      } else object(item);
      const result: { [key: string]: VaultJson } = Object.create(null);
      let count = 0;
      for (const name in item) {
        if (
          ++count > 256 ||
          /^(?:access_?token|id_?token|client_?secret|authorization|toJSON)$/i.test(name)
        )
          throw new ConnectorVaultError();
        const descriptor = Object.getOwnPropertyDescriptor(item, name);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new ConnectorVaultError();
        chars += name.length;
        if (chars > 4096) throw new ConnectorVaultError();
        result[name] = visit(descriptor.value, depth + 1);
      }
      return array
        ? Array.from({ length: item.length }, (_, index) => {
            if (!Object.hasOwn(result, index)) throw new ConnectorVaultError();
            return result[index]!;
          })
        : result;
    } else if (item !== null && typeof item !== "boolean") throw new ConnectorVaultError();
    if (chars > 4096) throw new ConnectorVaultError();
    return item as VaultJson;
  };
  const result = visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).length > 4096)
    throw new ConnectorVaultError();
  return result;
}

function record(value: unknown): VaultRecord {
  object(value);
  const allowed = new Set([
    "refreshToken",
    "scope",
    "tokenType",
    "obtainedAt",
    "expiresAt",
    "providerMeta",
  ]);
  let count = 0;
  for (const name in value) {
    if (++count > allowed.size || !allowed.has(name)) throw new ConnectorVaultError();
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new ConnectorVaultError();
  }
  const safe: Record<string, unknown> = Object.create(null);
  for (const name of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, "value")) throw new ConnectorVaultError();
      safe[name] = descriptor.value;
    }
  }
  text(safe.refreshToken, 16 * 1024);
  if (safe.scope !== undefined) text(safe.scope, 4096);
  if (safe.tokenType !== undefined) text(safe.tokenType, 64);
  if (
    typeof safe.obtainedAt !== "number" ||
    !Number.isSafeInteger(safe.obtainedAt) ||
    safe.obtainedAt < 0 ||
    (safe.expiresAt !== undefined &&
      (typeof safe.expiresAt !== "number" ||
        !Number.isSafeInteger(safe.expiresAt) ||
        safe.expiresAt < 0))
  )
    throw new ConnectorVaultError();
  const result: VaultRecord = {
    refreshToken: safe.refreshToken,
    obtainedAt: safe.obtainedAt,
    ...(safe.scope === undefined ? {} : { scope: safe.scope as string }),
    ...(safe.tokenType === undefined ? {} : { tokenType: safe.tokenType as string }),
    ...(safe.expiresAt === undefined ? {} : { expiresAt: safe.expiresAt as number }),
    ...(safe.providerMeta === undefined ? {} : { providerMeta: metadata(safe.providerMeta) }),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_PLAINTEXT_BYTES)
    throw new ConnectorVaultError();
  return result;
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new ConnectorVaultError();
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (encode(bytes) !== value) throw new ConnectorVaultError();
  return bytes;
}
export function validateVaultCryptoKey(key: CryptoKey): void {
  if (
    !(key instanceof globalThis.CryptoKey) ||
    key.type !== "secret" ||
    key.algorithm.name !== "AES-GCM" ||
    (key.algorithm as AesKeyAlgorithm).length !== 256 ||
    !key.usages.includes("encrypt") ||
    !key.usages.includes("decrypt")
  )
    throw new ConnectorVaultError();
}

/** Canonical padded standard base64 of exactly 32 bytes. Never reads host environment. */
export async function importVaultKey(base64: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    if (typeof base64 !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(base64))
      throw new ConnectorVaultError();
    const binary = atob(base64);
    if (binary.length !== 32 || btoa(binary) !== base64) throw new ConnectorVaultError();
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return await globalThis.crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  } catch {
    throw new ConnectorVaultError();
  } finally {
    bytes?.fill(0);
  }
}
export async function generateBrowserVaultKey(): Promise<CryptoKey> {
  try {
    return await globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
  } catch {
    throw new ConnectorVaultError();
  }
}

export class ConnectorTokenVault {
  constructor(
    private readonly key: CryptoKey,
    private readonly store: VaultStore,
  ) {
    try {
      validateVaultCryptoKey(key);
    } catch {
      throw new ConnectorVaultError();
    }
  }
  async get(key: VaultKey): Promise<VaultRecord | undefined> {
    try {
      const id = vaultId(key);
      const sealed = await this.store.get(id);
      if (sealed === undefined) return undefined;
      return await this.unseal(id, sealed);
    } catch {
      throw new ConnectorVaultError();
    }
  }
  private async unseal(id: string, sealed: string): Promise<VaultRecord> {
    validateSealed(sealed);
    const fields = sealed.split(".");
    if (fields.length !== 3 || fields[0] !== "1") throw new ConnectorVaultError();
    const iv = decode(fields[1]!);
    const ciphertext = decode(fields[2]!);
    if (iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > MAX_PLAINTEXT_BYTES + 16)
      throw new ConnectorVaultError();
    const plaintext = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(JSON.stringify([1, ...JSON.parse(id)])),
        tagLength: 128,
      },
      this.key,
      ciphertext,
    );
    try {
      return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)));
    } finally {
      new Uint8Array(plaintext).fill(0);
    }
  }
  async put(key: VaultKey, value: VaultRecord): Promise<void> {
    let plaintext: Uint8Array<ArrayBuffer> | undefined;
    try {
      const id = vaultId(key);
      plaintext = new TextEncoder().encode(JSON.stringify(record(value)));
      const previous = await this.store.get(id);
      if (previous !== undefined) await this.unseal(id, previous);
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await globalThis.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(JSON.stringify([1, ...JSON.parse(id)])),
          tagLength: 128,
        },
        this.key,
        plaintext,
      );
      await this.store.put(id, `1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`);
    } catch {
      throw new ConnectorVaultError();
    } finally {
      plaintext?.fill(0);
    }
  }
  async delete(key: VaultKey): Promise<void> {
    try {
      await this.store.delete(vaultId(key));
    } catch {
      throw new ConnectorVaultError();
    }
  }
  async list(): Promise<VaultKey[]> {
    try {
      const ids = await this.store.list();
      if (!Array.isArray(ids) || ids.length > MAX_VAULT_RECORDS) throw new ConnectorVaultError();
      const keys = ids.map(vaultKey);
      if (new Set(ids).size !== ids.length) throw new ConnectorVaultError();
      // Authenticate each entry before returning its identity.
      for (const key of keys) if (!(await this.get(key))) throw new ConnectorVaultError();
      return keys;
    } catch {
      throw new ConnectorVaultError();
    }
  }
}

/** Bounded, single-process fixture storage. Contains ciphertext only. */
export class MemoryVaultStore implements VaultStore {
  private readonly values = new Map<string, string>();
  async get(id: string): Promise<string | undefined> {
    vaultKey(id);
    return this.values.get(id);
  }
  async put(id: string, value: string): Promise<void> {
    vaultKey(id);
    validateSealed(value);
    if (!this.values.has(id) && this.values.size >= MAX_VAULT_RECORDS)
      throw new ConnectorVaultError();
    this.values.set(id, value);
  }
  async delete(id: string): Promise<void> {
    vaultKey(id);
    this.values.delete(id);
  }
  async list(): Promise<string[]> {
    return [...this.values.keys()];
  }
}

export { IndexedDbVaultStore } from "./vault-indexeddb.js";
