// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash, createPrivateKey } from "node:crypto";
import {
  type Grant,
  generateSigningKey,
  type OAuthStores,
  type OneTimeStore,
  type SessionVault,
  type SigningKey,
} from "@jeswr/mcp-oauth";

export const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
export const decode = <T>(bytes: Uint8Array): T => JSON.parse(Buffer.from(bytes).toString("utf8"));
export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Store grants and replay tombstones in the same atomic encrypted store as pod sessions. */
export function createVaultOAuthStores(vault: SessionVault, namespace: string): OAuthStores {
  const key = (kind: string, id: string) => `oauth:${digest(namespace)}:${kind}:${digest(id)}`;
  function records<T>(kind: string): OneTimeStore<T> {
    return {
      async get(id) {
        const bytes = await vault.get(key(kind, id));
        return bytes ? decode<{ value: T }>(bytes).value : undefined;
      },
      async put(id, value) {
        if (!(await vault.compareAndSwap(key(kind, id), undefined, encode({ value, used: false }))))
          throw new Error("OAuth record collision");
      },
      async consume(id) {
        for (let attempt = 0; attempt < 16; attempt += 1) {
          const bytes = await vault.get(key(kind, id));
          if (!bytes) return undefined;
          const record = decode<{ value: T; used: boolean }>(bytes);
          if (record.used) return { value: record.value, firstUse: false };
          if (await vault.compareAndSwap(key(kind, id), bytes, encode({ ...record, used: true })))
            return { value: record.value, firstUse: true };
        }
        throw new Error("OAuth store contention");
      },
    };
  }
  return {
    clients: records("clients"),
    pending: records("pending"),
    codes: records("codes"),
    refreshTokens: records("refresh"),
    grants: {
      ...records<Grant>("grants"),
      async revoke(id) {
        for (let attempt = 0; attempt < 16; attempt += 1) {
          const bytes = await vault.get(key("grants", id));
          if (!bytes) return;
          const record = decode<{ value: Grant; used: boolean }>(bytes);
          if (record.value.revoked) return;
          record.value.revoked = true;
          if (await vault.compareAndSwap(key("grants", id), bytes, encode(record))) return;
        }
        throw new Error("OAuth store contention");
      },
      async revokeSession(id) {
        const name = key("retired", id);
        if (await vault.get(name)) return;
        if (
          !(await vault.compareAndSwap(name, undefined, encode(true))) &&
          !(await vault.get(name))
        )
          throw new Error("OAuth store contention");
      },
      async isSessionRevoked(id) {
        return (await vault.get(key("retired", id))) !== undefined;
      },
    },
  };
}

/** Atomic initialization keeps ES256 identity stable across workers and restarts. */
export async function vaultSigningKey(vault: SessionVault, namespace: string): Promise<SigningKey> {
  const name = `oauth:${digest(namespace)}:signing-key`;
  let bytes = await vault.get(name);
  if (!bytes) {
    const key = generateSigningKey();
    const candidate = encode({
      kid: key.kid,
      pem: key.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
    if (await vault.compareAndSwap(name, undefined, candidate)) bytes = candidate;
    else bytes = await vault.get(name);
  }
  if (!bytes) throw new Error("Signing key initialization failed");
  const { kid, pem } = decode<{ kid: string; pem: string }>(bytes);
  return { kid, privateKey: createPrivateKey(pem) };
}
