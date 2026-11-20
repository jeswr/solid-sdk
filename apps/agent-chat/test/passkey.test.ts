// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
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

const verifyUser = (digest: string, displayName: string, environment: PasskeyEnv) =>
  runVerification(digest, displayName, () => environment);

function registration(options: { flags?: number; tamper?: boolean; legacy?: boolean } = {}) {
  return async (o: CredentialCreationOptions) => {
    const challenge = options.tamper
      ? new Uint8Array(48)
      : (o.publicKey?.challenge as BufferSource);
    const ad = await authData(options.flags ?? 0x45);
    return {
      rawId: RAW.buffer,
      response: {
        clientDataJSON: clientData("webauthn.create", challenge),
        ...(options.legacy ? {} : { getAuthenticatorData: () => ad }),
      },
    };
  };
}

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

describe("browser WebAuthn policy", () => {
  it.each([
    { recognized: false, topLevel: true, allowed: false, expected: true },
    { recognized: false, topLevel: false, allowed: false, expected: false },
    { recognized: true, topLevel: true, allowed: false, expected: false },
    { recognized: true, topLevel: false, allowed: true, expected: true },
  ])("preflights registration with $recognized recognition, $topLevel top-level, and $allowed permission", async ({
    recognized,
    topLevel,
    allowed,
    expected,
  }) => {
    const self = {};
    const feature = "publickey-credentials-create";
    const allowsFeature = vi.fn(() => allowed);
    vi.stubGlobal("self", self);
    vi.stubGlobal("top", topLevel ? self : {});
    vi.stubGlobal("document", {
      featurePolicy: {
        features: () => ["publickey-credentials-get", ...(recognized ? [feature] : [])],
        allowsFeature,
      },
    });
    try {
      const e = env({ create: registration() }, { allows: browserEnv().allows });
      const result = await verifyUser(DIGEST, "Sam", e);
      expect(result.status).toBe(expected ? "verified" : "failed");
      expect(e.calls).toEqual(expected ? ["create"] : []);
      expect(allowsFeature.mock.calls).toEqual(recognized ? [[feature]] : []);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

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

  it("probes only create for registration and only get for a stored passkey", async () => {
    const storage = memoryStorage();
    const allows = vi.fn((ceremony) => ceremony === "create");
    const e = env({ create: registration(), get: assertion() }, { allows, storage });
    expect((await verifyUser(DIGEST, "Sam", e)).status).toBe("verified");
    expect(allows.mock.calls).toEqual([["create"]]);
    allows.mockClear().mockImplementation((ceremony) => ceremony === "get");
    expect((await verifyUser(DIGEST, "Sam", e)).status).toBe("verified");
    expect(allows.mock.calls).toEqual([["get"]]);
  });

  it.each([
    { flags: 0x41 },
    { tamper: true },
    { tamper: true, legacy: true },
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
  ] as const)("uses the returned ID for one fallback assertion and only saves on success (%s)", async (status) => {
    const storage = memoryStorage();
    const allows = vi.fn(() => true);
    const e = env(
      {
        create: registration({ legacy: true }),
        get: async (options) => {
          expect(storage.getItem(STORE_KEY)).toBeNull();
          expect(options.publicKey?.allowCredentials?.[0]?.id).toEqual(RAW);
          if (status === "cancelled") return null;
          return assertion(status === "failed" ? 0x01 : 0x05)(options);
        },
      },
      { storage, allows },
    );
    expect((await verifyUser(DIGEST, "Sam", e)).status).toBe(status);
    expect(e.calls).toEqual(["create", "get"]);
    expect(allows.mock.calls).toEqual([["create"], ["get"]]);
    expect(storage.getItem(STORE_KEY)).toBe(status === "verified" ? b64url(RAW) : null);
  });

  it("surfaces storage read, save, and reset failures", async () => {
    const storage = memoryStorage({ [STORE_KEY]: "AQ" });
    forgetPasskey(env({}, { storage }));
    expect(storage.map.has(STORE_KEY)).toBe(false);
    const blocked = () => {
      throw new Error("blocked");
    };
    const e = env(
      { create: registration() },
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
      expect(check.status).toBe(scenario === "cancelled" ? "cancelled" : "failed");
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
      create: async (o) => {
        now = new Date(NOW.getTime() + 10 * 60_000);
        return registration()(o);
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
