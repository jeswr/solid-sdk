// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Google and Microsoft specifics for the credential helper: FIXED official endpoints, the scopes
 * requested and why, OIDC ID-token verification, token exchange/refresh and the explicit
 * calendar-inventory call. Every network call goes through `call`, which refuses any origin not
 * on the allow-list, never follows redirects, bounds time and size, and never puts a response
 * body (which may hold tokens) into an error message.
 *
 * Sources: Google "OAuth 2.0 for iOS & Desktop Apps" (loopback, PKCE), Google OpenID Connect,
 * Calendar API calendarList.list; Microsoft identity platform auth-code flow with PKCE, ID token
 * claims, Graph "List calendars".
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { createLocalJWKSet, decodeJwt, type JWTPayload, jwtVerify } from "jose";
import { z } from "zod";
import { type Grant, HelperError, type Profile } from "./store.js";

// ------------------------------------------------------------------ transport

export type Transport = (url: string, init: RequestInit) => Promise<Response>;

/** Refuse network unless the host explicitly supplies a transport. */
export const noTransport: Transport = async () => {
  throw new HelperError("unavailable", "no provider transport configured");
};

export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://oauth2.googleapis.com",
  "https://www.googleapis.com",
  "https://login.microsoftonline.com",
  "https://graph.microsoft.com",
]);
const CALL_TIMEOUT_MS = 15_000;
const MAX_BODY = 256 * 1024;

/** One bounded call to an allow-listed origin; JSON answer (or a typed error, never the body). */
export async function call(
  transport: Transport,
  url: string,
  init: RequestInit,
  what: string,
): Promise<{ status: number; body: unknown }> {
  let origin: string;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.hash) throw new Error("invalid provider URL");
    origin = parsed.origin;
  } catch {
    throw new HelperError("invalid", `${what}: not a URL`);
  }
  if (!ALLOWED_ORIGINS.has(origin))
    throw new HelperError("refused", `${what}: ${origin} is not an allowed provider origin`);
  let res: Response;
  try {
    res = await transport(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch {
    throw new HelperError("unavailable", `${what}: the provider could not be reached`);
  }
  let text: string;
  try {
    if (!res.body) throw new Error("missing response body");
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) {
          await reader.cancel();
          throw new HelperError("unavailable", `${what}: answer too large`);
        }
        chunks.push(value);
      }
      text = new TextDecoder().decode(Buffer.concat(chunks));
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof HelperError) throw error;
    throw new HelperError("unavailable", `${what}: the answer could not be read`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HelperError("unavailable", `${what}: unreadable answer (HTTP ${res.status})`);
  }
  return { status: res.status, body };
}

const form = (v: Record<string, string | undefined>) =>
  new URLSearchParams(
    Object.entries(v).filter((e): e is [string, string] => e[1] !== undefined),
  ).toString();

// ------------------------------------------------------------------ PKCE, state, nonce

export const b64url = (b: Buffer) => b.toString("base64url");
export function pkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32)); // 43 chars (RFC 7636 §4.1)
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}
export const randomToken = () => b64url(randomBytes(32));
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ------------------------------------------------------------------ provider descriptions

export const GOOGLE = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
  calendarList: "https://www.googleapis.com/calendar/v3/users/me/calendarList",
  /** Availability only: free/busy of calendars (no event details). */
  MAIL_READ: "https://www.googleapis.com/auth/gmail.readonly",
  MAIL_SEND: "https://www.googleapis.com/auth/gmail.send",
  CALENDAR_READ: "https://www.googleapis.com/auth/calendar.readonly",
  FREEBUSY: "https://www.googleapis.com/auth/calendar.freebusy",
  /** Optional, explicit inventory only: the list of the account's calendars. */
  CALENDARLIST: "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
} as const;

export const MICROSOFT = {
  authority: "https://login.microsoftonline.com",
  graph: "https://graph.microsoft.com",
  /** Tenant id of personal Microsoft accounts (fixed by Microsoft). */
  CONSUMERS_TID: "9188040d-6c67-4c5b-b112-36a304b66dad",
  CALENDARS: "https://graph.microsoft.com/Calendars.ReadBasic",
} as const;

