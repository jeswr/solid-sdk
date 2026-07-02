// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the WebAuthn ceremony at the module boundary: registerPasskey's value is
// the fail-closed HTTP orchestration (options -> create -> register), not
// SimpleWebAuthn's serialization (covered live in WebAuthnTokenProvider.test.ts).
const { startRegistrationMock } = vi.hoisted(() => ({
  startRegistrationMock: vi.fn(),
}));
vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: (...args: unknown[]) => startRegistrationMock(...args),
}));

import { registerPasskey } from "../../src/client/registration.js";

const OPTIONS_URL = "https://op.example/.account/webauthn/register-options";
const REGISTER_URL = "https://op.example/.account/webauthn/register";
const CLIENT_ID = "https://app.example/clientid.jsonld";
const WEB_ID = "https://app.example/profile#me";

const CREATION_OPTIONS = {
  rp: { id: "app.example", name: "App" },
  user: { id: "dXNlcg", name: "u", displayName: "u" },
  challenge: "Y2hhbGxlbmdl",
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  authenticatorSelection: { userVerification: "preferred" },
};

const FAKE_CREDENTIAL = {
  id: "cred-id",
  rawId: "cred-id",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
    attestationObject: "YXR0ZXN0",
  },
  type: "public-key",
  clientExtensionResults: {},
};

/** Build an authenticated-fetch mock answering options then register. */
function authFetchMock(
  opts: {
    optionsStatus?: number;
    registerStatus?: number;
    optionsBody?: unknown;
    registerBody?: string | null;
    registerContentType?: string;
  } = {},
) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (url.includes("register-options")) {
      return new Response(JSON.stringify(opts.optionsBody ?? CREATION_OPTIONS), {
        status: opts.optionsStatus ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
    // register endpoint
    const status = opts.registerStatus ?? 201;
    const ct = opts.registerContentType ?? "application/json";
    const body = opts.registerBody === undefined ? JSON.stringify({ ok: true }) : opts.registerBody;
    return new Response(body, { status, headers: { "content-type": ct } });
  });
  return { fn, calls };
}

