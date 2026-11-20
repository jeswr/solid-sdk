// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import {
  type ApprovalRequest,
  actionDigest,
  type DeviceKey,
  type PrincipalResponse,
  verifyRecord,
} from "@jeswr/agent-consent";
import { describe, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import {
  browserEnv,
  checkResponse,
  forgetPasskey,
  type PasskeyEnv,
  verifyUser as runVerification,
  STORE_KEY,
} from "../src/ui/passkey.js";
import { importCoseKey, verifyAssertionSignature } from "../src/ui/passkey-keys.js";

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
function clientData(type: string, challenge: BufferSource, origin = `https://${RP}`): ArrayBuffer {
  const c = new Uint8Array(ArrayBuffer.isView(challenge) ? challenge.buffer : challenge);
  return new TextEncoder().encode(JSON.stringify({ type, challenge: b64url(c), origin }))
    .buffer as ArrayBuffer;
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
    allows: () => true,
    rpId: RP,
    origin: `https://${RP}`,
    storage: memoryStorage(),
    subtle,
    random: (b) => globalThis.crypto.getRandomValues(b),
    calls,
    ...over,
  };
}
const RAW = new Uint8Array([1, 2, 3, 4]);
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherEc = generateKeyPairSync("ec", { namedCurve: "P-256" });
const otherRsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const shortRsa = generateKeyPairSync("rsa", { modulusLength: 1024 });

function coseKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.x && jwk.y) {
    return Buffer.concat([
      Buffer.from("a5010203262001215820", "hex"),
      Buffer.from(jwk.x, "base64url"),
      Buffer.from("225820", "hex"),
      Buffer.from(jwk.y, "base64url"),
    ]);
  }
  if (!jwk.n || !jwk.e) throw new Error("expected a test RSA key");
  const modulus = Buffer.from(jwk.n, "base64url");
  const modulusHeader =
    modulus.length < 256
      ? [0x58, modulus.length]
      : [0x59, modulus.length >> 8, modulus.length & 0xff];
  return Buffer.concat([
    Buffer.from("a401030339010020", "hex"),
    Buffer.from(modulusHeader),
    modulus,
    Buffer.from("2143", "hex"),
    Buffer.from(jwk.e, "base64url"),
  ]);
}

function storedPasskey(publicKey = ec.publicKey) {
  return memoryStorage({
    [STORE_KEY]: JSON.stringify({
      id: b64url(RAW),
      publicKey: coseKey(publicKey).toString("base64url"),
    }),
  });
}

const verifyUser = (digest: string, displayName: string, environment: PasskeyEnv) =>
  runVerification(digest, displayName, () => environment);

function registration(
  options: {
    flags?: number;
    tamper?: boolean;
    legacy?: boolean;
    coseOnly?: boolean;
    noKey?: boolean;
    publicKey?: KeyObject;
    extensionsHex?: string;
  } = {},
) {
  return async (o: CredentialCreationOptions) => {
    const challenge = options.tamper
      ? new Uint8Array(48)
      : (o.publicKey?.challenge as BufferSource);
    const key = options.publicKey ?? ec.publicKey;
    const header = Buffer.from(await authData(options.flags ?? 0x45));
    const cose = options.noKey ? Buffer.alloc(0) : coseKey(key);
    const extensions = Buffer.from(options.extensionsHex ?? "", "hex");
    const ad = Uint8Array.from(
      Buffer.concat([
        header,
        Buffer.alloc(16),
        Buffer.from([0, RAW.length]),
        RAW,
        cose,
        extensions,
      ]),
    ).buffer;
    const length =
      ad.byteLength < 256
        ? [0x58, ad.byteLength]
        : [0x59, ad.byteLength >> 8, ad.byteLength & 0xff];
    const attestationObject = Uint8Array.from(
      Buffer.concat([
        Buffer.from("a363666d74646e6f6e656761747453746d74a0686175746844617461", "hex"),
        Buffer.from(length),
        Buffer.from(ad),
      ]),
    ).buffer;
    return {
      rawId: RAW.buffer,
      response: {
        clientDataJSON: clientData("webauthn.create", challenge),
        attestationObject,
        ...(options.legacy ? {} : { getAuthenticatorData: () => ad }),
        ...(options.legacy || options.coseOnly || options.noKey
          ? {}
          : {
              getPublicKey: () =>
                Uint8Array.from(key.export({ type: "spki", format: "der" })).buffer,
              getPublicKeyAlgorithm: () => (key.asymmetricKeyType === "rsa" ? -257 : -7),
            }),
      },
    };
  };
}

