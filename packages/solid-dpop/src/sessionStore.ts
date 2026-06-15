/**
 * Persist a user-delegated {@link AuthCodeSession} to disk so a CLI can log in ONCE and have
 * later invocations (pull/push/watch, a gateway restart, a re-run of an importer) reuse the
 * session via the refresh grant — no second browser round-trip.
 *
 * ───────────────────────────── WHY THE PRIVATE KEY IS PERSISTED ─────────────────────────────
 * CSS (node-oidc-provider) binds the refresh token to the original DPoP `jkt`: a refresh request
 * signed by a DIFFERENT keypair is rejected with `invalid_grant` (verified live against CSS v8 —
 * a fresh keypair fails, the original succeeds). So we CANNOT regenerate the keypair per process;
 * the DPoP private key MUST be stored alongside the refresh token. It is exported as a private
 * JWK (see {@link exportDpopKeyPairJwk}) and the file is written `0600` (owner-only) to limit the
 * blast radius — the same posture as an SSH private key or a `~/.npmrc` token.
 *
 * The stored file is NOT a bearer credential on its own: the access token is short-lived and the
 * refresh token is DPoP-bound, so possession of the file additionally requires the co-stored
 * private key to be usable. Still: it grants the holder the user's pod access until the refresh
 * token is revoked. Treat it like any other long-lived secret; `0600` is the floor, not a
 * substitute for OS-level disk protection.
 */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { JWK } from "jose";
import type { AuthCodeSession, ClientRegistration, OidcProviderMetadata } from "./authCode.js";
import { exportDpopKeyPairJwk, importDpopKeyPairJwk } from "./dpop.js";

/** Bump when the on-disk shape changes incompatibly. */
const STORE_VERSION = 1 as const;

/** The JSON-serialisable form of an {@link AuthCodeSession}. */
export interface StoredSession {
  readonly version: typeof STORE_VERSION;
  /** DPoP keypair as a private JWK — reused on refresh to keep the `jkt` binding (see file header). */
  readonly keyPairJwk: JWK;
  readonly accessToken: string;
  /** epoch ms after which the access token is considered expired. */
  readonly expiresAt: number;
  readonly refreshToken?: string;
  readonly nonce?: string;
  readonly client: ClientRegistration;
  readonly providerMetadata: OidcProviderMetadata;
}

/** Serialise a live session to its on-disk JSON shape (keypair exported as a private JWK). */
export async function serializeSession(session: AuthCodeSession): Promise<StoredSession> {
  const keyPairJwk = await exportDpopKeyPairJwk(session.keyPair);
  return {
    version: STORE_VERSION,
    keyPairJwk,
    accessToken: session.accessToken,
    expiresAt: session.expiresAt,
    client: session.client,
    providerMetadata: session.providerMetadata,
    ...(session.refreshToken ? { refreshToken: session.refreshToken } : {}),
    ...(session.nonce ? { nonce: session.nonce } : {}),
  };
}

/** Reconstruct a live {@link AuthCodeSession} (keypair rebuilt from the stored private JWK). */
export async function deserializeSession(stored: StoredSession): Promise<AuthCodeSession> {
  if (stored.version !== STORE_VERSION) {
    throw new Error(
      `Unsupported session store version ${stored.version} (expected ${STORE_VERSION}).`,
    );
  }
  const keyPair = await importDpopKeyPairJwk(stored.keyPairJwk);
  return {
    keyPair,
    accessToken: stored.accessToken,
    expiresAt: stored.expiresAt,
    client: stored.client,
    providerMetadata: stored.providerMetadata,
    ...(stored.refreshToken ? { refreshToken: stored.refreshToken } : {}),
    ...(stored.nonce ? { nonce: stored.nonce } : {}),
  };
}

/**
 * Persist a session to `path` as `0600` JSON. Creates the parent directory if needed. The chmod is
 * applied AFTER the write (and the write opens with mode `0600`) so the secret is never briefly
 * world-readable.
 */
export async function saveSession(path: string, session: AuthCodeSession): Promise<void> {
  const stored = await serializeSession(session);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
  // Ensure 0600 even if the file pre-existed with looser perms (writeFile mode only applies on create).
  await chmod(path, 0o600);
}

/** Load a persisted session from `path`, or `undefined` if the file does not exist. Throws on corruption. */
export async function loadSession(path: string): Promise<AuthCodeSession | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  const stored = JSON.parse(raw) as StoredSession;
  return deserializeSession(stored);
}
