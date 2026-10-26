// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * The credential helper's private store: ONE dedicated, operator-chosen directory.
 *
 *   <dir>/                 0700, owned by the current user (refused otherwise; never widened)
 *     clients/<provider>.json   OAuth client registration (Google: id + installed-app secret)
 *     profiles/<name>.json      which account a profile is for (no secrets)
 *     grants/<name>.json        the account grant: refresh token, cached access token
 *     locks/<name>.lock         per-profile refresh/login lock (O_EXCL)
 *
 * Every file is 0600. Reads refuse symlinks (O_NOFOLLOW), other owners and group/world access;
 * writes go to a fresh O_EXCL temporary file, are fsynced and renamed over the target, so a crash
 * leaves the old or the new file, never a partial one. Nothing here searches for credentials
 * elsewhere (no keychains, browser profiles or password managers).
 */
import { randomBytes } from "crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "fs";
import { homedir } from "os";
import { isAbsolute, join } from "path";
import { setTimeout as sleep } from "timers/promises";
import { z } from "zod";
import { parseRfc3339 } from "./providers/common.js";

export class HelperError extends Error {
  constructor(
    /**
     * setup: something must be configured first; revoked: consent is missing/withdrawn (re-login);
     * account: the wrong account consented; scope: required scopes were not granted;
     * unavailable: the provider or the store could not be used now; invalid: bad input/answer;
     * refused: the request is not allowed.
     */
    readonly code:
      | "setup"
      | "revoked"
      | "account"
      | "scope"
      | "unavailable"
      | "invalid"
      | "refused",
    message: string,
  ) {
    super(message);
    this.name = "HelperError";
  }
}

const MAX_FILE = 64 * 1024;
export const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const uid = () => {
  if (typeof process.getuid !== "function")
    throw new HelperError("refused", "file ownership cannot be verified on this platform");
  return process.getuid();
};

// ------------------------------------------------------------------ record schemas

/** A strict RFC 3339 instant (finite, real calendar values) — never NaN downstream. */
const iso = z
  .string()
  .max(40)
  .refine((v) => parseRfc3339(v) !== undefined, "not a valid RFC 3339 time");
const secret = z.string().regex(/^[\x21-\x7e]{8,8192}$/);

export const googleClientSchema = z.strictObject({
  version: z.literal(1),
  provider: z.literal("google"),
  clientId: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/),
  /** Google "Desktop app" clients carry a secret that is NOT confidential (RFC 8252 §8.5). */
  clientSecret: z
    .string()
    .regex(/^[\x21-\x7e]{1,200}$/)
    .optional(),
  importedFrom: z.string().max(200),
  importedAt: iso,
});
export const microsoftClientSchema = z.strictObject({
  version: z.literal(1),
  provider: z.literal("microsoft"),
  clientId: z.uuid(),
  addedAt: iso,
});
export type GoogleClient = z.infer<typeof googleClientSchema>;
export type MicrosoftClient = z.infer<typeof microsoftClientSchema>;

export const profileSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().regex(NAME),
  provider: z.enum(["google", "microsoft"]),
  purpose: z.enum(["read", "send"]),
  resource: z.enum(["mail", "calendar", "teams"]),
  /** The dashboard account record (connection id) this profile supplies tokens for. */
  connectionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  /** The exact account the operator chose (address / UPN, lower case). */
  account: z.string().min(3).max(254),
  /** Google: also request calendar.calendarlist.readonly for the explicit inventory command. */
  inventory: z.boolean(),
  /** Microsoft: personal (consumers tenant) or work/school (organizations or one tenant id). */
  microsoft: z
    .strictObject({
      accountType: z.enum(["personal", "work-or-school"]),
      tenant: z.union([z.literal("consumers"), z.literal("organizations"), z.uuid()]),
    })
    .optional(),
  createdAt: iso,
});
export type Profile = z.infer<typeof profileSchema>;

export const grantSchema = z.strictObject({
  version: z.literal(1),
  profile: z.string().regex(NAME),
  provider: z.enum(["google", "microsoft"]),
  purpose: z.enum(["read", "send"]),
  resource: z.enum(["mail", "calendar", "teams"]),
  /** The OAuth client the grant was issued to; a grant never migrates to another client. */
  clientId: z.string().min(1).max(200),
  /** The VERIFIED account (from the signed ID token), pinned at first consent. */
  account: z.strictObject({
    subject: z.string().min(1).max(200),
    tenant: z.string().max(100).optional(),
    username: z.string().max(254),
  }),
  grantedScopes: z.array(z.string().max(300)).max(50),
  state: z.enum(["active", "needs-reconsent"]),
  problem: z.string().max(300).optional(),
  refreshToken: secret.optional(),
  access: z.strictObject({ token: secret, expiresAt: iso }).optional(),
  obtainedAt: iso,
  updatedAt: iso,
});
export type Grant = z.infer<typeof grantSchema>;