function assertion(
  flags = 0x05,
  opts: {
    type?: string;
    rp?: string;
    raw?: Uint8Array;
    tamper?: boolean;
    signature?: "missing" | "invalid" | "malformed" | "wrong-key";
    privateKey?: KeyObject;
  } = {},
) {
  return async (o: CredentialRequestOptions) => {
    const pk = o.publicKey as PublicKeyCredentialRequestOptions;
    expect(pk.userVerification).toBe("required");
    const challenge = opts.tamper ? new Uint8Array(48) : (pk.challenge as Uint8Array);
    const clientDataJSON = clientData(opts.type ?? "webauthn.get", challenge);
    const authenticatorData = await authData(flags, opts.rp);
    let signature: ArrayBuffer | undefined;
    if (opts.signature !== "missing") {
      const hash = await subtle.digest("SHA-256", clientDataJSON);
      const signed = Buffer.concat([Buffer.from(authenticatorData), Buffer.from(hash)]);
      if (opts.signature === "invalid") signed[36] = 1;
      const key =
        opts.signature === "wrong-key" ? otherEc.privateKey : (opts.privateKey ?? ec.privateKey);
      const der = sign("sha256", signed, key);
      if (opts.signature === "malformed") der[0] = 0x31;
      signature = Uint8Array.from(der).buffer;
    }
    return {
      rawId: (opts.raw ?? RAW).buffer,
      response: {
        clientDataJSON,
        authenticatorData,
        signature,
      },
    };
  };
}

