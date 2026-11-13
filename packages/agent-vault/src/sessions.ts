// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import type { Cookie, SessionBundle as ExecutorSessionBundle } from "@jeswr/site-executor";
import { randomUUID } from "crypto";
import { z } from "zod";
import { cookieSchema, tokensSchema } from "./browser.js";
import {
  boundary,
  identifier,
  opaque,
  origin,
  parse,
  Secret,
  sameSiteUrl,
  VaultError,
} from "./safe.js";
import type { EncryptedRecords } from "./storage.js";

export { cookieSchema, tokensSchema } from "./browser.js";
export type Tokens = z.infer<typeof tokensSchema>;
// Structural until the executor's additive revision field is available in this lane.
export type SessionBundle = ExecutorSessionBundle & { revision?: string };
// Structural until the executor's acknowledged-update contract is available in this lane.
export interface SessionUpdateResult {
  accepted: boolean;
  revision?: string;
}
export interface SessionProvider {
  get(site: string, persona?: string): Promise<SessionBundle | undefined>;
  update(
    site: string,
    persona: string | undefined,
    bundle: SessionBundle,
  ): Promise<SessionUpdateResult>;
}
/** Host-held binding created before starting a password or interactive login. */
export interface LoginTransaction {
  readonly site: string;
  readonly account: string;
  readonly generation: string;
}
const bundleSchema = z.strictObject({
  cookies: z.array(cookieSchema).max(300),
  headers: z.record(z.string(), z.string().max(8192)).optional(),
});
export const stateSchema = z.strictObject({
  site: z.string(),
  account: identifier,
  bundle: bundleSchema,
  tokens: tokensSchema.optional(),
  capturedAt: z.number().finite(),
  stale: z.boolean(),
  revision: z.string().uuid().optional(),
  generation: z.string().uuid().optional(),
});
export type SessionState = z.infer<typeof stateSchema>;
export class SessionStore implements SessionProvider {
  readonly #records: EncryptedRecords;
  readonly #now: () => number;
  readonly #parents: readonly string[];
  constructor(
    records: EncryptedRecords,
    options: { now?: () => number; cookieDomains?: readonly string[] } = {},
  ) {
    this.#records = records;
    this.#now = options.now ?? Date.now;
    this.#parents = options.cookieDomains ?? [];
  }
  #key(site: string, account?: string) {
    if (!account) throw new VaultError("invalid");
    return JSON.stringify([origin(site), account]);
  }
  validate(site: string, input: SessionBundle): SessionBundle {
    const s = origin(site);
    const host = new URL(s).hostname;
    const b = parse(bundleSchema, input);
    for (const c of b.cookies) {
      c.domain = c.domain.replace(/^\./, "").toLowerCase();
      const exact = c.domain === host;
      const parent =
        this.#parents.includes(c.domain) &&
        host.endsWith(`.${c.domain}`) &&
        !/^[\d.]+$/.test(host) &&
        !host.startsWith("[");
      if (!exact && (c.hostOnly || !parent)) throw new VaultError("invalid");
      if (!/^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[::1\])$/.test(c.domain))
        throw new VaultError("invalid");
      if (c.name.startsWith("__Host-") && (!c.secure || !c.hostOnly || c.path !== "/"))
        throw new VaultError("invalid");
      if (c.name.startsWith("__Secure-") && !c.secure) throw new VaultError("invalid");
      if (c.sameSite === "None" && !c.secure) throw new VaultError("invalid");
    }
    // Only a bearer authorization header is accepted; no arbitrary transport/framing headers.
    for (const [key, value] of Object.entries(b.headers ?? {}))
      if (key.toLowerCase() !== "authorization" || !/^Bearer [\x21-\x7e]+$/.test(value))
        throw new VaultError("invalid");
    return b;
  }
  state(site: string, account: string): Promise<Secret<SessionState> | undefined> {
    return boundary(async () => {
      const r = await this.#records.get("sessions", this.#key(site, account), stateSchema);
      if (!r) return undefined;
      if (r.site !== origin(site) || r.account !== account) throw new VaultError("invalid");
      r.bundle = this.validate(site, r.bundle);
      return new Secret(r);
    });
  }
  #prepare(state: SessionState): SessionState {
    const r = parse(stateSchema, state);
    r.site = origin(r.site);
    r.bundle = this.validate(r.site, r.bundle);
    if (r.tokens?.tokenEndpoint) sameSiteUrl(r.site, r.tokens.tokenEndpoint);
    if (r.tokens) r.bundle.headers = { authorization: `Bearer ${r.tokens.access}` };
    r.revision = randomUUID();
    r.generation ??= randomUUID();
    return r;
  }
  async #replace(state: SessionState): Promise<SessionState> {
    const input = parse(stateSchema, state);
    const snapshot = await this.state(input.site, input.account);
    const revision = await snapshot?.use((r) => r.revision);
    if (input.revision !== undefined && input.revision !== revision) throw new VaultError("denied");
    let written: SessionState | undefined;
    await this.#records.update(
      "sessions",
      this.#key(input.site, input.account),
      stateSchema,
      (current) => {
        if (current?.revision !== revision || !!current !== !!snapshot)
          throw new VaultError("denied");
        written = this.#prepare({ ...input, generation: randomUUID() });
        return written;
      },
    );
    if (!written) throw new VaultError("denied");
    return written;
  }
  /** Host replacement; a superseded write refuses instead of overwriting a newer record. */
  store(state: SessionState): Promise<void> {
    return boundary(async () => {
      await this.#replace(state);
    });
  }
  #sameLogin(current: SessionState | undefined, expected: LoginTransaction): boolean {
    return (
      !!current &&
      !!expected.generation &&
      current.site === origin(expected.site) &&
      current.account === expected.account &&
      current.generation === expected.generation
    );
  }
  /** Accept only the login generation that the host bound before the browser transaction. */
  storeCapture(state: SessionState, expected: LoginTransaction): Promise<void> {
    return boundary(async () => {
      const snapshot = parse(stateSchema, state);
      if (origin(snapshot.site) !== origin(expected.site) || snapshot.account !== expected.account)
        throw new VaultError("invalid");
      await this.#records.update(
        "sessions",
        this.#key(snapshot.site, snapshot.account),
        stateSchema,
        (current) => {
          if (!this.#sameLogin(current, expected) || current?.stale) throw new VaultError("denied");
          return this.#prepare({ ...snapshot, generation: expected.generation });
        },
      );
    });
  }
  /** Scheduler-only commit: compare the snapshot and cancellation under the record lock. */
  commit(state: SessionState, cancelled: () => boolean): Promise<void> {
    return boundary(async () => {
      const snapshot = parse(stateSchema, state);
      await this.#records.update(
        "sessions",
        this.#key(snapshot.site, snapshot.account),
        stateSchema,
        (current) => {
          if (cancelled() || !current || current.revision !== snapshot.revision) return undefined;
          return this.#prepare(snapshot);
        },
      );
    });
  }
  get(site: string, account?: string, generation?: string): Promise<SessionBundle | undefined> {
    return boundary(async () => {
      const state = await this.state(site, account ?? "");
      return state?.use((r) => {
        if (generation !== undefined && r.generation !== generation) return undefined;
        return this.#bundle(r);
      });
    });
  }
  #bundle(r: SessionState): SessionBundle | undefined {
    if (r.stale || (r.tokens && r.tokens.expiresAt <= this.#now())) return undefined;
    const bundle = this.validate(r.site, r.bundle);
    const cookies = bundle.cookies
      .filter((c) => c.expires === undefined || c.expires < 0 || c.expires * 1000 > this.#now())
      .map((c) => ({ ...c }));
    // An explicit login reset supplies a revision even before its first cookie arrives.
    if (!cookies.length && !bundle.headers && bundle.cookies.length) return undefined;
    return opaque({
      cookies,
      ...(bundle.headers ? { headers: { ...bundle.headers } } : {}),
      revision: r.revision,
    });
  }
  /** Callback capability restricted to this site, account and login generation. */
  forLogin(transaction: LoginTransaction): SessionProvider {
    const expected = Object.freeze({
      site: origin(transaction.site),
      account: transaction.account,
      generation: transaction.generation,
    });
    return Object.freeze({
      get: (site: string, account?: string) => this.#getLogin(site, account, expected),
      update: (site: string, account: string | undefined, bundle: SessionBundle) =>
        this.#update(site, account, bundle, expected),
    });
  }
  #getLogin(
    site: string,
    account: string | undefined,
    expected: LoginTransaction,
  ): Promise<SessionBundle | undefined> {
    return boundary(async () => {
      if (origin(site) !== expected.site || account !== expected.account) return undefined;
      let bundle: SessionBundle | undefined;
      // Read after key acquisition under the same lock as writes and revocation.
      await this.#records.update("sessions", this.#key(site, account), stateSchema, (r) => {
        if (r && this.#sameLogin(r, expected)) bundle = this.#bundle(r);
        return undefined;
      });
      return bundle;
    });
  }
  update(
    site: string,
    account: string | undefined,
    bundle: SessionBundle,
  ): Promise<SessionUpdateResult> {
    return this.#update(site, account, bundle);
  }
  #update(
    site: string,
    account: string | undefined,
    bundle: SessionBundle,
    expected?: LoginTransaction,
  ): Promise<SessionUpdateResult> {
    return boundary(async () => {
      if (expected && (origin(site) !== expected.site || account !== expected.account))
        return { accepted: false };
      const { revision, ...material } = bundle;
      let result: SessionUpdateResult = { accepted: false };
      await this.#records.update("sessions", this.#key(site, account), stateSchema, (r) => {
        if (
          !r ||
          r.stale ||
          !revision ||
          revision !== r.revision ||
          (expected && !this.#sameLogin(r, expected))
        )
          return undefined;
        const next = this.#prepare({ ...r, bundle: material });
        result = { accepted: true, revision: next.revision };
        return next;
      });
      return result;
    });
  }
  /** Explicit host login boundary; discard stale bearer metadata before executor cookie updates. */
  beginLogin(site: string, account: string): Promise<LoginTransaction> {
    return boundary(async () => {
      const r = await this.#replace({
        site,
        account,
        bundle: { cookies: [] },
        capturedAt: this.#now(),
        stale: false,
      });
      if (!r.generation) throw new VaultError("denied");
      return Object.freeze({ site: r.site, account: r.account, generation: r.generation });
    });
  }
  stale(site: string, account: string, expected?: LoginTransaction): Promise<void> {
    return boundary(async () => {
      await this.#records.update("sessions", this.#key(site, account), stateSchema, (r) => {
        if (expected && !this.#sameLogin(r, expected)) return undefined;
        return this.#prepare({
          ...(r ?? {
            site: origin(site),
            account,
            bundle: { cookies: [] },
            capturedAt: this.#now(),
          }),
          stale: true,
        });
      });
    });
  }
}
export type { Cookie };
