/**
 * Credential helper — tests against a LOCAL fake OAuth provider (injected transport; signed ID
 * tokens from a key generated here). No real consent, token exchange or provider call happens:
 * the only sockets are the helper's own loopback listener and this test's requests to it.
 * Accounts and addresses are synthetic.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadProviderConfig } from "../actions/providers/credentials.js";
import { main } from "./cli.js";
import { accessToken, helperExchange, login } from "./operations.js";
import { GOOGLE, MICROSOFT, type Transport, verifyIdentity } from "./providers.js";
import { CredentialStore, type Grant, HelperError, writeFully } from "./store.js";

const NOW0 = Date.parse("2026-10-19T08:00:00Z");
const GOOGLE_CLIENT = "000000000000-synthetic.apps.googleusercontent.com";
const GOOGLE_SECRET = "GOCSPX-synthetic-placeholder";
const MS_CLIENT = "00000000-1111-4222-8333-444444444444";
const MS_WORK_TID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ACCOUNT = "owner.fixture@example.org";

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let signingKey: PrivateKey;
let publicJwk: JWK;
let otherKey: PrivateKey;
beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  signingKey = kp.privateKey;
  publicJwk = { ...(await exportJWK(kp.publicKey)), kid: "fixture-1", alg: "RS256", use: "sig" };
  otherKey = (await generateKeyPair("RS256")).privateKey;
});

interface Identity {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  oid?: string;
  tid?: string;
  preferred_username?: string;
}

/** A local stand-in for the providers' token, key, and calendar-list endpoints. */
class FakeProvider {
  identity: Identity = { sub: "google-sub-1", email: ACCOUNT, email_verified: true };
  grantScope = `openid ${GOOGLE.FREEBUSY} https://www.googleapis.com/auth/userinfo.email`;
  issueRefresh = true;
  signWith: "right" | "other" = "right";
  audience: string | undefined;
  nonceOverride: string | undefined;
  down = false;
  malformedRefresh = false;
  refreshDelayMs = 0;
  rotate = false;
  refreshCalls = 0;
  requests: { url: string; body: string }[] = [];
  private codes = new Map<string, { challenge: string; redirectUri: string; nonce: string }>();
  refreshTokens = new Map<string, boolean>();
  private n = 0;
  constructor(readonly clientId: string) {}

  /** The browser + consent step: returns the code the provider would redirect with. */
  authorize(authUrl: string): { code: string; state: string; redirectUri: string } {
    const u = new URL(authUrl);
    const code = `code-${++this.n}-${randomBytes(4).toString("hex")}`;
    this.codes.set(code, {
      challenge: u.searchParams.get("code_challenge") ?? "",
      redirectUri: u.searchParams.get("redirect_uri") ?? "",
      nonce: u.searchParams.get("nonce") ?? "",
    });
    return {
      code,
      state: u.searchParams.get("state") ?? "",
      redirectUri: u.searchParams.get("redirect_uri") ?? "",
    };
  }

  private async idToken(nonce: string, iss: string): Promise<string> {
    return new SignJWT({ ...this.identity, nonce: this.nonceOverride ?? nonce })
      .setProtectedHeader({ alg: "RS256", kid: "fixture-1" })
      .setIssuer(iss)
      .setAudience(this.audience ?? this.clientId)
      .setIssuedAt(Math.floor(NOW0 / 1000))
      .setExpirationTime(Math.floor(NOW0 / 1000) + 3600)
      .sign(this.signWith === "right" ? signingKey : otherKey);
  }