/**
 * Scopes requested at login, and why:
 *  - Google: `openid email` (minimal OIDC identity: `sub` + verified `email`, to check that the
 *    consenting account is the chosen one), `calendar.freebusy` (availability), and ONLY with
 *    `--calendar-inventory` `calendar.calendarlist.readonly` (the explicit inventory command).
 *  - Microsoft: `openid profile` (minimal identity: `oid`, `tid`, `preferred_username`),
 *    `offline_access` (a refresh token; without it every use needs a new sign-in),
 *    `Calendars.ReadBasic` (calendarView busy times and the calendar list; no bodies/attendees).
 */
export function requestedScopes(p: Profile): string[] {
  return p.provider === "google"
    ? ["openid", "email", ...requiredScopes(p)]
    : [
        "openid",
        "profile",
        "offline_access",
        ...requiredScopes(p).map((s) => `${MICROSOFT.graph}/${s}`),
      ];
}
/** Minimum scopes for exactly one purpose and resource. */
export function requiredScopes(p: Profile): string[] {
  if (p.provider === "google") {
    if (p.resource === "teams")
      throw new HelperError("invalid", "Google does not supply Teams grants");
    if (p.resource === "mail") return [p.purpose === "read" ? GOOGLE.MAIL_READ : GOOGLE.MAIL_SEND];
    if (p.purpose !== "read")
      throw new HelperError("refused", "calendar send grants are not supported");
    return [GOOGLE.CALENDAR_READ, ...(p.inventory ? [GOOGLE.CALENDARLIST] : [])];
  }
  if (p.resource === "calendar") {
    if (p.purpose !== "read")
      throw new HelperError("refused", "calendar send grants are not supported");
    return ["Calendars.ReadBasic"];
  }
  if (p.resource === "teams")
    return p.purpose === "read" ? ["Chat.Read", "ChannelMessage.Read.All"] : ["ChatMessage.Send"];
  return [p.purpose === "read" ? "Mail.Read" : "Mail.Send"];
}
/** Scopes as the actions name them (Graph scopes without the resource prefix). */
export function normaliseScopes(provider: Profile["provider"], scope: string): string[] {
  return [
    ...new Set(
      scope
        .split(/\s+/)
        .filter(Boolean)
        .map((s) =>
          provider === "microsoft" && s.startsWith(`${MICROSOFT.graph}/`)
            ? s.slice(MICROSOFT.graph.length + 1)
            : s,
        ),
    ),
  ].sort();
}

/** Whether a token tenant id fits the configured tenant: consumers, organizations or one id. */
export function tenantMatches(want: string, tid: string): boolean {
  if (want === "consumers") return tid === MICROSOFT.CONSUMERS_TID;
  if (want === "organizations")
    return /^[0-9a-f-]{36}$/.test(tid) && tid !== MICROSOFT.CONSUMERS_TID;
  return tid === want;
}

function tenantOf(p: Profile): string {
  if (p.provider !== "microsoft" || !p.microsoft)
    throw new HelperError("setup", "the Microsoft profile has no account type/tenant");
  return p.microsoft.tenant;
}

export interface ClientInfo {
  clientId: string;
  clientSecret?: string | undefined;
}

export function authorizationUrl(
  p: Profile,
  client: ClientInfo,
  a: { redirectUri: string; state: string; nonce: string; challenge: string },
): string {
  const common = {
    client_id: client.clientId,
    redirect_uri: a.redirectUri,
    response_type: "code",
    scope: requestedScopes(p).join(" "),
    state: a.state,
    nonce: a.nonce,
    code_challenge: a.challenge,
    code_challenge_method: "S256",
    // A HINT only: the consenting account is verified from the signed ID token afterwards.
    login_hint: p.account,
  };
  if (p.provider === "google")
    return `${GOOGLE.authorize}?${form({
      ...common,
      // A refresh token needs offline access; consent is shown so that one is issued again on
      // re-login. Earlier grants of this client are NOT merged in (no include_granted_scopes).
      access_type: "offline",
      prompt: "consent",
    })}`;
  return `${MICROSOFT.authority}/${tenantOf(p)}/oauth2/v2.0/authorize?${form({
    ...common,
    response_mode: "query",
    prompt: "select_account",
  })}`;
}

const tokenAnswer = z.object({
  access_token: z.string().regex(/^[\x21-\x7e]{8,8192}$/),
  expires_in: z.coerce.number().int().positive().max(86_400),
  refresh_token: z
    .string()
    .regex(/^[\x21-\x7e]{8,8192}$/)
    .optional(),
  scope: z.string().max(4000).optional(),
  token_type: z.string().regex(/^bearer$/i),
  id_token: z.string().max(16_384).optional(),
});
export type TokenAnswer = z.infer<typeof tokenAnswer>;
const errorAnswer = z.object({ error: z.string().max(100) });

