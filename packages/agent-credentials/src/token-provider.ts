// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { AccountRef, ReadGrant, SendGrant, TokenProvider } from "@jeswr/agent-channels";
import { accessToken, type Deps } from "./operations.js";
import { noTransport } from "./providers.js";
import {
  type CredentialStore,
  HelperError,
  type Profile,
  type TokenFile,
  type TokenFileProvider,
} from "./store.js";

/** The channel contract uses registry account references and purpose-tagged grants. */
export type { TokenProvider } from "@jeswr/agent-channels";

/** Select exactly one profile for a provider/account/resource/purpose; never fall back across purposes. */
export class StoreTokenProvider implements TokenProvider {
  private readonly deps: Deps;
  constructor(
    private readonly provider: Profile["provider"] | TokenFileProvider,
    options: {
      store: CredentialStore;
      transport?: Deps["transport"];
      now?: Deps["now"];
      resource?: Profile["resource"];
    },
  ) {
    this.deps = {
      store: options.store,
      transport: options.transport ?? noTransport,
      now: options.now ?? (() => new Date()),
    };
    this.resource = options.resource ?? "mail";
  }
  private readonly resource: Profile["resource"];

  async read(account: AccountRef): Promise<ReadGrant> {
    return { access: "read", accessToken: await this.forPurpose(account, "read") };
  }
  async send(account: AccountRef): Promise<SendGrant> {
    return { access: "send", accessToken: await this.forPurpose(account, "send") };
  }

  private async forPurpose(account: AccountRef, purpose: "read" | "send"): Promise<string> {
    // Read an untrusted reference once; selection and issuance must use the same id.
    let id: unknown;
    try {
      id = account?.id;
    } catch {
      throw new HelperError("invalid", "invalid account reference");
    }
    if (typeof id !== "string" || !id || id.length > 2048)
      throw new HelperError("invalid", "invalid account reference");
    const store = this.deps.store;
    if (this.provider === "google" || this.provider === "microsoft") {
      const profiles = store
        .profiles()
        .map((name) => store.profile(name) as Profile)
        .filter(
          (p) =>
            p.provider === this.provider &&
            p.connectionId === id &&
            p.purpose === purpose &&
            p.resource === this.resource,
        );
      if (profiles.length !== 1)
        throw new HelperError("setup", "exactly one matching credential profile is required");
      return (
        await accessToken(this.deps, (profiles[0] as Profile).name, {
          provider: this.provider,
          connectionId: id,
          purpose,
          resource: this.resource,
        })
      ).token;
    }
    const records = store
      .tokenFiles()
      .map((name) => store.tokenFile(name) as TokenFile)
      .filter((t) => t.provider === this.provider && t.account === id && t.purpose === purpose);
    if (records.length !== 1)
      throw new HelperError("setup", "exactly one matching token file is required");
    const record = records[0] as TokenFile;
    if (
      record.expiresAt !== undefined &&
      !(Date.parse(record.expiresAt) > this.deps.now().getTime())
    )
      throw new HelperError("revoked", "the provisioned token has expired");
    return record.token;
  }
}