  transport: Transport = async (url, init) => {
    const body = typeof init.body === "string" ? init.body : "";
    this.requests.push({ url, body });
    const json = (status: number, v: unknown) =>
      new Response(JSON.stringify(v), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (this.down) return json(503, { error: "temporarily_unavailable" });
    const u = new URL(url);
    if (url === GOOGLE.jwks || u.pathname.endsWith("/discovery/v2.0/keys"))
      return json(200, { keys: [publicJwk] });
    if (url === GOOGLE.token || u.pathname.endsWith("/oauth2/v2.0/token")) {
      const f = new URLSearchParams(body);
      if (f.get("client_id") !== this.clientId) return json(400, { error: "invalid_client" });
      const iss =
        url === GOOGLE.token
          ? "https://accounts.google.com"
          : `${MICROSOFT.authority}/${this.identity.tid}/v2.0`;
      if (f.get("grant_type") === "authorization_code") {
        const c = this.codes.get(f.get("code") ?? "");
        this.codes.delete(f.get("code") ?? "");
        const verifier = f.get("code_verifier") ?? "";
        const hashed = createHash("sha256").update(verifier).digest("base64url");
        if (!c || c.redirectUri !== f.get("redirect_uri") || hashed !== c.challenge)
          return json(400, { error: "invalid_grant" });
        const rt = this.issueRefresh
          ? `rt-${++this.n}-${randomBytes(8).toString("hex")}`
          : undefined;
        if (rt) this.refreshTokens.set(rt, true);
        return json(200, {
          access_token: `at-${++this.n}-${randomBytes(8).toString("hex")}`,
          expires_in: 3600,
          ...(rt ? { refresh_token: rt } : {}),
          scope: this.grantScope,
          token_type: "Bearer",
          id_token: await this.idToken(c.nonce, iss),
        });
      }
      if (f.get("grant_type") === "refresh_token") {
        const rt = f.get("refresh_token") ?? "";
        if (!this.refreshTokens.get(rt)) return json(400, { error: "invalid_grant" });
        this.refreshCalls++;
        if (this.refreshDelayMs) await new Promise((r) => setTimeout(r, this.refreshDelayMs));
        if (this.malformedRefresh) return json(200, { access_token: 7 });
        let next: string | undefined;
        if (this.rotate) {
          this.refreshTokens.set(rt, false);
          next = `rt-${++this.n}-${randomBytes(8).toString("hex")}`;
          this.refreshTokens.set(next, true);
        }
        return json(200, {
          access_token: `at-${++this.n}-${randomBytes(8).toString("hex")}`,
          expires_in: 3600,
          scope: this.grantScope,
          token_type: "Bearer",
          ...(next ? { refresh_token: next } : {}),
        });
      }
    }
    if (u.origin + u.pathname === GOOGLE.calendarList)
      return json(200, {
        items: [
          {
            id: "primary-id@example.org",
            summary: "Fixture primary",
            accessRole: "owner",
            primary: true,
          },
          {
            id: "family@group.calendar.google.com",
            summary: "Fixture family",
            accessRole: "reader",
          },
        ],
      });
    if (u.pathname === "/v1.0/me/calendars")
      return json(200, {
        value: [{ id: "AAMkFixture", name: "Calendar", canEdit: true, isDefaultCalendar: true }],
      });
    return json(404, { error: "not_found" });
  };
}

let dir: string;
let clock: number;
const now = () => new Date(clock);
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "awp-cred-test-")), "store");
  clock = NOW0;
});
afterEach(() => rmSync(join(dir, ".."), { recursive: true, force: true }));

function io(fake?: FakeProvider, extra: Partial<Parameters<typeof main>[1]> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    all: () => out.join("") + err.join(""),
    io: {
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      now,
      env: {},
      ...(fake ? { transport: fake.transport } : {}),
      ...extra,
    },
  };
}
const run = async (fake: FakeProvider | undefined, ...args: string[]) => {
  const x = io(fake);
  const code = await main(["--dir", dir, ...args], x.io);
  return { code, ...x };
};

function writeClientFile(content: unknown): string {
  const p = join(dir, "..", "client.json");
  writeFileSync(p, JSON.stringify(content));
  return p;
}
const googleClientJson = {
  installed: {
    client_id: GOOGLE_CLIENT,
    project_id: "fixture",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    client_secret: GOOGLE_SECRET,
    redirect_uris: ["http://localhost"],
  },
};

async function setupGoogle(inventory = false): Promise<FakeProvider> {
  const fake = new FakeProvider(GOOGLE_CLIENT);
  expect(
    (await run(fake, "client", "google", "--client-file", writeClientFile(googleClientJson))).code,
  ).toBe(0);
  const add = await run(
    fake,
    "profile",
    "add",
    "--name",
    "personal",
    "--provider",
    "google",
    "--connection",
    "acct-google",
    "--account",
    ACCOUNT,
    ...(inventory ? ["--calendar-inventory"] : []),
  );
  expect(add.code).toBe(0);
  return fake;
}

/** Run `login` and play the browser: consent at the fake provider, then hit the callback. */
async function browserLogin(
  fake: FakeProvider,
  name = "personal",
  browser: (url: string) => Promise<void> = async (url) => {
    const a = fake.authorize(url);
    await fetch(`${a.redirectUri}/?code=${a.code}&state=${a.state}`);
  },
  timeoutMs = 10_000,
) {
  let seen = "";
  const store = new CredentialStore(dir);
  const result = login({ store, transport: fake.transport, now }, name, {
    timeoutMs,
    onUrl: (url) => {
      seen = url;
      void browser(url).catch(() => undefined);
    },
  });
  return { result, url: () => seen };
}

const secretsIn = (fake: FakeProvider, grant?: Grant) => [
  GOOGLE_SECRET,
  ...[...fake.refreshTokens.keys()],
  ...(grant?.access ? [grant.access.token] : []),
  ...(grant?.refreshToken ? [grant.refreshToken] : []),
];
const grantFile = () => join(dir, "grants", "personal.json");
const readGrant = () => JSON.parse(readFileSync(grantFile(), "utf8")) as Grant;

/** A GET with an explicit Host header (fetch does not allow setting one). */
const rawGet = (url: string, host: string) =>
  new Promise<number>((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { host } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });

// ------------------------------------------------------------------ Google login

