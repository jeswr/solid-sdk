// AUTHORED-BY Claude Opus 5.5
// The passkey check that stands before every signed approval: it must verify the user for
// real where WebAuthn runs, say plainly when it is simulated, and never approve on a cancelled
// or doubtful answer.
import { describe, expect, it } from "vitest";
import {
  checkResponse,
  forgetPasskey,
  type PasskeyEnv,
  STORE_KEY,
  verifyUser,
} from "../src/ui/passkey.js";

const RP = "errand.example";
const DIGEST = "sha-256:abc123";
const subtle = globalThis.crypto.subtle;

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
async function rpHash(rp = RP): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(rp)));
}
async function authData(flags: number, rp = RP): Promise<ArrayBuffer> {
  const out = new Uint8Array(37);
  out.set(await rpHash(rp), 0);
  out[32] = flags;
  return out.buffer;
}
function clientData(type: string, challenge: BufferSource): ArrayBuffer {
  const c = new Uint8Array(ArrayBuffer.isView(challenge) ? challenge.buffer : challenge);
  return new TextEncoder().encode(
    JSON.stringify({ type, challenge: b64url(c), origin: `https://${RP}` }),
  ).buffer as ArrayBuffer;
}
function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

interface Fake {
  create?: (o: CredentialCreationOptions) => Promise<unknown>;
  get?: (o: CredentialRequestOptions) => Promise<unknown>;
}
function env(fake: Fake, over: Partial<PasskeyEnv> = {}): PasskeyEnv & { calls: string[] } {
  const calls: string[] = [];
  return {
    credentials: {
      create: async (o) => {
        calls.push("create");
        if (!fake.create) throw new Error("no create");
        return (await fake.create(o as CredentialCreationOptions)) as Credential;
      },
      get: async (o) => {
        calls.push("get");
        if (!fake.get) throw new Error("no get");
        return (await fake.get(o as CredentialRequestOptions)) as Credential;
      },
    },
    platformAvailable: async () => true,
    allowed: true,
    rpId: RP,
    storage: memoryStorage(),
    subtle,
    random: (b) => globalThis.crypto.getRandomValues(b),
    calls,
    ...over,
  };
}
const RAW = new Uint8Array([1, 2, 3, 4]);

function assertion(
  flags = 0x05,
  opts: { type?: string; rp?: string; raw?: Uint8Array; tamper?: boolean } = {},
) {
  return async (o: CredentialRequestOptions) => {
    const pk = o.publicKey as PublicKeyCredentialRequestOptions;
    expect(pk.userVerification).toBe("required");
    const challenge = opts.tamper ? new Uint8Array(48) : (pk.challenge as Uint8Array);
    return {
      rawId: (opts.raw ?? RAW).buffer,
      response: {
        clientDataJSON: clientData(opts.type ?? "webauthn.get", challenge),
        authenticatorData: await authData(flags, opts.rp),
      },
    };
  };
}