function tokenEndpoint(p: Profile): string {
  return p.provider === "google"
    ? GOOGLE.token
    : `${MICROSOFT.authority}/${tenantOf(p)}/oauth2/v2.0/token`;
}

async function tokenCall(
  transport: Transport,
  p: Profile,
  params: Record<string, string | undefined>,
  what: string,
): Promise<TokenAnswer> {
  const { status, body } = await call(
    transport,
    tokenEndpoint(p),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form(params),
    },
    what,
  );
  if (status !== 200) {
    const e = errorAnswer.safeParse(body);
    const code = e.success ? e.data.error.replace(/[^a-z_]/gi, "").slice(0, 40) : `HTTP ${status}`;
    if (code === "invalid_grant")
      throw new HelperError("revoked", `${what}: the grant is no longer valid (invalid_grant)`);
    if (status >= 500 || status === 429)
      throw new HelperError("unavailable", `${what}: provider unavailable (${code})`);
    throw new HelperError("refused", `${what}: refused by the provider (${code})`);
  }
  const t = tokenAnswer.safeParse(body);
  if (!t.success) throw new HelperError("unavailable", `${what}: unexpected token answer shape`);
  return t.data;
}

export function exchangeCode(
  transport: Transport,
  p: Profile,
  client: ClientInfo,
  a: { code: string; redirectUri: string; verifier: string },
): Promise<TokenAnswer> {
  return tokenCall(
    transport,
    p,
    {
      grant_type: "authorization_code",
      code: a.code,
      client_id: client.clientId,
      client_secret: p.provider === "google" ? client.clientSecret : undefined,
      redirect_uri: a.redirectUri,
      code_verifier: a.verifier,
      ...(p.provider === "microsoft" ? { scope: requestedScopes(p).join(" ") } : {}),
    },
    "token exchange",
  );
}

export function refresh(
  transport: Transport,
  p: Profile,
  client: ClientInfo,
  refreshToken: string,
): Promise<TokenAnswer> {
  return tokenCall(
    transport,
    p,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: p.provider === "google" ? client.clientSecret : undefined,
      ...(p.provider === "microsoft" ? { scope: requestedScopes(p).join(" ") } : {}),
    },
    "token refresh",
  );
}

// ------------------------------------------------------------------ identity (OIDC)

const ID_TOKEN_SKEW_S = 60;
/** An ID token from a code exchange that just happened is minutes old at most. */
const ID_TOKEN_MAX_AGE_S = 10 * 60;
/** Longest ID-token lifetime accepted (providers issue about one hour). */
const ID_TOKEN_MAX_LIFETIME_S = 24 * 3600;

/**
 * OIDC Core §3.1.3.7 checks beyond the signature (defence in depth over jose's own):
 * numeric exp/iat, exp after iat, a bounded lifetime, iat not in the future, a non-empty
 * `sub`; several audiences need `azp`, and any `azp` must be this client.
 */
export function idTokenClaimProblem(
  c: JWTPayload,
  clientId: string,
  now: Date,
): string | undefined {
  const t = Math.floor(now.getTime() / 1000);
  if (typeof c.exp !== "number" || !Number.isFinite(c.exp)) return "no valid exp";
  if (typeof c.iat !== "number" || !Number.isFinite(c.iat)) return "no valid iat";
  if (c.exp <= c.iat) return "exp is not after iat";
  if (c.exp - c.iat > ID_TOKEN_MAX_LIFETIME_S) return "lifetime too long";
  if (c.iat > t + ID_TOKEN_SKEW_S) return "issued in the future";
  if (c.exp <= t - ID_TOKEN_SKEW_S) return "expired";
  if (typeof c.sub !== "string" || c.sub.length === 0 || c.sub.length > 255) return "no valid sub";
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(clientId)) return "not for this client";
  if (aud.length > 1 && c.azp === undefined) return "several audiences without azp";
  if (c.azp !== undefined && c.azp !== clientId) return "authorized party is another client";
  return undefined;
}

const jwksAnswer = z.object({ keys: z.array(z.record(z.string(), z.unknown())).min(1).max(50) });

/**
 * Verify the ID token (signature against the provider's published keys, issuer, audience = our
 * client, nonce, expiry) and check that it names the chosen account; pin subject (and tenant).
 */
