// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * Real user verification before an approval is signed: a passkey on this device's platform
 * authenticator (Face ID, Touch ID, Windows Hello, the phone's screen lock), asked with
 * userVerification "required". The first approval registers the passkey; later ones assert
 * with it. Each challenge is bound to the approval payload. The response must match the
 * challenge, origin and relying party, and the authenticator must report user verification.
 *
 * This is a gate in the browser, not a server check: the approval itself is still the record
 * the engine signs with the device key. A cancelled, unavailable or failed ceremony never
 * authorizes signing.
 */

export type UserCheck =
  | { status: "verified"; method: "passkey"; registered: boolean }
  | { status: "cancelled" }
  | { status: "failed"; reason: string };

export interface PasskeyEnv {
  credentials?: Pick<CredentialsContainer, "create" | "get">;
  platformAvailable?: () => Promise<boolean>;
  allows: (ceremony: "get" | "create") => boolean;
  rpId: string;
  origin: string;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  subtle: SubtleCrypto;
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
}

export const STORE_KEY = "errand.passkey.v1";
const UV = 0x04;
const UP = 0x01;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
function bytes(buf: ArrayBuffer | ArrayBufferView): Uint8Array {
  return buf instanceof ArrayBuffer
    ? new Uint8Array(buf)
    : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d |= (a[i] as number) ^ (b[i] as number);
  return d === 0;
}

/** The browser's environment, read defensively: any missing piece makes WebAuthn unavailable. */
export function browserEnv(): PasskeyEnv {
  const w = globalThis as typeof globalThis & {
    PublicKeyCredential?: {
      isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
    };
  };
  type Policy = {
    allowsFeature: (feature: string) => boolean;
    features?: () => readonly string[];
  };
  const doc = w.document as
    | (Document & {
        permissionsPolicy?: Policy;
        featurePolicy?: Policy;
      })
    | undefined;
  let storage: Storage | undefined;
  try {
    storage = w.localStorage;
  } catch {
    storage = undefined;
  }
  const pkc = w.PublicKeyCredential;
  return {
    credentials: pkc ? w.navigator?.credentials : undefined,
    platformAvailable: pkc?.isUserVerifyingPlatformAuthenticatorAvailable
      ? () => pkc.isUserVerifyingPlatformAuthenticatorAvailable?.() ?? Promise.resolve(false)
      : undefined,
    allows: (ceremony) => {
      const policy = doc?.permissionsPolicy ?? doc?.featurePolicy;
      const feature = `publickey-credentials-${ceremony}`;
      if (policy?.features?.().includes(feature)) return policy.allowsFeature(feature);
      // Older browsers can support WebAuthn without exposing its policy directive.
      return w.self === w.top;
    },
    rpId: w.location?.hostname ?? "",
    origin: w.location?.origin ?? "",
    storage,
    subtle: w.crypto.subtle,
    random: (b) => w.crypto.getRandomValues(b),
  };
}

/** Forget the registered credential ID, surfacing a blocked storage reset to the caller. */
export function forgetPasskey(env: PasskeyEnv = browserEnv()): void {
  if (!env.storage) throw new Error("Passkey storage is unavailable.");
  env.storage.removeItem(STORE_KEY);
}

/** The challenge: SHA-256 of the approval digest, then 16 fresh random bytes. */
async function challengeFor(env: PasskeyEnv, digest: string): Promise<Uint8Array<ArrayBuffer>> {
  const hash = new Uint8Array(
    await env.subtle.digest("SHA-256", new TextEncoder().encode(`errand-approval:${digest}`)),
  );
  const out = new Uint8Array(48);
  out.set(hash, 0);
  out.set(env.random(new Uint8Array(16)), 32);
  return out;
}

function checkClientData(
  env: PasskeyEnv,
  type: "webauthn.get" | "webauthn.create",
  challenge: Uint8Array,
  clientDataJSON: ArrayBuffer,
): string | null {
  let client: { type?: unknown; challenge?: unknown; origin?: unknown } | null;
  try {
    client = JSON.parse(new TextDecoder().decode(bytes(clientDataJSON)));
  } catch {
    return "unreadable client data";
  }
  if (client?.type !== type) return "wrong ceremony";
  if (client.challenge !== b64url(challenge)) return "challenge does not match this approval";
  if (client.origin !== env.origin) return "wrong origin";
  return null;
}

/** Check client data and authenticator data from a WebAuthn response. */
export async function checkResponse(
  env: PasskeyEnv,
  type: "webauthn.get" | "webauthn.create",
  challenge: Uint8Array,
  clientDataJSON: ArrayBuffer,
  authData: ArrayBuffer | undefined,
): Promise<string | null> {
  const bad = checkClientData(env, type, challenge, clientDataJSON);
  if (bad) return bad;
  if (!authData) return "no authenticator data";
  const ad = bytes(authData);
  if (ad.length < 37) return "short authenticator data";
  const rpHash = new Uint8Array(
    await env.subtle.digest("SHA-256", new TextEncoder().encode(env.rpId)),
  );
  if (!equal(ad.subarray(0, 32), rpHash)) return "passkey is for another site";
  const flags = ad[32] as number;
  if (!(flags & UP)) return "no user presence";
  if (!(flags & UV)) return "the device did not verify the user";
  return null;
}

function errorName(e: unknown): string {
  return e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
}

const failed = (reason: string): UserCheck => ({ status: "failed", reason });

async function assertPasskey(
  env: PasskeyEnv,
  credentials: NonNullable<PasskeyEnv["credentials"]>,
  id: Uint8Array<ArrayBuffer>,
  challenge: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
): Promise<UserCheck> {
  const cred = (await credentials.get({
    signal,
    publicKey: {
      rpId: env.rpId,
      challenge,
      allowCredentials: [{ type: "public-key", id, transports: ["internal"] }],
      userVerification: "required",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) return { status: "cancelled" };
  if (!equal(bytes(cred.rawId), id)) return failed("an unexpected passkey answered");
  const res = cred.response as AuthenticatorAssertionResponse;
  const bad = await checkResponse(
    env,
    "webauthn.get",
    challenge,
    res.clientDataJSON,
    res.authenticatorData,
  );
  signal?.throwIfAborted();
  return bad ? failed(bad) : { status: "verified", method: "passkey", registered: false };
}

/** Verify the principal for the engine's prepared signing payload. */
export async function verifyUser(
  digest: string,
  displayName: string,
  getEnv: () => PasskeyEnv = browserEnv,
  signal?: AbortSignal,
): Promise<UserCheck> {
  let env: PasskeyEnv;
  let stored: string | null;
  try {
    env = getEnv();
    if (!env.storage) return { status: "failed", reason: "passkey storage is unavailable" };
    stored = env.storage.getItem(STORE_KEY);
  } catch {
    return { status: "failed", reason: "could not read passkey settings" };
  }
  try {
    const permissionFailure = (ceremony: "create" | "get") => {
      try {
        return env.allows(ceremony) ? null : "this page is embedded without passkey permission";
      } catch {
        return "could not check passkey permission";
      }
    };
    const denied = permissionFailure(stored === null ? "create" : "get");
    if (denied) return failed(denied);
    const credentials = env.credentials;
    if (!credentials || !env.rpId || !env.origin) return failed("WebAuthn is not supported here");
    let available: boolean | undefined;
    try {
      available = await env.platformAvailable?.();
    } catch {
      return failed("could not check platform passkey availability");
    }
    if (!available) return failed("this device has no Face ID or screen lock passkey");
    const challenge = await challengeFor(env, digest);
    signal?.throwIfAborted();
    if (stored !== null)
      return await assertPasskey(env, credentials, fromB64url(stored), challenge, signal);

    const cred = (await credentials.create({
      signal,
      publicKey: {
        rp: { id: env.rpId, name: "Errand (demo)" },
        user: {
          id: env.random(new Uint8Array(16)),
          name: `${displayName} (Errand demo)`,
          displayName,
        },
        challenge,
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        attestation: "none",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return { status: "cancelled" };
    const id = new Uint8Array(cred.rawId);
    if (id.length === 0) return failed("registration returned no credential ID");
    const res = cred.response as AuthenticatorAttestationResponse;
    if (typeof res.getAuthenticatorData === "function") {
      const bad = await checkResponse(
        env,
        "webauthn.create",
        challenge,
        res.clientDataJSON,
        res.getAuthenticatorData(),
      );
      if (bad) return failed(bad);
    } else {
      const bad = checkClientData(env, "webauthn.create", challenge, res.clientDataJSON);
      if (bad) return failed(bad);
      // For browsers without registration authenticator data, verify with the new ID once.
      const denied = permissionFailure("get");
      if (denied) return failed(denied);
      const fallbackChallenge = await challengeFor(env, digest);
      signal?.throwIfAborted();
      const result = await assertPasskey(env, credentials, id, fallbackChallenge, signal);
      if (result.status !== "verified") return result;
    }
    signal?.throwIfAborted();
    try {
      env.storage.setItem(STORE_KEY, b64url(id));
    } catch {
      return failed("could not save the new passkey");
    }
    return { status: "verified", method: "passkey", registered: true };
  } catch (e) {
    const name = errorName(e);
    if (signal?.aborted || name === "NotAllowedError" || name === "AbortError") {
      return { status: "cancelled" };
    }
    if (name === "InvalidStateError") {
      return failed("a passkey already exists here; reset it and try again");
    }
    return failed("the passkey check did not complete");
  }
}