describe("Google login (installed-app loopback + PKCE + OIDC)", () => {
  it("stores a verified grant privately; the URL carries PKCE/state/nonce but no secret; nothing secret is printed", async () => {
    const fake = await setupGoogle();
    const x = io(fake, {
      openBrowser: (url: string) => {
        const a = fake.authorize(url);
        void fetch(`${a.redirectUri}/?code=${a.code}&state=${a.state}`);
      },
    });
    const code = await main(["--dir", dir, "login", "--profile", "personal", "--open"], x.io);
    expect(code, x.all()).toBe(0);
    const out = x.out.join("");
    const url = new URL(/https:\/\/accounts\.google\.com\S+/.exec(out)?.[0] ?? "");
    expect(url.origin + url.pathname).toBe(GOOGLE.authorize);
    const q = Object.fromEntries(url.searchParams);
    expect(q).toMatchObject({
      client_id: GOOGLE_CLIENT,
      response_type: "code",
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      login_hint: ACCOUNT,
      scope: `openid email ${GOOGLE.FREEBUSY}`,
    });
    expect(q.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(q.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.toString()).not.toContain(GOOGLE_SECRET);
    expect(q).not.toHaveProperty("include_granted_scopes");
    // PKCE: the token request carried the verifier matching the challenge (checked by the fake).
    const exchange = fake.requests.find((r) => r.body.includes("authorization_code"));
    expect(new URLSearchParams(exchange?.body).get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Stored privately, account pinned from the signed ID token.
    const g = readGrant();
    expect(g).toMatchObject({
      state: "active",
      account: { subject: "google-sub-1", username: ACCOUNT },
      grantedScopes: expect.arrayContaining([GOOGLE.FREEBUSY]),
    });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(grantFile()).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "clients", "google.json")).mode & 0o777).toBe(0o600);
    // No secret or token in anything the human-facing commands printed.
    const st = await run(fake, "status");
    const stJson = await run(fake, "status", "--json");
    for (const s of secretsIn(fake, g)) {
      expect(x.all()).not.toContain(s);
      expect(st.all() + stJson.all()).not.toContain(s);
    }
    expect(st.out.join("")).toMatch(/grant: active/);
    expect(st.out.join("")).toMatch(/secret present, not shown/);
    // The listener is gone: the state is single use and a replay cannot reach it.
    const redirect = q.redirect_uri as string;
    await expect(fetch(`${redirect}/?code=x&state=${q.state}`)).rejects.toThrow();
  });

  it("ignores forged/mismatched callbacks (state), then accepts the real one; wrong host or path is not served", async () => {
    const fake = await setupGoogle();
    const statuses: number[] = [];
    const { result } = await browserLogin(fake, "personal", async (url) => {
      const a = fake.authorize(url);
      const base = a.redirectUri;
      statuses.push((await fetch(`${base}/?code=${a.code}&state=forged`)).status);
      statuses.push((await fetch(`${base}/?code=${a.code}`)).status);
      statuses.push((await fetch(`${base}/other?code=${a.code}&state=${a.state}`)).status);
      statuses.push(await rawGet(`${base}/?code=${a.code}&state=${a.state}`, "evil.example"));
      statuses.push((await fetch(`${base}/?code=${a.code}&state=${a.state}`)).status);
    });
    await expect(result).resolves.toMatchObject({ account: { username: ACCOUNT } });
    expect(statuses).toEqual([400, 400, 404, 404, 200]);
  });

  it("a denied consent, a timeout or an unreachable provider store nothing and close the listener", async () => {
    const fake = await setupGoogle();
    let redirect = "";
    const denied = await browserLogin(fake, "personal", async (url) => {
      const a = fake.authorize(url);
      redirect = a.redirectUri;
      await fetch(`${a.redirectUri}/?error=access_denied&state=${a.state}`);
    });
    await expect(denied.result).rejects.toThrow(/not completed \(access_denied\)/);
    await expect(fetch(`${redirect}/`)).rejects.toThrow();
    const late = await browserLogin(fake, "personal", async () => undefined, 150);
    await expect(late.result).rejects.toThrow(/no sign-in response in time/);
    await expect(
      fetch(new URL(late.url()).searchParams.get("redirect_uri") as string),
    ).rejects.toThrow();
    fake.down = true;
    const down = await browserLogin(fake);
    await expect(down.result).rejects.toMatchObject({ code: "unavailable" });
    expect(() => lstatSync(grantFile())).toThrow();
  });

  it("wrong account, unverified email, bad signature, wrong audience or nonce: refused, and an existing grant is not overwritten", async () => {
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    const before = readFileSync(grantFile(), "utf8");
    const attempts: [string, () => void][] = [
      [
        "other address",
        () =>
          (fake.identity = {
            sub: "google-sub-2",
            email: "someone.else@example.org",
            email_verified: true,
          }),
      ],
      [
        "same address, other subject",
        () => (fake.identity = { sub: "google-sub-9", email: ACCOUNT, email_verified: true }),
      ],
      [
        "unverified email",
        () => (fake.identity = { sub: "google-sub-1", email: ACCOUNT, email_verified: false }),
      ],
      ["foreign signature", () => (fake.signWith = "other")],
      ["other audience", () => (fake.audience = "someone-else.apps.googleusercontent.com")],
      ["replayed nonce", () => (fake.nonceOverride = "not-this-login")],
    ];
    for (const [what, arrange] of attempts) {
      fake.identity = { sub: "google-sub-1", email: ACCOUNT, email_verified: true };
      fake.signWith = "right";
      fake.audience = undefined;
      fake.nonceOverride = undefined;
      arrange();
      const r = (await browserLogin(fake)).result;
      await expect(r, what).rejects.toMatchObject({ code: "account" });
      expect(readFileSync(grantFile(), "utf8"), what).toBe(before);
    }
  });

  it("no refresh token, or calendar scope not granted: nothing stored", async () => {
    const fake = await setupGoogle();
    fake.issueRefresh = false;
    await expect((await browserLogin(fake)).result).rejects.toThrow(/no refresh token/);
    fake.issueRefresh = true;
    fake.grantScope = "openid https://www.googleapis.com/auth/userinfo.email";
    await expect((await browserLogin(fake)).result).rejects.toMatchObject({ code: "scope" });
    expect(() => lstatSync(grantFile())).toThrow();
  });
});