export async function verifyIdentity(
  transport: Transport,
  p: Profile,
  client: ClientInfo,
  idToken: string | undefined,
  nonce: string,
  existing: Grant | undefined,
  now: Date,
): Promise<Grant["account"]> {
  if (!idToken) throw new HelperError("account", "no ID token: the account cannot be verified");
  let unverified: JWTPayload;
  try {
    unverified = decodeJwt(idToken);
  } catch {
    throw new HelperError("account", "the ID token is malformed");
  }
  let issuer: string[];
  let jwksUrl: string;
  if (p.provider === "google") {
    issuer = [...GOOGLE.issuers];
    jwksUrl = GOOGLE.jwks;
  } else {
    const tid = String(unverified.tid ?? "");
    if (!/^[0-9a-f-]{36}$/.test(tid))
      throw new HelperError("account", "the ID token has no tenant");
    issuer = [`${MICROSOFT.authority}/${tid}/v2.0`];
    jwksUrl = `${MICROSOFT.authority}/${tenantOf(p)}/discovery/v2.0/keys`;
  }
  const { status, body } = await call(transport, jwksUrl, { method: "GET" }, "signing keys");
  const keys = jwksAnswer.safeParse(body);
  if (status !== 200 || !keys.success)
    throw new HelperError("unavailable", "the provider's signing keys could not be read");
  // Microsoft keys are scoped to their issuer (possibly a tenant-independent template).
  // Filter before jose selects a key: jose itself ignores this Microsoft-specific metadata.
  const eligibleKeys =
    p.provider === "microsoft"
      ? keys.data.keys.filter(
          (key) =>
            typeof key.issuer === "string" &&
            key.issuer.replaceAll("{tenantid}", String(unverified.tid)) === issuer[0],
        )
      : keys.data.keys;
  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(
      idToken,
      createLocalJWKSet({ keys: eligibleKeys } as Parameters<typeof createLocalJWKSet>[0]),
      {
        issuer,
        audience: client.clientId,
        algorithms: ["RS256"],
        clockTolerance: ID_TOKEN_SKEW_S,
        currentDate: now,
        // jose checks exp/iat only when present: the OIDC-mandatory claims are REQUIRED here, and
        // the token must be fresh (it was just issued by the code exchange).
        requiredClaims: ["iss", "sub", "aud", "exp", "iat", "nonce"],
        maxTokenAge: ID_TOKEN_MAX_AGE_S,
      },
    ));
  } catch {
    throw new HelperError(
      "account",
      "the ID token did not verify (signature, issuer, audience or time)",
    );
  }
  const problem = idTokenClaimProblem(claims, client.clientId, now);
  if (problem) throw new HelperError("account", `the ID token is not acceptable (${problem})`);
  if (typeof claims.nonce !== "string" || !sameSecret(claims.nonce, nonce))
    throw new HelperError("account", "the ID token does not belong to this login (nonce)");
  const expected = p.account.toLowerCase();
  const expectedMicrosoftIdentity = p.microsoft?.expectedIdentity;
  let account: Grant["account"];
  if (p.provider === "google") {
    const email = String(claims.email ?? "").toLowerCase();
    if (claims.email_verified !== true || !email)
      throw new HelperError("account", "Google did not assert a verified email for this account");
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (
      !email.endsWith("@gmail.com") &&
      !email.endsWith("@googlemail.com") &&
      (typeof claims.hd !== "string" || claims.hd !== domain)
    )
      throw new HelperError("account", "Google is not authoritative for this email domain");
    if (email !== expected || typeof claims.sub !== "string")
      throw new HelperError(
        "account",
        "the account that consented is not the account chosen for this profile",
      );
    account = { subject: claims.sub, username: email };
  } else {
    const tid = claims.tid as string; // Already required and validated before signature verification.
    const oid = String(claims.oid ?? "");
    const username = String(claims.preferred_username ?? "").toLowerCase();
    if (!tenantMatches(tenantOf(p), tid))
      throw new HelperError(
        "account",
        "the account that consented is not of the chosen account type/tenant",
      );
    if (!oid || username !== expected)
      throw new HelperError(
        "account",
        "the account that consented is not the account chosen for this profile",
      );
    if (!expectedMicrosoftIdentity)
      throw new HelperError("account", "a trusted Microsoft tenant/object identity is required");
    if (tid !== expectedMicrosoftIdentity.tenantId || oid !== expectedMicrosoftIdentity.objectId)
      throw new HelperError("account", "the account does not match the trusted Microsoft identity");
    account = { subject: oid, tenant: tid, username };
  }
  if (
    existing &&
    (existing.account.subject !== account.subject || existing.account.tenant !== account.tenant)
  )
    throw new HelperError(
      "account",
      "the account that consented is a different account from the one this profile's grant is pinned to",
    );
  return account;
}

