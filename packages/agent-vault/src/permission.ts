// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import type { CredentialStore } from "@jeswr/agent-credentials";
import { randomUUID } from "crypto";
import { z } from "zod";
import { boundary, origin, VaultError } from "./safe.js";
import { recordKey } from "./storage.js";
export type Purpose = "login" | "save" | "totp";
export interface PermissionRequest {
  site: string;
  account: string;
  backend: string;
  purpose: Purpose;
}
export interface PermissionAsker {
  ask(request: PermissionRequest): Promise<"once" | "always-for-site" | "never">;
}
const decision = z.strictObject({
  decision: z.enum(["always-for-site", "never", "revoked"]),
  revision: z.string().uuid().optional(),
});
export class PermissionPolicy {
  readonly #store: CredentialStore;
  readonly #asker: PermissionAsker;
  constructor(store: CredentialStore, asker: PermissionAsker) {
    this.#store = store;
    this.#asker = asker;
  }
  #key(r: PermissionRequest, item: string) {
    return recordKey(
      "permission",
      JSON.stringify([r.backend, item, origin(r.site), r.account, r.purpose]),
    );
  }
  check(request: PermissionRequest, item: string): Promise<void> {
    return boundary(async () => {
      const r = { ...request, site: origin(request.site) };
      const key = this.#key(r, item);
      const saved = this.#store.privateRecord(key, decision);
      if (saved?.decision === "never") throw new VaultError("denied");
      if (saved?.decision === "always-for-site") return;
      const answer = await this.#asker.ask(Object.freeze(r));
      await this.#store.withLock(key, async () => {
        const current = this.#store.privateRecord(key, decision);
        // A denial wins even if its own prompt is older than an intervening grant.
        if (answer === "never") {
          this.#store.putPrivateRecord(key, decision, {
            decision: "never",
            revision: randomUUID(),
          });
          throw new VaultError("denied");
        }
        if (current?.decision === "never" || current?.revision !== saved?.revision)
          throw new VaultError("denied");
        if (answer === "always-for-site")
          this.#store.putPrivateRecord(key, decision, { decision: answer, revision: randomUUID() });
        else if (answer !== "once") throw new VaultError("denied");
      });
    });
  }
  revoke(request: PermissionRequest, item: string): Promise<void> {
    return boundary(async () => {
      const key = this.#key(request, item);
      await this.#store.withLock(key, async () => {
        this.#store.putPrivateRecord(key, decision, {
          decision: "revoked",
          revision: randomUUID(),
        });
      });
    });
  }
}
