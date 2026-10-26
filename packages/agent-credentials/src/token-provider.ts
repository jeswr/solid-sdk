// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { accessToken, type Deps } from "./operations.js";
import { noTransport } from "./providers.js";
import {
  type CredentialStore,
  HelperError,
  type Profile,
  type TokenFile,
  type TokenFileProvider,
} from "./store.js";

/** The channel-facing seam. Account is the registry connection id, never a token profile name. */
export interface TokenProvider {
  read(account: string): Promise<string>;
  send(account: string): Promise<string>;
}

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

  read(account: string): Promise<string> {
    return this.forPurpose(account, "read");
  }
  send(account: string): Promise<string> {
    return this.forPurpose(account, "send");
  }

  private async forPurpose(account: string, purpose: "read" | "send"): Promise<string> {
    const store = this.deps.store;
    if (this.provider === "google" || this.provider === "microsoft") {
      const profiles = store
        .profiles()
        .map((name) => store.profile(name) as Profile)
        .filter(
          (p) =>
            p.provider === this.provider &&
            p.connectionId === account &&
            p.purpose === purpose &&
            p.resource === this.resource,
        );
      if (profiles.length !== 1)
        throw new HelperError("setup", "exactly one matching credential profile is required");
      return (
        await accessToken(this.deps, (profiles[0] as Profile).name, {
          provider: this.provider,
          connectionId: account,
          purpose,
          resource: this.resource,
        })
      ).token;
    }
    const records = store
      .tokenFiles()
      .map((name) => store.tokenFile(name) as TokenFile)
      .filter(
        (t) => t.provider === this.provider && t.account === account && t.purpose === purpose,
      );
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
