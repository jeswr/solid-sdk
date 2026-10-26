// AUTHORED-BY Codex GPT-6.1-Sol
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { KvVaultStore, type VaultStore } from "./vault-stores.js";

/** Server-only secret vault. Deleted identifiers are permanently retired. */
export interface SessionVault {
  put(id: string, secret: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array | undefined>;
  delete(id: string): Promise<void>;
  /** Atomic secret transition; used for callback consumption and refresh ownership. */
  compareAndSwap(
    id: string,
    expected: Uint8Array | undefined,
    secret: Uint8Array,
  ): Promise<boolean>;
}

export interface SessionVaultOptions {
  /** Exactly 32 bytes in canonical padded base64; defaults to MCP_VAULT_KEY. */
  key?: string;
  /** Defaults to Upstash/Vercel KV configured through its REST environment variables. */
  store?: VaultStore;
}

/** AES-256-GCM with a fresh 96-bit IV and authenticated version + record identity. */
export function createSessionVault(options: SessionVaultOptions = {}): SessionVault {
  const encoded = options.key ?? process.env.MCP_VAULT_KEY ?? "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded)
    throw new Error("MCP_VAULT_KEY must be 32 bytes in base64");
  const store = options.store ?? new KvVaultStore();
  const aad = (id: string) => Buffer.from(`mcp-vault:1:${id}`);
  const encrypt = (id: string, secret: Uint8Array) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(id));
    const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
    return `1.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
  };
  const decrypt = (id: string, value: string | undefined): Uint8Array | undefined => {
    if (value === undefined || value === "deleted") return undefined;
    try {
      if (!value.startsWith("1.")) throw new Error();
      const bytes = Buffer.from(value.slice(2), "base64");
      if (bytes.length < 28 || bytes.toString("base64") !== value.slice(2)) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      decipher.setAAD(aad(id));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    } catch {
      throw new Error("Vault authentication failed");
    }
  };
  return {
    async get(id) {
      return decrypt(id, await store.get(id));
    },
    async compareAndSwap(id, expected, secret) {
      const current = await store.get(id);
      if (current === "deleted") return false;
      const plaintext = decrypt(id, current);
      if (
        plaintext === undefined
          ? expected !== undefined
          : expected === undefined || !Buffer.from(plaintext).equals(expected)
      )
        return false;
      return store.compareAndSwap(id, current, encrypt(id, secret));
    },
    async put(id, secret) {
      const current = await store.get(id);
      decrypt(id, current);
      if (current === "deleted" || !(await store.compareAndSwap(id, current, encrypt(id, secret))))
        throw new Error("Vault write conflict");
    },
    async delete(id) {
      const current = await store.get(id);
      if (current === "deleted") return;
      if (!(await store.compareAndSwap(id, current, "deleted")))
        throw new Error("Vault write conflict");
    },
  };
}