describe("verifyUser", () => {
  it("registers a platform passkey on first use, requiring user verification", async () => {
    let seen: PublicKeyCredentialCreationOptions | undefined;
    const sync = env({
      create: async (o) => {
        const pk = o.publicKey as PublicKeyCredentialCreationOptions;
        seen = pk;
        const ad = await authData(0x45);
        return {
          rawId: RAW.buffer,
          response: {
            clientDataJSON: clientData("webauthn.create", pk.challenge),
            getAuthenticatorData: () => ad,
          },
        };
      },
    });
    const r = await verifyUser(DIGEST, "Sam", sync);
    expect(r).toEqual({ status: "verified", method: "passkey", registered: true });
    expect(sync.storage?.getItem(STORE_KEY)).toBe(b64url(RAW));
    expect(seen?.authenticatorSelection).toMatchObject({
      authenticatorAttachment: "platform",
      userVerification: "required",
    });
    expect(seen?.rp.id).toBe(RP);
  });

  it("binds the challenge to the action digest", async () => {
    const challenges: Uint8Array[] = [];
    const e = env(
      {
        get: async (o) => {
          challenges.push(
            new Uint8Array(
              (o.publicKey as PublicKeyCredentialRequestOptions).challenge as Uint8Array,
            ),
          );
          return assertion()(o);
        },
      },
      { storage: memoryStorage({ [STORE_KEY]: b64url(RAW) }) },
    );
    await verifyUser(DIGEST, "Sam", e);
    await verifyUser("sha-256:other", "Sam", e);
    const want = new Uint8Array(
      await subtle.digest("SHA-256", new TextEncoder().encode(`errand-approval:${DIGEST}`)),
    );
    expect(challenges[0]?.subarray(0, 32)).toEqual(want);
    expect(challenges[1]?.subarray(0, 32)).not.toEqual(want);
  });

  it("asserts with the stored passkey and accepts only a user-verified answer", async () => {
    const stored = { storage: memoryStorage({ [STORE_KEY]: b64url(RAW) }) };
    const ok = env({ get: assertion(0x05) }, stored);
    expect(await verifyUser(DIGEST, "Sam", ok)).toEqual({
      status: "verified",
      method: "passkey",
      registered: false,
    });
    expect(ok.calls).toEqual(["get"]);
    const noUv = env(
      { get: assertion(0x01) },
      { storage: memoryStorage({ [STORE_KEY]: b64url(RAW) }) },
    );
    expect(await verifyUser(DIGEST, "Sam", noUv)).toEqual({
      status: "failed",
      reason: "the device did not verify the user",
    });
  });

  it("rejects a wrong challenge, ceremony, site or credential", async () => {
    const s = () => ({ storage: memoryStorage({ [STORE_KEY]: b64url(RAW) }) });
    expect(
      (await verifyUser(DIGEST, "Sam", env({ get: assertion(0x05, { tamper: true }) }, s())))
        .status,
    ).toBe("failed");
    expect(
      (
        await verifyUser(
          DIGEST,
          "Sam",
          env({ get: assertion(0x05, { type: "webauthn.create" }) }, s()),
        )
      ).status,
    ).toBe("failed");
    expect(
      (await verifyUser(DIGEST, "Sam", env({ get: assertion(0x05, { rp: "evil.example" }) }, s())))
        .status,
    ).toBe("failed");
    expect(
      (
        await verifyUser(
          DIGEST,
          "Sam",
          env({ get: assertion(0x05, { raw: new Uint8Array([9]) }) }, s()),
        )
      ).status,
    ).toBe("failed");
  });

  it("treats a cancelled prompt as no approval", async () => {
    const err = Object.assign(new Error("cancelled"), { name: "NotAllowedError" });
    const e = env(
      {
        get: async () => {
          throw err;
        },
      },
      { storage: memoryStorage({ [STORE_KEY]: b64url(RAW) }) },
    );
    expect(await verifyUser(DIGEST, "Sam", e)).toEqual({ status: "cancelled" });
    expect(
      await verifyUser(
        DIGEST,
        "Sam",
        env({ get: async () => null }, { storage: memoryStorage({ [STORE_KEY]: "AQ" }) }),
      ),
    ).toEqual({ status: "cancelled" });
  });

  it("falls back to a labelled simulation only where passkeys cannot run", async () => {
    expect((await verifyUser(DIGEST, "Sam", env({}, { credentials: undefined }))).status).toBe(
      "simulated",
    );
    expect(await verifyUser(DIGEST, "Sam", env({}, { allowed: false }))).toEqual({
      status: "simulated",
      reason: "this page is embedded without passkey permission",
    });
    expect(
      (await verifyUser(DIGEST, "Sam", env({}, { platformAvailable: async () => false }))).status,
    ).toBe("simulated");
    const sec = Object.assign(new Error("x"), { name: "SecurityError" });
    expect(
      (
        await verifyUser(
          DIGEST,
          "Sam",
          env({
            create: async () => {
              throw sec;
            },
          }),
        )
      ).status,
    ).toBe("simulated");
  });

  it("asserts after registering when registration gives no authenticator data", async () => {
    const e = env({
      create: async () => ({ rawId: RAW.buffer, response: { clientDataJSON: new ArrayBuffer(0) } }),
      get: assertion(0x05),
    });
    expect((await verifyUser(DIGEST, "Sam", e)).status).toBe("verified");
    expect(e.calls).toEqual(["create", "get"]);
  });

  it("forgets the passkey on request and survives blocked storage", async () => {
    const storage = memoryStorage({ [STORE_KEY]: "AQ" });
    forgetPasskey(env({}, { storage }));
    expect(storage.map.has(STORE_KEY)).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const e = env(
      {
        create: async (o) => {
          const pk = o.publicKey as PublicKeyCredentialCreationOptions;
          const ad = await authData(0x05);
          return {
            rawId: RAW.buffer,
            response: {
              clientDataJSON: clientData("webauthn.create", pk.challenge),
              getAuthenticatorData: () => ad,
            },
          };
        },
      },
      { storage: blocked },
    );
    expect((await verifyUser(DIGEST, "Sam", e)).status).toBe("verified");
  });
});

describe("checkResponse", () => {
  it("rejects unreadable client data and short authenticator data", async () => {
    const e = env({});
    const ch = new Uint8Array(48);
    expect(
      await checkResponse(
        e,
        "webauthn.get",
        ch,
        new TextEncoder().encode("{").buffer as ArrayBuffer,
        undefined,
      ),
    ).toBe("unreadable client data");
    expect(
      await checkResponse(e, "webauthn.get", ch, clientData("webauthn.get", ch), undefined),
    ).toBe("no authenticator data");
    expect(
      await checkResponse(
        e,
        "webauthn.get",
        ch,
        clientData("webauthn.get", ch),
        new ArrayBuffer(10),
      ),
    ).toBe("short authenticator data");
    expect(
      await checkResponse(
        e,
        "webauthn.get",
        ch,
        clientData("webauthn.get", ch),
        await authData(0x04),
      ),
    ).toBe("no user presence");
  });
});