// ------------------------------------------------------------------ token mode

describe("helper token mode (the action contract)", () => {
  const request = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      provider: "google",
      connectionId: "acct-google",
      scopes: [GOOGLE.FREEBUSY],
      ...over,
    });
  const deps = (fake: FakeProvider) => ({
    store: new CredentialStore(dir),
    transport: fake.transport,
    now,
  });

  it("answers from the cached token, refreshes after expiry, and checks the request against the profile", async () => {
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    const first = await helperExchange(deps(fake), "personal", request());
    expect(first.exit).toBe(0);
    const t1 = JSON.parse(first.stdout as string);
    expect(t1.access_token).toBe(readGrant().access?.token);
    expect(fake.refreshCalls).toBe(0);
    clock += 59 * 60_000; // within the 2-minute margin of expiry
    const second = JSON.parse(
      (await helperExchange(deps(fake), "personal", request())).stdout as string,
    );
    expect(fake.refreshCalls).toBe(1);
    expect(second.access_token).not.toBe(t1.access_token);
    expect(Date.parse(second.expires_at)).toBe(clock + 3600_000);
    expect(
      (await helperExchange(deps(fake), "personal", request({ connectionId: "other" }))).exit,
    ).toBe(2);
    expect(
      (await helperExchange(deps(fake), "personal", request({ provider: "microsoft" }))).exit,
    ).toBe(2);
    expect(
      (
        await helperExchange(
          deps(fake),
          "personal",
          request({ scopes: ["https://www.googleapis.com/auth/calendar"] }),
        )
      ).exit,
    ).toBe(3);
    expect((await helperExchange(deps(fake), "personal", "not json")).exit).toBe(2);
    expect((await helperExchange(deps(fake), "nobody", request())).exit).toBe(3);
  });

  it("concurrent callers refresh ONCE (profile lock), and all get the same fresh token", async () => {
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    clock += 3600_000;
    fake.refreshDelayMs = 80;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => helperExchange(deps(fake), "personal", request())),
    );
    expect(results.map((r) => r.exit)).toEqual(Array(8).fill(0));
    expect(new Set(results.map((r) => JSON.parse(r.stdout as string).access_token)).size).toBe(1);
    expect(fake.refreshCalls).toBe(1);
    expect(() => lstatSync(join(dir, "locks", "personal.lock"))).toThrow();
  });

  it("revoked (invalid_grant): exit 3, grant marked for re-consent with its tokens removed; outage/malformed: grant kept", async () => {
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    clock += 3600_000;
    const kept = readFileSync(grantFile(), "utf8");
    fake.down = true;
    expect((await helperExchange(deps(fake), "personal", request())).exit).toBe(1);
    expect(readFileSync(grantFile(), "utf8")).toBe(kept);
    fake.down = false;
    fake.malformedRefresh = true;
    expect((await helperExchange(deps(fake), "personal", request())).exit).toBe(1);
    expect(readFileSync(grantFile(), "utf8")).toBe(kept);
    fake.malformedRefresh = false;
    fake.refreshTokens.clear(); // revoked at the provider
    const r = await helperExchange(deps(fake), "personal", request());
    expect(r).toMatchObject({ exit: 3 });
    const g = readGrant();
    expect(g.state).toBe("needs-reconsent");
    expect(g.refreshToken).toBeUndefined();
    expect(g.access).toBeUndefined();
    expect((await helperExchange(deps(fake), "personal", request())).exit).toBe(3);
    expect((await run(fake, "status")).out.join("")).toMatch(/needs-reconsent/);
  });

  it("the token command refuses a terminal and prints the token only on its private stdout", async () => {
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    const tty = io(fake, { stdoutIsTTY: true, readStdin: async () => request() });
    expect(await main(["--dir", dir, "token", "--profile", "personal"], tty.io)).toBe(2);
    expect(tty.out).toEqual([]);
    expect(tty.err.join("")).toMatch(/not in a terminal/);
    const piped = io(fake, { stdoutIsTTY: false, readStdin: async () => request() });
    expect(await main(["--dir", dir, "token", "--profile", "personal"], piped.io)).toBe(0);
    expect(JSON.parse(piped.out.join("")).access_token).toBe(readGrant().access?.token);
    expect(piped.err).toEqual([]);
  });
});

