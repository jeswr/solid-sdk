// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers

import type { CredentialStore } from "@jeswr/agent-credentials";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { z } from "zod";
import { boundary, parse, Secret, VaultError } from "./safe.js";

export function recordKey(scope: string, key: string): string {
  return createHash("sha256")
    .update(JSON.stringify([scope, key]))
    .digest("hex")
    .slice(0, 32);
}
export interface KeyProvider {
  key(): Promise<Secret<Uint8Array>>;
}
const keySchema = z.strictObject({ key: z.string().regex(/^[a-f0-9]{64}$/) });
export class FileKeyProvider implements KeyProvider {
  readonly #store: CredentialStore;
  constructor(store: CredentialStore) {
    this.#store = store;
  }
  key(): Promise<Secret<Uint8Array>> {
    return boundary(() =>
      this.#store.withLock("vault-encryption-key", async () => {
        const name = "encryption-key";
        let r = this.#store.privateRecord(name, keySchema);
        if (!r) {
          r = { key: randomBytes(32).toString("hex") };
          this.#store.putPrivateRecord(name, keySchema, r);
        }
        return new Secret(Buffer.from(r.key, "hex"));
      }),
    );
  }
}
const envelope = z.strictObject({
  version: z.literal(1),
  iv: z.string(),
  tag: z.string(),
  data: z.string(),
});
export class EncryptedRecords {
  readonly #store: CredentialStore;
  readonly #keys: KeyProvider;
  constructor(store: CredentialStore, keys: KeyProvider = new FileKeyProvider(store)) {
    this.#store = store;
    this.#keys = keys;
  }
  #decrypt<T>(
    scope: string,
    key: string,
    schema: z.ZodType<T>,
    r: z.infer<typeof envelope>,
    keyBytes: Uint8Array,
  ): T {
    if (keyBytes.length !== 32) throw new VaultError("invalid");
    const iv = Buffer.from(r.iv, "base64");
    const tag = Buffer.from(r.tag, "base64");
    if (iv.length !== 12 || tag.length !== 16) throw new VaultError("invalid");
    const cipher = createDecipheriv("aes-256-gcm", keyBytes, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(JSON.stringify([scope, key])));
    cipher.setAuthTag(tag);
    return parse(
      schema,
      JSON.parse(
        Buffer.concat([cipher.update(Buffer.from(r.data, "base64")), cipher.final()]).toString(
          "utf8",
        ),
      ),
    );
  }
  #write<T>(scope: string, key: string, schema: z.ZodType<T>, value: T, keyBytes: Uint8Array) {
    const valid = parse(schema, value);
    if (keyBytes.length !== 32) throw new VaultError("invalid");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", keyBytes, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(JSON.stringify([scope, key])));
    // Serialization must precede diagnostic wrapping of values.
    const data = Buffer.concat([cipher.update(JSON.stringify(valid)), cipher.final()]);
    this.#store.putPrivateRecord(recordKey(scope, key), envelope, {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    });
  }
  get<T>(scope: string, key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    return boundary(async () => {
      const name = recordKey(scope, key);
      const r = this.#store.privateRecord(name, envelope);
      if (!r) return undefined;
      return (await this.#keys.key()).use((keyBytes) =>
        this.#decrypt(scope, key, schema, r, keyBytes),
      );
    });
  }
  put<T>(scope: string, key: string, schema: z.ZodType<T>, value: T): Promise<void> {
    return boundary(async () => {
      const valid = parse(schema, value);
      const secret = await this.#keys.key();
      await this.#store.withLock(recordKey(scope, key), async () => {
        await secret.use((keyBytes) => this.#write(scope, key, schema, valid, keyBytes));
      });
    });
  }
  /** Atomic read/modify/write; returning undefined skips the commit. No await after change. */
  update<T>(
    scope: string,
    key: string,
    schema: z.ZodType<T>,
    change: (current: T | undefined) => T | undefined,
  ): Promise<void> {
    return boundary(async () => {
      // Acquire keys before the record lock: a delayed key provider cannot hold up revocation.
      const secret = await this.#keys.key();
      await this.#store.withLock(recordKey(scope, key), async () => {
        await secret.use((keyBytes) => {
          const r = this.#store.privateRecord(recordKey(scope, key), envelope);
          const current = r ? this.#decrypt(scope, key, schema, r, keyBytes) : undefined;
          const next = change(current);
          if (next !== undefined) this.#write(scope, key, schema, next, keyBytes);
        });
      });
    });
  }
}
