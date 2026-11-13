// AUTHORED-BY Codex GPT-6.1-Sol
import type { CredentialStore } from "@jeswr/agent-credentials";
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
const decision = z.strictObject({ decision: z.enum(["always-for-site", "never", "revoked"]) });
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
      const saved = this.#store.privateRecord(key, decision)?.decision;
      if (saved === "never") throw new VaultError("denied");
      if (saved === "always-for-site") return;
      const answer = await this.#asker.ask(Object.freeze(r));
      if (answer === "always-for-site" || answer === "never")
        this.#store.putPrivateRecord(key, decision, { decision: answer });
      if (answer !== "once" && answer !== "always-for-site") throw new VaultError("denied");
    });
  }
  revoke(request: PermissionRequest, item: string): Promise<void> {
    return boundary(() => {
      this.#store.putPrivateRecord(this.#key(request, item), decision, { decision: "revoked" });
    });
  }
}
