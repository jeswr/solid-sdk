// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers

import type { CredentialStore } from "@jeswr/agent-credentials";
import { randomUUID } from "crypto";
import { z } from "zod";
import { boundary, origin, parse, Secret, VaultError } from "../safe.js";
import { EncryptedRecords, type KeyProvider, recordKey } from "../storage.js";
import { type LoginItem, loginSchema, type SecretBackend, type SecretRef } from "./types.js";

const indexSchema = z.array(z.strictObject({ ref: z.string(), site: z.string() }));
export class LocalEncryptedBackend implements SecretBackend {
  readonly id: string;
  get profiles(): readonly string[] {
    return [this.#profile];
  }
  readonly #profile: string;
  readonly #scope: string;
  readonly #store: CredentialStore;
  readonly #records: EncryptedRecords;
  constructor(options: {
    store: CredentialStore;
    profile: string;
    id?: string;
    keys?: KeyProvider;
  }) {
    this.id = options.id ?? `local-${options.profile}`;
    this.#profile = options.profile;
    this.#scope = JSON.stringify([this.id, this.#profile]);
    this.#store = options.store;
    this.#records = new EncryptedRecords(options.store, options.keys);
  }
  profileFor(): string {
    return this.#profile;
  }
  #ref(ref: string): SecretRef {
    return { backend: this.id, ref, profile: this.#profile };
  }
  find(site: string): Promise<SecretRef[]> {
    return boundary(async () => {
      const target = origin(site);
      return ((await this.#records.get(this.#scope, "index", indexSchema)) ?? [])
        .filter((r) => r.site === target)
        .map((r) => this.#ref(r.ref));
    });
  }
  read(ref: string, purpose: "login"): Promise<Secret<LoginItem>> {
    return boundary(async () => {
      if (purpose !== "login") throw new VaultError("denied");
      const item = await this.#records.get(this.#scope, ref, loginSchema);
      if (!item) throw new VaultError("missing");
      delete item.totp;
      return new Secret(item);
    });
  }
  save(item: Secret<LoginItem>): Promise<SecretRef> {
    return boundary(() =>
      item.use(async (raw) => {
        const value = parse(loginSchema, raw);
        value.site = origin(value.site);
        return this.#store.withLock(recordKey("local-lock", this.#scope), async () => {
          const index = (await this.#records.get(this.#scope, "index", indexSchema)) ?? [];
          const ref = value.ref ?? randomUUID();
          if (ref === "index") throw new VaultError("invalid");
          const old = index.find((r) => r.ref === ref);
          if (old && old.site !== value.site) throw new VaultError("denied");
          await this.#records.put(this.#scope, ref, loginSchema, value);
          await this.#records.put(this.#scope, "index", indexSchema, [
            ...index.filter((r) => r.ref !== ref),
            { ref, site: value.site },
          ]);
          return this.#ref(ref);
        });
      }),
    );
  }
}
