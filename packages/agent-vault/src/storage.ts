// AUTHORED-BY Codex GPT-6.1-Sol
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
  get<T>(scope: string, key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    return boundary(async () => {
      const name = recordKey(scope, key);
      const r = this.#store.privateRecord(name, envelope);
      if (!r) return undefined;
      return (await this.#keys.key()).use((keyBytes) => {
        if (keyBytes.length !== 32) throw new VaultError("invalid");
        const cipher = createDecipheriv("aes-256-gcm", keyBytes, Buffer.from(r.iv, "base64"));
        cipher.setAAD(Buffer.from(JSON.stringify([scope, key])));
        cipher.setAuthTag(Buffer.from(r.tag, "base64"));
        return parse(
          schema,
          JSON.parse(
            Buffer.concat([cipher.update(Buffer.from(r.data, "base64")), cipher.final()]).toString(
              "utf8",
            ),
          ),
        );
      });
    });
  }
  put<T>(scope: string, key: string, schema: z.ZodType<T>, value: T): Promise<void> {
    return boundary(async () => {
      const valid = parse(schema, value);
      await (await this.#keys.key()).use((keyBytes) => {
        if (keyBytes.length !== 32) throw new VaultError("invalid");
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", keyBytes, iv);
        cipher.setAAD(Buffer.from(JSON.stringify([scope, key])));
        // Serialization must precede diagnostic wrapping of values.
        const data = Buffer.concat([cipher.update(JSON.stringify(valid)), cipher.final()]);
        this.#store.putPrivateRecord(recordKey(scope, key), envelope, {
          version: 1,
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          data: data.toString("base64"),
        });
      });
    });
  }
}