// ------------------------------------------------------------------ Microsoft

describe("Microsoft (public client, PKCE, tenant/account constraints)", () => {
  async function setupMicrosoft(type: "personal" | "work-or-school", tenant?: string) {
    const fake = new FakeProvider(MS_CLIENT);
    fake.grantScope =
      "https://graph.microsoft.com/Calendars.ReadBasic openid profile offline_access";
    fake.identity = {
      sub: "ms-pairwise-sub-1", // Entra ID tokens always carry sub (pairwise)
      oid: "ms-oid-1",
      tid: type === "personal" ? MICROSOFT.CONSUMERS_TID : MS_WORK_TID,
      preferred_username: ACCOUNT,
    };
    fake.rotate = true;
    expect((await run(fake, "client", "microsoft", "--client-id", MS_CLIENT)).code).toBe(0);
    const add = await run(
      fake,
      "profile",
      "add",
      "--name",
      "personal",
      "--provider",
      "microsoft",
      "--connection",
      "acct-ms",
      "--account",
      ACCOUNT,
      "--account-type",
      type,
      ...(tenant ? ["--tenant", tenant] : []),
    );
    expect(add.code, add.all()).toBe(0);
    return fake;
  }

  it("personal account: consumers tenant, localhost redirect, no secret; rotated refresh tokens replace the old one", async () => {
    const fake = await setupMicrosoft("personal");
    const { result, url } = await browserLogin(fake);
    await expect(result).resolves.toMatchObject({ provider: "microsoft" });
    const u = new URL(url());
    expect(u.origin + u.pathname).toBe(`${MICROSOFT.authority}/consumers/oauth2/v2.0/authorize`);
    expect(u.searchParams.get("redirect_uri")).toMatch(/^http:\/\/localhost:\d+$/);
    expect(u.searchParams.get("scope")).toBe(
      "openid profile offline_access https://graph.microsoft.com/Calendars.ReadBasic",
    );
    const exchange = fake.requests.find((r) => r.body.includes("authorization_code"));
    expect(new URLSearchParams(exchange?.body).has("client_secret")).toBe(false);
    const g1 = readGrant();
    expect(g1).toMatchObject({
      account: { subject: "ms-oid-1", tenant: MICROSOFT.CONSUMERS_TID, username: ACCOUNT },
      grantedScopes: expect.arrayContaining(["Calendars.ReadBasic"]),
    });
    clock += 3600_000;
    const r = await helperExchange(
      { store: new CredentialStore(dir), transport: fake.transport, now },
      "personal",
      JSON.stringify({
        provider: "microsoft",
        connectionId: "acct-ms",
        scopes: ["Calendars.ReadBasic"],
      }),
    );
    expect(r.exit).toBe(0);
    const g2 = readGrant();
    expect(g2.refreshToken).not.toBe(g1.refreshToken);
    expect(fake.refreshTokens.get(g1.refreshToken as string)).toBe(false);
    expect(fake.refreshTokens.get(g2.refreshToken as string)).toBe(true);
    const cals = await run(fake, "calendars", "--profile", "personal");
    expect(cals.out.join("")).toMatch(/AAMkFixture\tCalendar/);
    expect(cals.all()).not.toContain(g2.access?.token as string);
  });

  it("an account from another tenant or account type is refused", async () => {
    const fake = await setupMicrosoft("work-or-school", MS_WORK_TID);
    fake.identity = { ...fake.identity, tid: MICROSOFT.CONSUMERS_TID };
    await expect((await browserLogin(fake)).result).rejects.toMatchObject({ code: "account" });
    fake.identity = { ...fake.identity, tid: MS_WORK_TID, preferred_username: "other@example.org" };
    await expect((await browserLogin(fake)).result).rejects.toMatchObject({ code: "account" });
    expect(() => lstatSync(grantFile())).toThrow();
  });
});

// ------------------------------------------------------------------ store, inventory, CLI safety