// ------------------------------------------------------------------ directory and files

/**
 * Write ALL of `data` to `fd`: writeSync may write fewer bytes than asked (a short write), so
 * loop until done; a call that makes no progress is an error. (`write` is injectable for tests.)
 */
export function writeFully(
  fd: number,
  data: string | Uint8Array,
  write: (fd: number, b: Uint8Array, off: number, len: number) => number = (f, b, o, l) =>
    writeSync(f, b, o, l),
): void {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  let off = 0;
  while (off < buf.byteLength) {
    const n = write(fd, buf, off, buf.byteLength - off);
    if (!Number.isInteger(n) || n <= 0)
      throw new HelperError("unavailable", "a write made no progress");
    off += n;
  }
}

function checkOwnerOnly(path: string, kind: "directory" | "file"): void {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) throw new HelperError("refused", `${path} is a symbolic link (refused)`);
  if (kind === "directory" ? !st.isDirectory() : !st.isFile())
    throw new HelperError("refused", `${path} is not a ${kind}`);
  if (st.uid !== uid())
    throw new HelperError("refused", `${path} is owned by another user (refused)`);
  if (st.mode & 0o077)
    throw new HelperError(
      "refused",
      `${path} is accessible to other users; restrict it (chmod ${kind === "directory" ? "700" : "600"}) — the helper never widens or silently changes permissions`,
    );
}

/** Records are validated before they are written: an invalid record never replaces a valid one. */
function validFor(schema: z.ZodType, value: unknown): void {
  if (!schema.safeParse(value).success)
    throw new HelperError("invalid", "refused to store an invalid record");
}

function ensureDir(path: string): void {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT")
      throw new HelperError("setup", `the parent directory of ${path} does not exist`);
    if (code !== "EEXIST") throw error;
  }
  checkOwnerOnly(path, "directory");
}

/** Construct the platform default without opening or creating any directory. */
export function defaultStoreDir(
  options: { platform?: string; home?: string; xdgDataHome?: string } = {},
): string {
  const home = options.home ?? homedir();
  if ((options.platform ?? process.platform) === "darwin")
    return join(home, "Library", "Application Support", "jeswr-agent");
  const xdg = options.xdgDataHome ?? process.env.XDG_DATA_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, ".local", "share"), "jeswr-agent");
}

export const tokenFileProviders = [
  "anthropic",
  "openai",
  "slack",
  "matrix",
  "discord",
  "telegram",
  "bluesky",
  "mastodon",
] as const;
export type TokenFileProvider = (typeof tokenFileProviders)[number];
export const tokenFileSchema = z.strictObject({
  version: z.literal(1),
  name: z.string().regex(NAME),
  provider: z.enum(tokenFileProviders),
  account: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  purpose: z.enum(["read", "send"]),
  token: secret,
  expiresAt: iso.optional(),
  credentialRef: z
    .string()
    .max(1000)
    .regex(/^op:\/\/[^\s/]+\/[^\s/]+\/[^\s]+$/),
});
export type TokenFile = z.infer<typeof tokenFileSchema>;

export class CredentialStore {
  readonly dir: string;

  /** Opens (creating it 0700 if absent; its parent must exist) the dedicated store directory. */
  constructor(options: string | { dir?: string } = {}) {
    const dir = typeof options === "string" ? options : (options.dir ?? defaultStoreDir());
    if (!isAbsolute(dir)) throw new HelperError("invalid", "--dir must be an absolute path");
    this.dir = dir;
    ensureDir(dir);
    for (const sub of ["clients", "profiles", "grants", "providers", "locks", "ledger"])
      ensureDir(join(dir, sub));
  }

  private path(sub: "clients" | "profiles" | "grants" | "providers", name: string): string {
    if (!NAME.test(name)) throw new HelperError("invalid", `invalid name “${name}”`);
    return join(this.dir, sub, `${name}.json`);
  }

  private guard(path: string): void {
    checkOwnerOnly(this.dir, "directory");
    checkOwnerOnly(join(path, ".."), "directory");
  }