// ------------------------------------------------------------------ inventory and revocation

export interface CalendarEntry {
  id: string;
  name: string;
  accessRole: string;
  primary: boolean;
}

const googleList = z.object({
  items: z
    .array(
      z.object({
        id: z.string().max(300),
        summary: z.string().max(300).optional(),
        accessRole: z.string().max(40).optional(),
        primary: z.boolean().optional(),
      }),
    )
    .max(250)
    .default([]),
  nextPageToken: z.string().max(2000).optional(),
});
const graphList = z.object({
  value: z
    .array(
      z.object({
        id: z.string().max(500),
        name: z.string().max(300).optional(),
        canEdit: z.boolean().optional(),
        isDefaultCalendar: z.boolean().optional(),
      }),
    )
    .max(1000),
  "@odata.nextLink": z.string().max(4000).optional(),
});
const MAX_PAGES = 10;

/** The account's calendars (explicit inventory command only). */
export async function listCalendars(
  transport: Transport,
  p: Profile,
  accessToken: string,
): Promise<CalendarEntry[]> {
  const headers = { authorization: `Bearer ${accessToken}`, accept: "application/json" };
  const out: CalendarEntry[] = [];
  if (p.provider === "google") {
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({ maxResults: "250" });
      if (pageToken) q.set("pageToken", pageToken);
      const { status, body } = await call(
        transport,
        `${GOOGLE.calendarList}?${q}`,
        { method: "GET", headers },
        "calendar list",
      );
      if (status === 401) throw new HelperError("revoked", "calendar list: access was refused");
      if (status === 403)
        throw new HelperError("scope", "calendar list: the grant lacks the calendar-list scope");
      const r = googleList.safeParse(body);
      if (status !== 200 || !r.success)
        throw new HelperError("unavailable", `calendar list: unexpected answer (HTTP ${status})`);
      for (const c of r.data.items)
        out.push({
          id: c.id,
          name: c.summary ?? "",
          accessRole: c.accessRole ?? "unknown",
          primary: c.primary === true,
        });
      pageToken = r.data.nextPageToken;
      if (!pageToken) return out;
    }
    throw new HelperError("unavailable", "calendar list: too many pages");
  }
  let url: string | undefined =
    `${MICROSOFT.graph}/v1.0/me/calendars?$select=id,name,canEdit,isDefaultCalendar&$top=100`;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const { status, body }: { status: number; body: unknown } = await call(
      transport,
      url,
      { method: "GET", headers },
      "calendar list",
    );
    if (status === 401) throw new HelperError("revoked", "calendar list: access was refused");
    const r = graphList.safeParse(body);
    if (status !== 200 || !r.success)
      throw new HelperError("unavailable", `calendar list: unexpected answer (HTTP ${status})`);
    for (const c of r.data.value)
      out.push({
        id: c.id,
        name: c.name ?? "",
        accessRole: c.canEdit ? "canEdit" : "read",
        primary: c.isDefaultCalendar === true,
      });
    const next: string | undefined = r.data["@odata.nextLink"];
    if (next !== undefined) {
      const u = new URL(next);
      if (u.origin !== MICROSOFT.graph || u.pathname !== "/v1.0/me/calendars")
        throw new HelperError("unavailable", "calendar list: unexpected paging link (refused)");
    }
    url = next;
  }
  if (url) throw new HelperError("unavailable", "calendar list: too many pages");
  return out;
}

/** Google only: revoke the grant at the provider (explicit operator action). */
export async function revokeGoogle(transport: Transport, token: string): Promise<void> {
  const { status } = await call(
    transport,
    GOOGLE.revoke,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ token }),
    },
    "revocation",
  ).catch((error: unknown) => {
    // Google answers revocation with an empty/non-JSON body on success in some cases.
    if (error instanceof HelperError && /unreadable answer \(HTTP 200\)/.test(error.message))
      return { status: 200 };
    throw error;
  });
  if (status !== 200) throw new HelperError("unavailable", `revocation failed (HTTP ${status})`);
}