beforeEach(() => {
  startRegistrationMock.mockReset();
  startRegistrationMock.mockResolvedValue(FAKE_CREDENTIAL);
  // Global fetch must never be used — registration is authenticated. A throwing
  // stub proves the injected fetch is the only network path.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("global fetch must not be used by registerPasskey");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("registerPasskey", () => {
  it("runs options -> create -> register through the injected authed fetch", async () => {
    const { fn, calls } = authFetchMock();

    const result = await registerPasskey({
      registerOptionsUrl: OPTIONS_URL,
      registerUrl: REGISTER_URL,
      clientId: CLIENT_ID,
      webId: WEB_ID,
      fetch: fn,
    });

    // options POSTed with clientId + webId.
    expect(calls[0]?.url).toBe(OPTIONS_URL);
    expect(calls[0]?.init?.method).toBe("POST");
    const optionsBody = JSON.parse(calls[0]?.init?.body as string);
    expect(optionsBody).toEqual({ clientId: CLIENT_ID, webId: WEB_ID });

    // ceremony ran.
    expect(startRegistrationMock).toHaveBeenCalledOnce();

    // register POSTed with the versioned bundle.
    expect(calls[1]?.url).toBe(REGISTER_URL);
    expect(calls[1]?.init?.method).toBe("POST");
    const regBody = JSON.parse(calls[1]?.init?.body as string);
    expect(regBody).toEqual({
      version: 1,
      credential: FAKE_CREDENTIAL,
      clientId: CLIENT_ID,
      webId: WEB_ID,
    });

    // global fetch untouched.
    expect(fetch).not.toHaveBeenCalled();

    expect(result.credential).toEqual(FAKE_CREDENTIAL);
    expect(result.registration).toEqual({ ok: true });
  });

  it("forces a resident/discoverable credential by default, preserving other selection keys", async () => {
    const { fn } = authFetchMock();

    await registerPasskey({
      registerOptionsUrl: OPTIONS_URL,
      registerUrl: REGISTER_URL,
      clientId: CLIENT_ID,
      fetch: fn,
    });

    const passed = startRegistrationMock.mock.calls[0]?.[0] as {
      optionsJSON: { authenticatorSelection: Record<string, unknown> };
    };
    expect(passed.optionsJSON.authenticatorSelection).toMatchObject({
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "preferred", // preserved from the OP options
    });
  });

  it("does not mutate the OP's returned options payload", async () => {
    const optionsBody = JSON.parse(JSON.stringify(CREATION_OPTIONS));
    const { fn } = authFetchMock({ optionsBody });

    await registerPasskey({
      registerOptionsUrl: OPTIONS_URL,
      registerUrl: REGISTER_URL,
      clientId: CLIENT_ID,
      fetch: fn,
    });

    // The forced resident-key fields were merged into a NEW object, not the
    // parsed OP payload template.
    expect(CREATION_OPTIONS.authenticatorSelection).toEqual({
      userVerification: "preferred",
    });
  });

  it("leaves the selection untouched when requireResidentKey is false", async () => {
    const { fn } = authFetchMock();

    await registerPasskey({
      registerOptionsUrl: OPTIONS_URL,
      registerUrl: REGISTER_URL,
      clientId: CLIENT_ID,
      fetch: fn,
      requireResidentKey: false,
    });

    const passed = startRegistrationMock.mock.calls[0]?.[0] as {
      optionsJSON: { authenticatorSelection: Record<string, unknown> };
    };
    expect(passed.optionsJSON.authenticatorSelection).toEqual({
      userVerification: "preferred",
    });
  });

  it("omits webId from both bodies when not provided", async () => {
    const { fn, calls } = authFetchMock();

    await registerPasskey({
      registerOptionsUrl: OPTIONS_URL,
      registerUrl: REGISTER_URL,
      clientId: CLIENT_ID,
      fetch: fn,
    });

    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ clientId: CLIENT_ID });
    expect(JSON.parse(calls[1]?.init?.body as string)).not.toHaveProperty("webId");
  });

  it("fails closed (before the ceremony) when register-options is not ok", async () => {
    const { fn } = authFetchMock({ optionsStatus: 401 });

    await expect(
      registerPasskey({
        registerOptionsUrl: OPTIONS_URL,
        registerUrl: REGISTER_URL,
        clientId: CLIENT_ID,
        fetch: fn,
      }),
    ).rejects.toThrow(/register-options request failed/);
    expect(startRegistrationMock).not.toHaveBeenCalled();
  });

  it("fails closed when the register request is not ok (after the ceremony)", async () => {
    const { fn } = authFetchMock({ registerStatus: 400 });

    await expect(
      registerPasskey({
        registerOptionsUrl: OPTIONS_URL,
        registerUrl: REGISTER_URL,
        clientId: CLIENT_ID,
        fetch: fn,
      }),
    ).rejects.toThrow(/register request failed/);
    expect(startRegistrationMock).toHaveBeenCalledOnce();
  });

  it("fails closed when register-options returns a non-object payload", async () => {
    const { fn } = authFetchMock({ optionsBody: "a string" });

    await expect(
      registerPasskey({
        registerOptionsUrl: OPTIONS_URL,
        registerUrl: REGISTER_URL,
        clientId: CLIENT_ID,
        fetch: fn,
      }),
    ).rejects.toThrow(/not an object/);
    expect(startRegistrationMock).not.toHaveBeenCalled();
  });

  it("rejects a non-absolute registerOptionsUrl", async () => {
    const { fn } = authFetchMock();
    await expect(
      registerPasskey({
        registerOptionsUrl: "/relative/options",
        registerUrl: REGISTER_URL,
        clientId: CLIENT_ID,
        fetch: fn,
      }),
    ).rejects.toThrow(/registerOptionsUrl.*absolute URL/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("rejects a non-absolute clientId", async () => {
    const { fn } = authFetchMock();
    await expect(
      registerPasskey({
        registerOptionsUrl: OPTIONS_URL,
        registerUrl: REGISTER_URL,
        clientId: "clientid",
        fetch: fn,
      }),
    ).rejects.toThrow(/clientId.*absolute URL/);
  });

  it("tolerates an empty / non-JSON register response body", async () => {
    const { fn } = authFetchMock({ registerBody: null, registerContentType: "text/plain" });

    const result = await registerPasskey({
      registerOptionsUrl: OPTIONS_URL,
      registerUrl: REGISTER_URL,
      clientId: CLIENT_ID,
      fetch: fn,
    });

    expect(result.registration).toBeUndefined();
    expect(result.credential).toEqual(FAKE_CREDENTIAL);
  });

  it("forwards the abort signal to both HTTP requests", async () => {
    const { fn, calls } = authFetchMock();
    const controller = new AbortController();

    await registerPasskey({
      registerOptionsUrl: OPTIONS_URL,
      registerUrl: REGISTER_URL,
      clientId: CLIENT_ID,
      fetch: fn,
      signal: controller.signal,
    });

    expect(calls[0]?.init?.signal).toBe(controller.signal);
    expect(calls[1]?.init?.signal).toBe(controller.signal);
  });
});
