// AUTHORED-BY Claude Opus 5.5
/**
 * Real user verification before an approval is signed: a passkey on this device's platform
 * authenticator (Face ID, Touch ID, Windows Hello, the phone's screen lock), asked with
 * userVerification "required". The first approval registers the passkey; later ones assert
 * with it. The assertion's challenge is bound to the action digest, and the result is accepted
 * only when the client data names that challenge, the relying party matches this origin and
 * the authenticator reports that it verified the user (the UV flag).
 *
 * This is a gate in the browser, not a server check: the approval itself is still the record
 * the engine signs with the device key. Where WebAuthn cannot run (an embedding frame without
 * the permission, an older browser, no platform authenticator) the result is "simulated", and
 * the UI must say so plainly. A cancelled or failed check never approves anything.
 */

export type UserCheck =
  | { status: "verified"; method: "passkey"; registered: boolean }
  | { status: "simulated"; reason: string }
  | { status: "cancelled" }
  | { status: "failed"; reason: string };

export interface PasskeyEnv {
  credentials?: Pick<CredentialsContainer, "create" | "get">;
  platformAvailable?: () => Promise<boolean>;
  /** True when this document may use WebAuthn get and create (permissions policy). */
  allowed: boolean;
  rpId: string;
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
  let framed = false;
  try {
    framed = w.self !== w.top;
  } catch {
    framed = true;
  }
  const policy = (
    globalThis.document as
      | (Document & { featurePolicy?: { allowsFeature?: (f: string) => boolean } })
      | undefined
  )?.featurePolicy;
  const allowed =
    !framed ||
    Boolean(
      policy?.allowsFeature?.("publickey-credentials-get") &&
        policy.allowsFeature("publickey-credentials-create"),
    );
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
    allowed,
    rpId: w.location?.hostname ?? "",
    storage,
    subtle: w.crypto.subtle,
    random: (b) => w.crypto.getRandomValues(b),
  };
}

function storedId(env: PasskeyEnv): string | null {
  try {
    return env.storage?.getItem(STORE_KEY) ?? null;
  } catch {
    return null;
  }
}
function store(env: PasskeyEnv, id: string | null): void {
  try {
    if (id) env.storage?.setItem(STORE_KEY, id);
    else env.storage?.removeItem(STORE_KEY);
  } catch {
    /* storage blocked: the passkey is registered again next time */
  }
}

/** Forget the registered passkey on this device, so the next approval registers a new one. */
export function forgetPasskey(env: PasskeyEnv = browserEnv()): void {
  store(env, null);
}

/** The challenge: SHA-256 of the action digest, then 16 fresh random bytes. */
async function challengeFor(env: PasskeyEnv, digest: string): Promise<Uint8Array<ArrayBuffer>> {
  const hash = new Uint8Array(
    await env.subtle.digest("SHA-256", new TextEncoder().encode(`errand-approval:${digest}`)),
  );
  const out = new Uint8Array(48);
  out.set(hash, 0);
  out.set(env.random(new Uint8Array(16)), 32);
  return out;
}

/** Check client data and authenticator data from a WebAuthn response. */
export async function checkResponse(
  env: PasskeyEnv,
  type: "webauthn.get" | "webauthn.create",
  challenge: Uint8Array,
  clientDataJSON: ArrayBuffer,
  authData: ArrayBuffer | undefined,
): Promise<string | null> {
  let client: { type?: unknown; challenge?: unknown };
  try {
    client = JSON.parse(new TextDecoder().decode(bytes(clientDataJSON)));
  } catch {
    return "unreadable client data";
  }
  if (client.type !== type) return "wrong ceremony";
  if (client.challenge !== b64url(challenge)) return "challenge does not match this approval";
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

/**
 * Ask the device to check it is the principal before an approval of `digest` is signed.
 * `displayName` is the fictional principal's name, shown by the platform when registering.
 */
export async function verifyUser(
  digest: string,
  displayName: string,
  env: PasskeyEnv = browserEnv(),
): Promise<UserCheck> {
  if (!env.credentials || !env.allowed || !env.rpId)
    return {
      status: "simulated",
      reason: env.allowed
        ? "WebAuthn is not supported here"
        : "this page is embedded without passkey permission",
    };
  let available = false;
  try {
    available = env.platformAvailable ? await env.platformAvailable() : false;
  } catch {
    available = false;
  }
  if (!available)
    return { status: "simulated", reason: "this device has no Face ID or screen lock passkey" };
  const challenge = await challengeFor(env, digest);
  const id = storedId(env);
  try {
    if (!id) {
      const cred = (await env.credentials.create({
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
      const res = cred.response as AuthenticatorAttestationResponse;
      const authData =
        typeof res.getAuthenticatorData === "function" ? res.getAuthenticatorData() : undefined;
      store(env, b64url(bytes(cred.rawId)));
      if (authData) {
        const bad = await checkResponse(
          env,
          "webauthn.create",
          challenge,
          res.clientDataJSON,
          authData,
        );
        if (bad) return { status: "failed", reason: bad };
        return { status: "verified", method: "passkey", registered: true };
      }
      // Without authenticator data the UV flag cannot be read from registration: assert once.
      return verifyUser(digest, displayName, env);
    }
    const cred = (await env.credentials.get({
      publicKey: {
        rpId: env.rpId,
        challenge,
        allowCredentials: [{ type: "public-key", id: fromB64url(id), transports: ["internal"] }],
        userVerification: "required",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return { status: "cancelled" };
    if (b64url(bytes(cred.rawId)) !== id)
      return { status: "failed", reason: "an unexpected passkey answered" };
    const res = cred.response as AuthenticatorAssertionResponse;
    const bad = await checkResponse(
      env,
      "webauthn.get",
      challenge,
      res.clientDataJSON,
      res.authenticatorData,
    );
    if (bad) return { status: "failed", reason: bad };
    return { status: "verified", method: "passkey", registered: false };
  } catch (e) {
    const name = errorName(e);
    if (name === "NotAllowedError" || name === "AbortError") return { status: "cancelled" };
    if (name === "SecurityError" || name === "NotSupportedError")
      return { status: "simulated", reason: "this browser refused passkeys for this page" };
    if (name === "InvalidStateError") {
      // A passkey for this site already exists on the device but its id was forgotten.
      return { status: "failed", reason: "a passkey already exists here; reset it and try again" };
    }
    return { status: "failed", reason: "the passkey check did not complete" };
  }
}