describe("private store and human-facing commands", () => {
  it("refuses a widened directory, a symlinked or widened grant, and reports a corrupt one without replacing it", async () => {
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    chmodSync(dir, 0o755);
    expect((await run(fake, "status")).err.join("")).toMatch(/accessible to other users/);
    chmodSync(dir, 0o700);
    chmodSync(grantFile(), 0o644);
    expect(() => new CredentialStore(dir).grant("personal")).toThrow(/chmod 600/);
    chmodSync(grantFile(), 0o600);
    const real = readFileSync(grantFile(), "utf8");
    rmSync(grantFile());
    const elsewhere = join(dir, "..", "elsewhere.json");
    writeFileSync(elsewhere, real, { mode: 0o600 });
    symlinkSync(elsewhere, grantFile());
    expect(() => new CredentialStore(dir).grant("personal")).toThrow(/symbolic link/);
    rmSync(grantFile());
    writeFileSync(grantFile(), "{corrupt", { mode: 0o600 });
    expect((await run(fake, "status")).out.join("")).toMatch(/UNREADABLE/);
    await expect((await browserLogin(fake)).result).rejects.toThrow(/cannot be read/);
    expect(readFileSync(grantFile(), "utf8")).toBe("{corrupt");
  });

  it("client import: only a Google Desktop client from an explicit regular file; profiles are never overwritten", async () => {
    const fake = new FakeProvider(GOOGLE_CLIENT);
    new CredentialStore(dir);
    expect(
      (await run(fake, "client", "google", "--client-file", writeClientFile({ web: {} }))).code,
    ).toBe(1);
    const evil = {
      installed: { ...googleClientJson.installed, token_uri: "https://evil.example/token" },
    };
    expect(
      (await run(fake, "client", "google", "--client-file", writeClientFile(evil))).err.join(""),
    ).toMatch(/unexpected token endpoint/);
    const link = join(dir, "..", "link.json");
    symlinkSync(writeClientFile(googleClientJson), link);
    expect((await run(fake, "client", "google", "--client-file", link)).code).toBe(1);
    const ok = await run(
      fake,
      "client",
      "google",
      "--client-file",
      writeClientFile(googleClientJson),
    );
    expect(ok.code).toBe(0);
    expect(ok.all()).not.toContain(GOOGLE_SECRET);
    await setupGoogle();
    const again = await run(
      fake,
      "profile",
      "add",
      "--name",
      "personal",
      "--provider",
      "google",
      "--connection",
      "x",
      "--account",
      "a@example.org",
    );
    expect(again.err.join("")).toMatch(/not overwritten/);
  });

  it("calendar inventory needs the explicit inventory scope; the listing shows ids and roles, never tokens", async () => {
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    expect((await run(fake, "calendars", "--profile", "personal")).err.join("")).toMatch(
      /calendar-list scope/,
    );
    rmSync(join(dir, "profiles", "personal.json"));
    rmSync(grantFile());
    await run(
      fake,
      "profile",
      "add",
      "--name",
      "personal",
      "--provider",
      "google",
      "--connection",
      "acct-google",
      "--account",
      ACCOUNT,
      "--calendar-inventory",
    );
    fake.grantScope = `openid ${GOOGLE.FREEBUSY} ${GOOGLE.CALENDARLIST}`;
    const { result, url } = await browserLogin(fake);
    await result;
    expect(new URL(url()).searchParams.get("scope")).toContain(GOOGLE.CALENDARLIST);
    const list = await run(fake, "calendars", "--profile", "personal");
    expect(list.out.join("")).toMatch(/\* primary-id@example\.org\tFixture primary\towner/);
    for (const s of secretsIn(fake, readGrant())) expect(list.all()).not.toContain(s);
  });

  it("logout (no --revoke) forgets the local grant without any provider call; provider-config is a valid, secret-free action config", async () => {
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    const out = join(dir, "..", "providers.json");
    const pc = await run(fake, "provider-config", "--out", out);
    expect(pc.code, pc.all()).toBe(0);
    const config = loadProviderConfig(out);
    expect(config.accounts).toEqual([
      {
        connectionId: "acct-google",
        provider: "google",
        credential: {
          type: "helper",
          command: process.execPath,
          args: [
            expect.stringMatching(/cli\.(ts|js)$/),
            "--dir",
            dir,
            "token",
            "--profile",
            "personal",
          ],
        },
      },
    ]);
    for (const s of secretsIn(fake, readGrant()))
      expect(readFileSync(out, "utf8")).not.toContain(s);
    const calls = fake.requests.length;
    const lo = await run(fake, "logout", "--profile", "personal");
    expect(lo.out.join("")).toMatch(/Local grant removed.*still exists at Google/s);
    expect(fake.requests.length).toBe(calls);
    expect(() => lstatSync(grantFile())).toThrow();
    await expect(
      accessToken({ store: new CredentialStore(dir), transport: fake.transport, now }, "personal"),
    ).rejects.toBeInstanceOf(HelperError);
  });

  it("only allow-listed provider origins are ever called", async () => {
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    for (const r of fake.requests)
      expect(["https://oauth2.googleapis.com", "https://www.googleapis.com"]).toContain(
        new URL(r.url).origin,
      );
    mkdirSync(join(dir, "..", "unused"), { recursive: true });
  });
});

// ------------------------------------------------------------------ review corrections (OAUTH-EARLY-REVIEW)