describe("browser WebAuthn policy", () => {
  it.each([
    { recognized: false, topLevel: true, allowed: false, expected: true, enumerates: true },
    { recognized: false, topLevel: false, allowed: false, expected: false, enumerates: true },
    { recognized: true, topLevel: true, allowed: false, expected: false, enumerates: true },
    { recognized: true, topLevel: false, allowed: true, expected: true, enumerates: true },
    { recognized: false, topLevel: false, allowed: true, expected: true, enumerates: false },
    { recognized: false, topLevel: false, allowed: false, expected: false, enumerates: false },
  ])("preflights with $recognized recognition, $topLevel top-level, $allowed permission and $enumerates enumeration", async ({
    recognized,
    topLevel,
    allowed,
    expected,
    enumerates,
  }) => {
    const self = {};
    const feature = "publickey-credentials-create";
    const get = "publickey-credentials-get";
    const allowsFeature = vi.fn((candidate) => candidate === get || allowed);
    vi.stubGlobal("self", self);
    vi.stubGlobal("top", topLevel ? self : {});
    vi.stubGlobal("document", {
      featurePolicy: {
        ...(enumerates ? { features: () => [get, ...(recognized ? [feature] : [])] } : {}),
        allowsFeature,
      },
    });
    try {
      const e = env({ create: registration(), get: assertion() }, { allows: browserEnv().allows });
      const result = await verifyUser(DIGEST, "Sam", e);
      expect(result.status).toBe(expected ? "verified" : "failed");
      expect(e.calls).toEqual(expected ? ["create", "get"] : []);
      expect(allowsFeature.mock.calls).toEqual(expected ? [[feature], [get]] : [[feature]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("verifyUser", () => {
  it.each([
    "first use",
    "after reset",
  ])("requires a fresh approval-bound assertion with the new passkey (%s)", async (scenario) => {
    let seen: PublicKeyCredentialCreationOptions | undefined;
    const storage = scenario === "after reset" ? storedPasskey(otherEc.publicKey) : memoryStorage();
    const getPublicKey = vi.fn(
      () => Uint8Array.from(ec.publicKey.export({ type: "spki", format: "der" })).buffer,
    );
    const getPublicKeyAlgorithm = vi.fn(() => -7);
    const get = vi.fn(async (o: CredentialRequestOptions) => {
      expect(storage.getItem(STORE_KEY)).toBeNull();
      return assertion()(o);
    });
    let randomCall = 0;
    const sync = env(
      {
        create: async (o) => {
          seen = o.publicKey;
          const cred = await registration({ coseOnly: true })(o);
          return { ...cred, response: { ...cred.response, getPublicKey, getPublicKeyAlgorithm } };
        },
        get,
      },
      { storage, random: (b) => b.fill(++randomCall) },
    );
    if (scenario === "after reset") forgetPasskey(sync);
    const r = await verifyUser(DIGEST, "Sam", sync);
    expect(r).toEqual({ status: "verified", method: "passkey", registered: true });
    expect(sync.calls).toEqual(["create", "get"]);
    expect(storage.getItem(STORE_KEY)).toBe(storedPasskey().getItem(STORE_KEY));
    expect(getPublicKey).toHaveBeenCalledOnce();
    expect(getPublicKeyAlgorithm).toHaveBeenCalledOnce();
    expect(seen?.authenticatorSelection).toMatchObject({
      authenticatorAttachment: "platform",
      userVerification: "required",
    });
    expect(seen?.rp.id).toBe(RP);
    const request = get.mock.calls[0]?.[0].publicKey;
    expect(request?.allowCredentials).toEqual([
      { type: "public-key", id: RAW, transports: ["internal"] },
    ]);
    const registrationChallenge = seen?.challenge as Uint8Array;
    const assertionChallenge = request?.challenge as Uint8Array;
    const prefix = new Uint8Array(
      await subtle.digest("SHA-256", new TextEncoder().encode(`errand-approval:${DIGEST}`)),
    );
    expect(registrationChallenge.subarray(0, 32)).toEqual(prefix);
    expect(assertionChallenge.subarray(0, 32)).toEqual(prefix);
    expect(assertionChallenge.subarray(32)).not.toEqual(registrationChallenge.subarray(32));
  });

  it.each([
    [
      "missing signature",
      assertion(0x05, { signature: "missing" }),
      { status: "failed", reason: "no passkey signature" },
    ],
    [
      "invalid signature",
      assertion(0x05, { signature: "invalid" }),
      { status: "failed", reason: "invalid passkey signature" },
    ],
    ["no credential", async () => null, { status: "cancelled" }],
    [
      "cancelled prompt",
      async () => {
        throw new DOMException("cancelled", "NotAllowedError");
      },
      { status: "cancelled" },
    ],
  ] as const)("does not save or approve on first use with %s", async (_scenario, get, result) => {
    const e = env({ create: registration(), get });
    expect(await verifyUser(DIGEST, "Sam", e)).toEqual(result);
    expect(e.calls).toEqual(["create", "get"]);
    expect(e.storage?.getItem(STORE_KEY)).toBeNull();
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
      { storage: storedPasskey() },
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
    const stored = { storage: storedPasskey() };
    const ok = env({ get: assertion(0x05) }, stored);
    expect(await verifyUser(DIGEST, "Sam", ok)).toEqual({
      status: "verified",
      method: "passkey",
      registered: false,
    });
    expect(ok.calls).toEqual(["get"]);
    const noUv = env({ get: assertion(0x01) }, { storage: storedPasskey() });
    expect(await verifyUser(DIGEST, "Sam", noUv)).toEqual({
      status: "failed",
      reason: "the device did not verify the user",
    });
  });

  it.each([
    "missing",
    "invalid",
    "malformed",
    "wrong-key",
  ] as const)("rejects an assertion with a %s signature", async (signature) => {
    const e = env({ get: assertion(0x05, { signature }) }, { storage: storedPasskey() });
    expect(await verifyUser(DIGEST, "Sam", e)).toEqual({
      status: "failed",
      reason: signature === "missing" ? "no passkey signature" : "invalid passkey signature",
    });
    expect(e.calls).toEqual(["get"]);
  });

  it("rejects an RS256 assertion signed by a different RSA key", async () => {
    const e = env(
      { get: assertion(0x05, { privateKey: otherRsa.privateKey }) },
      { storage: storedPasskey(rsa.publicKey) },
    );
    expect(await verifyUser(DIGEST, "Sam", e)).toEqual({
      status: "failed",
      reason: "invalid passkey signature",
    });
    expect(e.calls).toEqual(["get"]);
  });

  it.each([
    { keys: ec, coseOnly: true },
    { keys: rsa, coseOnly: false },
    { keys: rsa, coseOnly: true },
  ])("verifies with a persisted $keys.publicKey.asymmetricKeyType key (COSE fallback: $coseOnly)", async ({
    keys,
    coseOnly,
  }) => {
    const e = env({
      create: registration({ publicKey: keys.publicKey, coseOnly }),
      get: assertion(0x05, { privateKey: keys.privateKey }),
    });
    expect(await verifyUser(DIGEST, "Sam", e)).toMatchObject({
      status: "verified",
      registered: true,
    });
    expect(JSON.parse(e.storage?.getItem(STORE_KEY) ?? "null")).toEqual({
      id: b64url(RAW),
      publicKey: coseKey(keys.publicKey).toString("base64url"),
    });
    expect(await verifyUser(DIGEST, "Sam", e)).toMatchObject({
      status: "verified",
      registered: false,
    });
    expect(e.calls).toEqual(["create", "get", "get"]);
  });

  it.each([false, true])("rejects a 1024-bit RSA key (COSE fallback: %s)", async (coseOnly) => {
    const e = env({
      create: registration({ publicKey: shortRsa.publicKey, coseOnly }),
      get: assertion(0x05, { privateKey: shortRsa.privateKey }),
    });
    expect(await verifyUser(DIGEST, "Sam", e)).toEqual({
      status: "failed",
      reason: "registration returned no usable passkey public key",
    });
    expect(e.calls).toEqual(["create"]);
    expect(e.storage?.getItem(STORE_KEY)).toBeNull();
  });

  it.each([
    ["no bytes with ED set", 0xc5, ""],
    ["non-map item", 0xc5, "80"],
    ["truncated map value", 0xc5, "a16178"],
    ["duplicate map key", 0xc5, "a2617801617802"],
    ["invalid extension identifier", 0xc5, "a10001"],
    ["trailing bytes after map", 0xc5, "a0a0"],
    ["map without ED set", 0x45, "a0"],
  ] as const)("rejects attested COSE data with %s", async (_scenario, flags, extensionsHex) => {
    const e = env({
      create: registration({ coseOnly: true, flags, extensionsHex }),
      get: assertion(),
    });
    expect(await verifyUser(DIGEST, "Sam", e)).toEqual({
      status: "failed",
      reason: "registration returned no usable passkey public key",
    });
    expect(e.calls).toEqual(["create"]);
    expect(e.storage?.getItem(STORE_KEY)).toBeNull();
  });

  it.each([
    "a0",
    "a16178f5",
  ])("consumes a valid extension map (%s) without storing it with the key", async (extensionsHex) => {
    const e = env({
      create: registration({ coseOnly: true, flags: 0xc5, extensionsHex }),
      get: assertion(),
    });
    expect(await verifyUser(DIGEST, "Sam", e)).toEqual({
      status: "verified",
      method: "passkey",
      registered: true,
    });
    expect(e.calls).toEqual(["create", "get"]);
    expect(e.storage?.getItem(STORE_KEY)).toBe(storedPasskey().getItem(STORE_KEY));
  });

  it("requires a reset for an older stored ID without a public key", async () => {
    const e = env({ get: assertion() }, { storage: memoryStorage({ [STORE_KEY]: b64url(RAW) }) });
    expect(await verifyUser(DIGEST, "Sam", e)).toEqual({
      status: "failed",
      reason: "the saved passkey has no usable public key; reset it and try again",
    });
    expect(e.calls).toEqual([]);
    forgetPasskey(e);
    expect(e.storage?.getItem(STORE_KEY)).toBeNull();
  });

  it("rejects a wrong challenge, ceremony, site or credential", async () => {
    const s = () => ({ storage: storedPasskey() });
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
      { storage: storedPasskey() },
    );
    expect(await verifyUser(DIGEST, "Sam", e)).toEqual({ status: "cancelled" });
    expect(
      await verifyUser(DIGEST, "Sam", env({ get: async () => null }, { storage: storedPasskey() })),
    ).toEqual({ status: "cancelled" });
  });

  it("fails closed on denied permission, missing capabilities, and probe or ceremony errors", async () => {
    const error = new DOMException("blocked", "SecurityError");
    const throws = () => {
      throw error;
    };
    for (const overrides of [
      { credentials: undefined },
      { allows: () => false },
      { allows: throws },
      { platformAvailable: async () => false },
      { platformAvailable: throws },
    ]) {
      const e = env({}, overrides);
      expect((await verifyUser(DIGEST, "Sam", e)).status).toBe("failed");
      expect(e.calls).toEqual([]);
    }
    const e = env({ create: throws });
    expect((await verifyUser(DIGEST, "Sam", e)).status).toBe("failed");
    expect(e.calls).toEqual(["create"]);
  });

  it("requires both permissions before registration and only get for a stored passkey", async () => {
    const storage = memoryStorage();
    const allows = vi.fn((ceremony) => ceremony === "create");
    const e = env({ create: registration(), get: assertion() }, { allows, storage });
    expect(await verifyUser(DIGEST, "Sam", e)).toEqual({
      status: "failed",
      reason: "this page is embedded without passkey permission",
    });
    expect(allows.mock.calls).toEqual([["create"], ["get"]]);
    expect(e.calls).toEqual([]);
    allows.mockClear().mockReturnValue(true);
    expect((await verifyUser(DIGEST, "Sam", e)).status).toBe("verified");
    expect(allows.mock.calls).toEqual([["create"], ["get"]]);
    allows.mockClear().mockImplementation((ceremony) => ceremony === "get");
    expect((await verifyUser(DIGEST, "Sam", e)).status).toBe("verified");
    expect(allows.mock.calls).toEqual([["get"]]);
  });

  it.each([
    { flags: 0x41 },
    { tamper: true },
    { tamper: true, legacy: true },
    { noKey: true },
    { noKey: true, legacy: true },
  ])("does not persist or assert an invalid registration (%j)", async (options) => {
    const e = env({ create: registration(options), get: assertion() });
    expect((await verifyUser(DIGEST, "Sam", e)).status).toBe("failed");
    expect(e.storage?.getItem(STORE_KEY)).toBeNull();
    expect(e.calls).toEqual(["create"]);
  });

  it.each([
    "verified",
    "failed",
    "cancelled",
  ] as const)("uses the returned ID for one assertion after legacy registration (%s)", async (status) => {
    const storage = memoryStorage();
    const allows = vi.fn(() => true);
    const e = env(
      {
        create: registration({ legacy: true }),
        get: async (options) => {
          expect(storage.getItem(STORE_KEY)).toBeNull();
          expect(options.publicKey?.allowCredentials?.[0]?.id).toEqual(RAW);
          if (status === "cancelled") return null;
          return assertion(0x05, { signature: status === "failed" ? "wrong-key" : undefined })(
            options,
          );
        },
      },
      { storage, allows },
    );
    expect((await verifyUser(DIGEST, "Sam", e)).status).toBe(status);
    expect(e.calls).toEqual(["create", "get"]);
    expect(allows.mock.calls).toEqual([["create"], ["get"]]);
    expect(storage.getItem(STORE_KEY)).toBe(
      status === "verified" ? storedPasskey().getItem(STORE_KEY) : null,
    );
  });

  it("surfaces storage read, save, and reset failures", async () => {
    const storage = memoryStorage({ [STORE_KEY]: "AQ" });
    forgetPasskey(env({}, { storage }));
    expect(storage.map.has(STORE_KEY)).toBe(false);
    const blocked = () => {
      throw new Error("blocked");
    };
    const e = env(
      { create: registration(), get: assertion() },
      { storage: { ...storage, setItem: blocked, removeItem: blocked } },
    );
    expect(await verifyUser(DIGEST, "Sam", e)).toEqual({
      status: "failed",
      reason: "could not save the new passkey",
    });
    expect(() => forgetPasskey(e)).toThrow("blocked");
    const unreadable = env({}, { storage: { ...storage, getItem: blocked } });
    expect((await verifyUser(DIGEST, "Sam", unreadable)).status).toBe("failed");
    expect(unreadable.calls).toEqual([]);
  });
});

describe("passkey signature and key formats", () => {
  it.each([
    {
      scenario: "required padding",
      hex:
        "3045022100efb9fb6fc08f59b44417c8da76cc766815d2319c3f917f15329e60d4cf3ee68f" +
        "022066fc375ba138f8f2e4c8b455013f16b02ed3e16376b92955acd739b668bc141c",
      valid: true,
    },
    {
      scenario: "excess padding",
      hex:
        "3046022100efb9fb6fc08f59b44417c8da76cc766815d2319c3f917f15329e60d4cf3ee68f" +
        "02210066fc375ba138f8f2e4c8b455013f16b02ed3e16376b92955acd739b668bc141c",
      valid: false,
    },
    {
      scenario: "missing required padding",
      hex:
        "30440220efb9fb6fc08f59b44417c8da76cc766815d2319c3f917f15329e60d4cf3ee68f" +
        "022066fc375ba138f8f2e4c8b455013f16b02ed3e16376b92955acd739b668bc141c",
      valid: false,
    },
  ])("checks fixed ES256 signatures with $scenario", async ({ hex, valid }) => {
    const key = await subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: "one9aTEMVxpZ8e-Tzj2iXbwscpo9wTgsEAUeJ8H8mfY",
        y: "PMwttPJyl-LV3tfMH9NWnFg6sS1JJ9QKTTpfhe3lBm4",
      },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const response = {
      clientDataJSON: clientData("webauthn.get", new Uint8Array(48)),
      authenticatorData: await authData(0x05),
      signature: Uint8Array.from(Buffer.from(hex, "hex")).buffer,
    } as AuthenticatorAssertionResponse;
    expect(await verifyAssertionSignature(subtle, key, response)).toBe(valid);
  });

  it.each([
    ["ES256 declared as RSA", ec.publicKey, 3],
    ["RS256 declared as EC2", rsa.publicKey, 2],
  ] as const)("rejects a mismatched COSE algorithm and key type (%s)", async (_scenario, key, kty) => {
    const cose = Uint8Array.from(coseKey(key));
    // The first entry is kty (label 1). Keep the algorithm and parameters intact.
    cose[2] = kty;
    await expect(importCoseKey(subtle, cose)).rejects.toThrow("unsupported credential public key");
  });
});

describe("checkResponse", () => {
  it("rejects unreadable client data, the wrong origin, and short authenticator data", async () => {
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
        clientData("webauthn.get", ch, "https://elsewhere.example"),
        await authData(0x05),
      ),
    ).toBe("wrong origin");
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

const NOW = new Date("2026-11-13T12:00:00.000Z");

async function pendingRequest(engine: Engine): Promise<ApprovalRequest> {
  await vi.waitFor(() => expect(engine.getState().pending).toBeDefined());
  const pending = engine.getState().pending;
  if (!pending) throw new Error("no pending approval");
  return pending.request;
}

function answer(r: ApprovalRequest, type: "approve-once" | "deny") {
  return {
    requestId: r.id,
    digest: r.digest,
    type,
    offeredId: r.offered.find((o) => o.type === type)?.id ?? "?",
  };
}

function expectUnsigned(engine: Engine) {
  const state = engine.getState();
  expect(
    state.activity.some((a) => a.consentJws || a.filter === "purchases" || a.filter === "shared"),
  ).toBe(false);
  expect(state.rules).toHaveLength(0);
  expect(state.chats.flatMap((c) => c.messages).some((m) => m.type === "receipt")).toBe(false);
}

describe("approval signing boundary", () => {
  it.each([
    ["cancelled", env({ create: async () => null })],
    ["cancelled assertion", env({ create: registration(), get: async () => null })],
    [
      "invalid assertion",
      env({ create: registration(), get: assertion(0x05, { signature: "wrong-key" }) }),
    ],
    ["invalid response", env({ create: registration({ flags: 0x41 }) })],
    ["denied frame policy", env({ create: registration() }, { allows: () => false })],
  ] as const)("does not sign or act after %s", async (scenario, passkeyEnv) => {
    const engine = new Engine({ pace: 0, now: () => NOW, passkeyEnv: () => passkeyEnv });
    await engine.ready;
    const purchase = engine.buy(engine.getState().activeChat, "p:socks");
    const request = await pendingRequest(engine);
    const response = answer(request, "approve-once");
    const signer = vi.spyOn(crypto.subtle, "sign");
    try {
      expect(await engine.respond(response)).toEqual({
        ok: false,
        reason: "verification-required",
      });
      expect(await engine.respond(response, { status: "simulated" })).toEqual({
        ok: false,
        reason: "verification-required",
      });
      const check = await engine.verifyApproval(response);
      expect(check.status).toBe(scenario.startsWith("cancelled") ? "cancelled" : "failed");
      expect(await engine.respond(response, check)).toEqual({
        ok: false,
        reason: "verification-required",
      });
      await engine.respond(answer(request, "deny"));
      expect(await purchase).toBe("denied");
      expect(signer).not.toHaveBeenCalled();
      expectUnsigned(engine);
    } finally {
      signer.mockRestore();
    }
  });

  it("ignores a registration response returned after the user cancels", async () => {
    const controller = new AbortController();
    const e = env({
      create: async (options) => {
        controller.abort();
        return registration()(options);
      },
    });
    const engine = new Engine({ pace: 0, now: () => NOW, passkeyEnv: () => e });
    await engine.ready;
    const purchase = engine.buy(engine.getState().activeChat, "p:socks");
    const request = await pendingRequest(engine);
    const response = answer(request, "approve-once");
    const check = await engine.verifyApproval(response, controller.signal);
    expect(check).toEqual({ status: "cancelled" });
    expect(e.calls).toEqual(["create"]);
    expect(e.storage?.getItem(STORE_KEY)).toBeNull();
    expect(await engine.respond(response, check)).toEqual({
      ok: false,
      reason: "verification-required",
    });
    await engine.respond(answer(request, "deny"));
    await expect(purchase).resolves.toBe("denied");
    expectUnsigned(engine);
  });

  it("rejects a superseded check, a copied result, and a successful check replayed on a later request", async () => {
    const e = env({ create: registration(), get: assertion() });
    const engine = new Engine({ pace: 0, now: () => NOW, passkeyEnv: () => e });
    await engine.ready;
    const chat = engine.getState().activeChat;
    const purchase = engine.buy(chat, "p:socks");
    const first = await pendingRequest(engine);
    const response = answer(first, "approve-once");
    const stale = await engine.verifyApproval(response);
    const current = await engine.verifyApproval(response);
    expect(stale.status).toBe("verified");
    expect(current.status).toBe("verified");
    expect(await engine.respond(response, stale)).toEqual({
      ok: false,
      reason: "verification-required",
    });
    expect(await engine.respond(response, { ...current })).toEqual({
      ok: false,
      reason: "verification-required",
    });
    await engine.respond(answer(first, "deny"));
    await purchase;
    const next = engine.buy(chat, "p:socks");
    const second = await pendingRequest(engine);
    expect(second.id).not.toBe(first.id);
    expect(second.digest).toBe(first.digest);
    expect(await engine.respond(answer(second, "approve-once"), current)).toEqual({
      ok: false,
      reason: "verification-required",
    });
    await engine.respond(answer(second, "deny"));
    await next;
    expectUnsigned(engine);
  });

  it("refuses verification that resolves after expiry", async () => {
    let now = NOW;
    const e = env({
      create: registration(),
      get: async (o) => {
        now = new Date(NOW.getTime() + 10 * 60_000);
        return assertion()(o);
      },
    });
    const engine = new Engine({ pace: 0, now: () => now, passkeyEnv: () => e });
    await engine.ready;
    const purchase = engine.buy(engine.getState().activeChat, "p:socks");
    const request = await pendingRequest(engine);
    const response = answer(request, "approve-once");
    const result = await engine.verifyApproval(response);
    expect(result).toEqual({ status: "cancelled" });
    expect(await engine.respond(response, result)).toEqual({ ok: false, reason: "expired" });
    await expect(purchase).resolves.toBe("expired");
    expectUnsigned(engine);
  });

  it.each([
    "edited rule",
    "reduced share",
  ] as const)("challenges and signs the exact %s, refusing a post-check edit", async (scenario) => {
    let challenge: Uint8Array | undefined;
    const e = env({
      create: async (o) => {
        challenge = o.publicKey?.challenge as Uint8Array;
        return registration()(o);
      },
      get: async (o) => {
        challenge = o.publicKey?.challenge as Uint8Array;
        return assertion()(o);
      },
    });
    const engine = new Engine({ pace: 0, now: () => NOW, passkeyEnv: () => e });
    await engine.ready;
    const chat = engine.getState().activeChat;
    const buying = scenario === "edited rule";
    const work = buying ? engine.buy(chat, "p:socks") : engine.mortgageApply(chat);
    const request = await pendingRequest(engine);
    const fields = request.action.type === "share" ? request.action.fields : [];
    const keep = fields.filter((f) => f.required && f.state === "offered").map((f) => f.id);
    const offered = request.offered.find((o) => o.type === "set-limit");
    const base = { requestId: request.id, digest: request.digest };
    const response: PrincipalResponse =
      buying && offered?.draft
        ? {
            ...base,
            type: "set-limit",
            offeredId: offered.id,
            draft: {
              ...offered.draft,
              limit: { minor: 4300, currency: "USD" },
            },
          }
        : { ...base, type: "share-less", offeredId: "share-less", keep };
    const altered: PrincipalResponse =
      response.type === "set-limit"
        ? { ...response, draft: { ...response.draft, limit: { minor: 4900, currency: "USD" } } }
        : answer(request, "approve-once");
    const discarded = await engine.verifyApproval(response);
    expect(discarded.status).toBe("verified");
    expect(await engine.respond(altered, discarded)).toEqual({
      ok: false,
      reason: "verification-mismatch",
    });
    expect(await engine.respond(response, discarded)).toEqual({
      ok: false,
      reason: "verification-required",
    });
    expectUnsigned(engine);

    const confirmed = await engine.verifyApproval(response);
    expect(confirmed.status).toBe("verified");
    expect(await engine.respond(response, confirmed)).toEqual({ ok: true });
    if (!buying) {
      const stepUp = await pendingRequest(engine);
      expect(stepUp.kind).toBe("step-up");
      await engine.respond(answer(stepUp, "deny"));
    }
    await work;
    const jws = engine.getState().activity.find((a) => a.consentJws)?.consentJws;
    const key = (engine as unknown as { key: DeviceKey }).key;
    const record = await verifyRecord(jws ?? "", key.publicJwk);
    if (buying) {
      expect(record).toMatchObject({ type: "spending-rule", rule: { limit: { minor: 4300 } } });
    } else {
      const expected = actionDigest({
        ...request.action,
        fields: fields.map((f) =>
          f.state === "offered" && !keep.includes(f.id)
            ? { ...f, state: "withheld-by-gate", withheldReason: "You chose not to share this." }
            : f,
        ),
      });
      expect(expected).not.toBe(request.digest);
      expect(record).toMatchObject({ type: "approval", actionDigest: expected });
      expect(
        engine
          .getState()
          .activity.some((a) => a.summary === "Shared income, bank balance with North Bank"),
      ).toBe(true);
    }
    const digest = actionDigest({ requestId: request.id, payloads: [record] });
    const expectedChallengePrefix = new Uint8Array(
      await subtle.digest("SHA-256", new TextEncoder().encode(`errand-approval:${digest}`)),
    );
    expect(challenge?.slice(0, 32)).toEqual(expectedChallengePrefix);
  });
});