  private read<T>(path: string, schema: z.ZodType<T>): T | undefined {
    this.guard(path);
    let fd: number;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      if (code === "ELOOP" || code === "EMLINK")
        throw new HelperError("refused", `${path} is a symbolic link (refused)`);
      throw new HelperError("unavailable", `${path} cannot be read`);
    }
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) throw new HelperError("refused", `${path} is not a file`);
      if (st.uid !== uid())
        throw new HelperError("refused", `${path} is owned by another user (refused)`);
      if (st.mode & 0o077)
        throw new HelperError(
          "refused",
          `${path} is accessible to other users; restrict it (chmod 600)`,
        );
      if (st.size > MAX_FILE) throw new HelperError("invalid", `${path} is too large`);
      const text = readFileSync(fd, "utf8");
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new HelperError("invalid", `${path} is corrupt (not JSON)`);
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success)
        throw new HelperError("invalid", `${path} is corrupt (unexpected shape)`);
      return parsed.data;
    } finally {
      closeSync(fd);
    }
  }

  /** Atomic, private replacement of one record. */
  private write(path: string, value: unknown): void {
    this.guard(path);
    try {
      checkOwnerOnly(path, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    const fd = openSync(
      tmp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      // Every byte is written and synced BEFORE the rename: a failure leaves the old record.
      writeFully(fd, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(fd);
      closeSync(fd);
      renameSync(tmp, path);
    } catch (error) {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
      try {
        unlinkSync(tmp);
      } catch {
        // nothing to clean up
      }
      throw error;
    }
    try {
      const d = openSync(join(path, ".."), constants.O_RDONLY);
      try {
        fsyncSync(d);
      } finally {
        closeSync(d);
      }
    } catch {
      // directory fsync is best effort (not supported everywhere)
    }
  }

  googleClient(): GoogleClient | undefined {
    return this.read(join(this.dir, "clients", "google.json"), googleClientSchema);
  }
  microsoftClient(): MicrosoftClient | undefined {
    return this.read(join(this.dir, "clients", "microsoft.json"), microsoftClientSchema);
  }
  putClient(client: GoogleClient | MicrosoftClient): void {
    validFor(client.provider === "google" ? googleClientSchema : microsoftClientSchema, client);
    this.write(join(this.dir, "clients", `${client.provider}.json`), client);
  }

  profile(name: string): Profile | undefined {
    return this.read(this.path("profiles", name), profileSchema);
  }
  profiles(): string[] {
    this.guard(join(this.dir, "profiles", "probe"));
    return readdirSync(join(this.dir, "profiles"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .filter((n) => NAME.test(n))
      .sort();
  }
  putProfile(p: Profile): void {
    validFor(profileSchema, p);
    this.write(this.path("profiles", p.name), p);
  }

  grant(name: string): Grant | undefined {
    return this.read(this.path("grants", name), grantSchema);
  }
  putGrant(g: Grant): void {
    validFor(grantSchema, g);
    this.write(this.path("grants", g.profile), g);
  }
  /** A privately provisioned token, with a purpose independent of its scopes. */
  tokenFile(name: string): TokenFile | undefined {
    return this.read(this.path("providers", name), tokenFileSchema);
  }
  putTokenFile(record: TokenFile): void {
    validFor(tokenFileSchema, record);
    this.write(this.path("providers", record.name), record);
  }
  tokenFiles(): string[] {
    this.guard(join(this.dir, "providers", "probe"));
    return readdirSync(join(this.dir, "providers"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .filter((n) => NAME.test(n))
      .sort();
  }

  removeGrant(name: string): boolean {
    const p = this.path("grants", name);
    this.guard(p);
    try {
      checkOwnerOnly(p, "file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    unlinkSync(p);
    return true;
  }

  /**
   * Run `fn` holding the profile's exclusive lock (across processes). A lock older than
   * `staleMs` is from a crashed holder and is broken; waiting is bounded.
   */
  async withLock<T>(
    name: string,
    fn: () => Promise<T>,
    opts: { waitMs?: number; staleMs?: number } = {},
  ): Promise<T> {
    if (!NAME.test(name)) throw new HelperError("invalid", `invalid name “${name}”`);
    const path = join(this.dir, "locks", `${name}.lock`);
    this.guard(path);
    const deadline = Date.now() + (opts.waitMs ?? 20_000);
    const staleMs = opts.staleMs ?? 60_000;
    for (;;) {
      try {
        const fd = openSync(
          path,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          writeFully(fd, `${process.pid}\n`);
        } catch (error) {
          closeSync(fd);
          unlinkSync(path); // never leave a lock we do not hold
          throw error;
        }
        closeSync(fd);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          checkOwnerOnly(path, "file");
          if (Date.now() - lstatSync(path).mtimeMs > staleMs) unlinkSync(path);
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code !== "ENOENT") throw lockError;
        }
        if (Date.now() > deadline)
          throw new HelperError("unavailable", "another helper process holds this profile's lock");
        await sleep(20 + Math.floor(Math.random() * 30));
      }
    }
    try {
      return await fn();
    } finally {
      try {
        unlinkSync(path);
      } catch {
        // already gone
      }
    }
  }
}
