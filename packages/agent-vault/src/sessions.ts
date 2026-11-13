// AUTHORED-BY Codex GPT-6.1-Sol
import type { Cookie, SessionBundle, SessionProvider } from "@jeswr/site-executor";
import { z } from "zod";
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
export const cookieSchema = z.strictObject({
  name: z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
  value: z
    .string()
    .max(8192)
    .regex(/^[\x21-\x3A\x3C-\x7E]*$/),
  domain: z.string().min(1).max(253),
  path: z.string().startsWith("/").max(2000),
  expires: z.number().finite().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  hostOnly: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});
export const tokensSchema = z.strictObject({
  access: z
    .string()
    .min(1)
    .max(8192)
    .regex(/^[\x21-\x7e]+$/),
  refresh: z.string().min(1).max(8192).optional(),
  expiresAt: z.number().finite().nonnegative(),
  tokenEndpoint: z.string().optional(),
});
export type Tokens = z.infer<typeof tokensSchema>;
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
  store(state: SessionState): Promise<void> {
    return boundary(async () => {
      const r = parse(stateSchema, state);
      r.site = origin(r.site);
      r.bundle = this.validate(r.site, r.bundle);
      if (r.tokens?.tokenEndpoint) sameSiteUrl(r.site, r.tokens.tokenEndpoint);
      if (r.tokens) r.bundle.headers = { authorization: `Bearer ${r.tokens.access}` };
      await this.#records.put("sessions", this.#key(r.site, r.account), stateSchema, r);
    });
  }
  get(site: string, account?: string): Promise<SessionBundle | undefined> {
    return boundary(async () => {
      const state = await this.state(site, account ?? "");
      return state?.use((r) => {
        if (r.stale || (r.tokens && r.tokens.expiresAt <= this.#now())) return undefined;
        const cookies = r.bundle.cookies
          .filter((c) => c.expires === undefined || c.expires < 0 || c.expires * 1000 > this.#now())
          .map((c) => ({ ...c }));
        if (!cookies.length && !r.bundle.headers) return undefined;
        return opaque({
          cookies,
          ...(r.bundle.headers ? { headers: { ...r.bundle.headers } } : {}),
        });
      });
    });
  }
  update(site: string, account: string | undefined, bundle: SessionBundle): Promise<void> {
    return boundary(async () => {
      const existing = await this.state(site, account ?? "");
      const save = (r?: SessionState) =>
        this.store({
          site: origin(site),
          account: account ?? "",
          bundle,
          tokens: r?.tokens,
          capturedAt: r?.capturedAt ?? this.#now(),
          stale: r?.stale ?? false,
        });
      if (existing) await existing.use(save);
      else await save();
    });
  }
  /** Explicit host login boundary; discard stale bearer metadata before executor cookie updates. */
  beginLogin(site: string, account: string): Promise<void> {
    return this.store({
      site,
      account,
      bundle: { cookies: [] },
      capturedAt: this.#now(),
      stale: false,
    });
  }
  stale(site: string, account: string): Promise<void> {
    return boundary(async () => {
      const state = await this.state(site, account);
      if (state) await state.use((r) => this.store({ ...r, stale: true }));
    });
  }
}
export type { Cookie, SessionBundle };