describe("review corrections: ID-token claims, stored times, grant binding, complete writes", () => {
  const googleProfile = {
    version: 1 as const,
    name: "personal",
    provider: "google" as const,
    connectionId: "acct-google",
    account: ACCOUNT,
    inventory: false,
    createdAt: new Date(NOW0).toISOString(),
  };
  const keysOnly: Transport = async () =>
    new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
  const t0 = Math.floor(NOW0 / 1000);
  const identity = { sub: "google-sub-1", email: ACCOUNT, email_verified: true };
  /** A correctly SIGNED Google ID token, with claims shaped by `shape`. */
  const signed = (shape: (j: SignJWT) => SignJWT, claims: Record<string, unknown> = identity) =>
    shape(
      new SignJWT({ nonce: "n-1", ...claims })
        .setProtectedHeader({ alg: "RS256", kid: "fixture-1" })
        .setIssuer("https://accounts.google.com"),
    ).sign(signingKey);
  const verify = async (jwt: string) =>
    verifyIdentity(
      keysOnly,
      googleProfile,
      { clientId: GOOGLE_CLIENT },
      jwt,
      "n-1",
      undefined,
      new Date(NOW0),
    );
  const Other = "other.apps.googleusercontent.com";
  const good = (j: SignJWT) =>
    j
      .setAudience(GOOGLE_CLIENT)
      .setIssuedAt(t0)
      .setExpirationTime(t0 + 3600);

  it("a correctly signed ID token missing exp/iat/sub, stale, future, over-long, or for another party is refused", async () => {
    await expect(verify(await signed(good))).resolves.toMatchObject({ subject: "google-sub-1" });
    const bad: [string, string][] = [
      ["no exp", await signed((j) => j.setAudience(GOOGLE_CLIENT).setIssuedAt(t0))],
      ["no iat", await signed((j) => j.setAudience(GOOGLE_CLIENT).setExpirationTime(t0 + 3600))],
      ["no exp, no iat", await signed((j) => j.setAudience(GOOGLE_CLIENT))],
      ["no sub", await signed(good, { email: ACCOUNT, email_verified: true })],
      [
        "issued an hour ago",
        await signed((j) =>
          j
            .setAudience(GOOGLE_CLIENT)
            .setIssuedAt(t0 - 3600)
            .setExpirationTime(t0 + 600),
        ),
      ],
      [
        "issued in the future",
        await signed((j) =>
          j
            .setAudience(GOOGLE_CLIENT)
            .setIssuedAt(t0 + 600)
            .setExpirationTime(t0 + 4200),
        ),
      ],
      [
        "exp before iat",
        await signed((j) =>
          j
            .setAudience(GOOGLE_CLIENT)
            .setIssuedAt(t0)
            .setExpirationTime(t0 - 1),
        ),
      ],
      [
        "30-day lifetime",
        await signed((j) =>
          j
            .setAudience(GOOGLE_CLIENT)
            .setIssuedAt(t0)
            .setExpirationTime(t0 + 30 * 86400),
        ),
      ],
      [
        "two audiences, no azp",
        await signed((j) =>
          j
            .setAudience([GOOGLE_CLIENT, Other])
            .setIssuedAt(t0)
            .setExpirationTime(t0 + 3600),
        ),
      ],
      ["azp is another client", await signed(good, { ...identity, azp: Other })],
    ];
    for (const [what, jwt] of bad)
      await expect(verify(jwt), what).rejects.toMatchObject({ code: "account" });
    // Several audiences are acceptable when azp names this client.
    const multi = await signed(
      (j) =>
        j
          .setAudience([GOOGLE_CLIENT, Other])
          .setIssuedAt(t0)
          .setExpirationTime(t0 + 3600),
      { ...identity, azp: GOOGLE_CLIENT },
    );
    await expect(verify(multi)).resolves.toMatchObject({ subject: "google-sub-1" });
  });

  /** Write a grant file directly (as a misplaced/edited record would be), bypassing validation. */
  const plant = (g: Record<string, unknown>) =>
    writeFileSync(grantFile(), JSON.stringify(g), { mode: 0o600 });
  const token = (fake: FakeProvider) =>
    helperExchange(
      { store: new CredentialStore(dir), transport: fake.transport, now },
      "personal",
      JSON.stringify({
        provider: "google",
        connectionId: "acct-google",
        scopes: [GOOGLE.FREEBUSY],
      }),
    );
  const expired = (g: Record<string, unknown>) => ({
    ...g,
    access: { ...(g.access as object), expiresAt: new Date(NOW0 - 1000).toISOString() },
  });

  it("an unreadable stored time is never a valid token: refused by the helper protocol and the inventory path; never written", async () => {
    const fake = await setupGoogle(true);
    fake.grantScope = `openid ${GOOGLE.FREEBUSY} ${GOOGLE.CALENDARLIST}`;
    await (await browserLogin(fake)).result;
    const good = readGrant();
    const calls = fake.requests.length;
    plant({ ...good, access: { ...good.access, expiresAt: "invalid-time" } });
    const r = await token(fake);
    expect(r).toMatchObject({ exit: 2 });
    expect(r.stdout).toBeUndefined();
    await expect(
      accessToken({ store: new CredentialStore(dir), transport: fake.transport, now }, "personal"),
    ).rejects.toMatchObject({ code: "invalid" });
    const inv = await run(fake, "calendars", "--profile", "personal");
    expect(inv.code).toBe(1);
    expect(inv.err.join("")).toMatch(/corrupt/);
    expect(inv.all()).not.toContain(good.access?.token as string);
    for (const t of ["2026-02-30T00:00:00Z", "2026", "2026-10-19T25:00:00Z"]) {
      plant({ ...good, access: { ...good.access, expiresAt: t } });
      expect((await token(fake)).exit, t).toBe(2);
    }
    expect(fake.requests.length).toBe(calls); // nothing was refreshed or listed
    // A record with an invalid time is refused at write time as well.
    expect(() =>
      new CredentialStore(dir).putGrant({ ...good, updatedAt: "invalid-time" } as Grant),
    ).toThrow(/invalid record/);
  });

  it("a grant for another account, profile, provider or client is not used (cached or refreshed)", async () => {
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    const good = readGrant() as unknown as Record<string, unknown>;
    const account = good.account as Grant["account"];
    const calls = fake.requests.length;
    const cases: [string, Record<string, unknown>, number][] = [
      [
        "another account",
        { ...good, account: { subject: "bob-sub", username: "bob@example.org" } },
        2,
      ],
      ["another profile's record", { ...good, profile: "work" }, 2],
      [
        "another provider",
        {
          ...good,
          provider: "microsoft",
          account: { ...account, tenant: MICROSOFT.CONSUMERS_TID },
        },
        2,
      ],
      [
        "a Google grant with a tenant",
        { ...good, account: { ...account, tenant: MS_WORK_TID } },
        2,
      ],
      [
        "issued to another client",
        { ...good, clientId: "999-other.apps.googleusercontent.com" },
        3,
      ],
    ];
    for (const [what, g, exit] of cases) {
      plant(g);
      const r = await token(fake);
      expect(r.exit, what).toBe(exit);
      expect(r.stdout, what).toBeUndefined();
      expect((await run(fake, "status")).out.join(""), what).toMatch(/NOT USED/);
      plant(expired(g));
      expect((await token(fake)).exit, `${what} (expired)`).toBe(exit);
    }
    expect(fake.requests.length).toBe(calls);
    expect(fake.refreshCalls).toBe(0);
    // A record swapped in WHILE a caller waits for the lock is checked again under the lock.
    plant(expired(good));
    let waiting: Promise<unknown> | undefined;
    await new CredentialStore(dir).withLock("personal", async () => {
      waiting = accessToken(
        { store: new CredentialStore(dir), transport: fake.transport, now },
        "personal",
      );
      waiting.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 60));
      plant(expired({ ...good, account: { subject: "bob-sub", username: "bob@example.org" } }));
    });
    await expect(waiting).rejects.toMatchObject({ code: "invalid" });
    expect(fake.refreshCalls).toBe(0);
  });

  it("replacing the OAuth client needs --force; its grants then stop working until the profile logs in again", async () => {
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    const other = {
      installed: {
        ...googleClientJson.installed,
        client_id: "999-other.apps.googleusercontent.com",
      },
    };
    const refused = await run(fake, "client", "google", "--client-file", writeClientFile(other));
    expect(refused.code).toBe(1);
    expect(refused.err.join("")).toMatch(/--force/);
    expect(new CredentialStore(dir).googleClient()?.clientId).toBe(GOOGLE_CLIENT);
    // Re-registering the SAME client is fine.
    const same = await run(
      fake,
      "client",
      "google",
      "--client-file",
      writeClientFile(googleClientJson),
    );
    expect(same.code).toBe(0);
    const forced = await run(
      fake,
      "client",
      "google",
      "--client-file",
      writeClientFile(other),
      "--force",
    );
    expect(forced.code).toBe(0);
    expect(forced.out.join("")).toMatch(/must log in again: personal/);
    expect((await token(fake)).exit).toBe(3);
  });

  it("writes are complete before the rename: short writes are finished, a failed write keeps the previous record", async () => {
    let out = Buffer.alloc(0);
    let calls = 0;
    writeFully(42, "héllo, wörld", (_f, b, off, len) => {
      const n = Math.min(3, len); // a short write every time
      out = Buffer.concat([out, Buffer.from(b.subarray(off, off + n))]);
      calls++;
      return n;
    });
    expect(out.toString("utf8")).toBe("héllo, wörld");
    expect(calls).toBeGreaterThan(3);
    expect(() => writeFully(42, "x", () => 0)).toThrow(/no progress/);
    const fake = await setupGoogle();
    await (await browserLogin(fake)).result;
    const before = readFileSync(grantFile(), "utf8");
    chmodSync(join(dir, "grants"), 0o500); // the temporary file cannot be created
    try {
      expect(() =>
        new CredentialStore(dir).putGrant({
          ...readGrant(),
          updatedAt: new Date(NOW0 + 1).toISOString(),
        }),
      ).toThrow();
    } finally {
      chmodSync(join(dir, "grants"), 0o700);
    }
    expect(readFileSync(grantFile(), "utf8")).toBe(before);
    expect(readdirSync(join(dir, "grants"))).toEqual(["personal.json"]);
  });

  it("help and argument errors are typed output, not crashes", async () => {
    const h = io();
    expect(await main(["help"], h.io)).toBe(0);
    expect(h.out.join("")).toMatch(/login --profile N/);
    const bad = io();
    expect(await main(["--dir", dir, "status", "--bogus"], bad.io)).toBe(1);
    expect(bad.err.join("")).toMatch(/Unknown option.*see: help/);
  });
});
