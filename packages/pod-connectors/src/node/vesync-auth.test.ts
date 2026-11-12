// AUTHORED-BY Codex GPT-6.1-Sol
import { env, stderr, stdin } from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BYPASS, DEVICES, LOGIN, MAX_RESPONSE_BYTES, VESYNC_API } from "../vesync/api.js";
import { coreStatus } from "../vesync/fixtures.js";
import {
  createVeSyncSourceAuth,
  hashVeSyncPassword,
  hiddenPrompt,
  readVeSyncCredentials,
} from "./vesync-auth.js";

vi.mock("node:process", async (original) => {
  const actual = await original<typeof import("node:process")>();
  const { EventEmitter } = await import("node:events");
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    isRaw: false,
    isPaused: () => true,
    resume: vi.fn(),
    pause: vi.fn(),
    setRawMode: vi.fn((value: boolean) => {
      input.isRaw = value;
    }),
  });
  return { ...actual, stdin: input, stderr: { isTTY: true, write: vi.fn() } };
});
const email = "synthetic-login@example.invalid",
  password = "synthetic-private-password";
const credentials = { email, passwordHash: hashVeSyncPassword(password) };
const token = "synthetic-memory-only-token",
  accountID = "synthetic-private-account";
function transport(answers: (Response | Error | object)[] = []) {
  const requests: { url: string; body: Record<string, unknown>; init?: RequestInit }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input),
      body = JSON.parse(String(init?.body));
    requests.push({ url, body, init });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe("error");
    expect(JSON.stringify(body)).not.toContain(password);
    if (url === VESYNC_API + LOGIN) return Response.json({ code: 0, result: { token, accountID } });
    const answer = answers.shift() ?? coreStatus;
    if (answer instanceof Error) throw answer;
    return answer instanceof Response ? answer : Response.json(answer);
  });
  return { fetcher, requests };
}
function call(
  auth: ReturnType<typeof createVeSyncSourceAuth>,
  path = BYPASS,
  signal?: AbortSignal,
) {
  return auth.fetch(VESYNC_API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cid: "synthetic-cid", uuid: "synthetic-uuid" }),
    signal,
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.mocked(stderr.write).mockClear();
});

describe("VeSync memory-only account transport", () => {
  it("hashes immediately, drops environment plaintext and does not echo either prompt", async () => {
    vi.stubEnv("VESYNC_EMAIL", email);
    vi.stubEnv("VESYNC_PASSWORD", password);
    expect(await readVeSyncCredentials()).toEqual(credentials);
    expect(env.VESYNC_PASSWORD).toBeUndefined();
    expect(env.VESYNC_EMAIL).toBeUndefined();
    const prompt = readVeSyncCredentials();
    stdin.emit("data", Buffer.from(`${email}\r`));
    await vi.waitFor(() => expect(stderr.write).toHaveBeenCalledWith("VeSync password (hidden): "));
    stdin.emit("data", Buffer.from(`${password}\r`));
    expect(await prompt).toEqual(credentials);
    expect(stdin.isRaw).toBe(false);
    expect(stdin.listenerCount("data")).toBe(0);
    const printed = JSON.stringify(vi.mocked(stderr.write).mock.calls);
    expect(printed).not.toContain(email);
    expect(printed).not.toContain(password);
  });
  it("cleans up hidden input on Ctrl-C, abort, overflow and refuses non-TTY input", async () => {
    for (const end of ["\x03", "x".repeat(1025)]) {
      const prompt = hiddenPrompt("Hidden: ");
      const check = expect(prompt).rejects.toThrow();
      stdin.emit("data", Buffer.from(end));
      await check;
      expect(stdin.isRaw).toBe(false);
      expect(stdin.listenerCount("data")).toBe(0);
    }
    const control = new AbortController(),
      prompt = hiddenPrompt("Hidden: ", control.signal);
    const check = expect(prompt).rejects.toMatchObject({ kind: "cancelled" });
    control.abort();
    await check;
    expect(stdin.isRaw).toBe(false);
    const tty = stdin.isTTY;
    Object.assign(stdin, { isTTY: false });
    try {
      await expect(hiddenPrompt("Hidden: ")).rejects.toMatchObject({ kind: "auth" });
    } finally {
      Object.assign(stdin, { isTTY: tty });
    }
  });
  it("sends the pyvesync-shaped login, list and bypass requests only to fixed source routes", async () => {
    const t = transport();
    const auth = createVeSyncSourceAuth({ credentials, transport: t.fetcher });
    await call(auth, DEVICES);
    await call(auth);
    expect(t.requests[0]?.url).toBe(VESYNC_API + LOGIN);
    expect(t.requests[0]?.body).toMatchObject({
      email,
      password: credentials.passwordHash,
      method: "login",
      appVersion: "2.8.6",
      phoneBrand: "SM N9005",
      phoneOS: "Android",
      timeZone: "UTC",
      devToken: "",
      osType: "Android",
      userType: "1",
    });
    expect(t.requests[1]?.body).toMatchObject({
      method: "devices",
      pageNo: 1,
      pageSize: 50,
      token,
      accountID,
    });
    expect(t.requests[2]?.body).toMatchObject({
      method: "bypassV2",
      configModule: "WiFi",
      cid: "synthetic-cid",
      uuid: "synthetic-uuid",
      token,
      accountID,
      payload: { method: "getPurifierStatus", source: "APP", data: {} },
    });
    expect(t.requests.slice(1).some(({ body }) => "password" in body || "email" in body)).toBe(
      false,
    );
    for (const url of [
      "https://evil.invalid/cloud/v1/deviceManaged/devices",
      `${VESYNC_API}${DEVICES}?x=1`,
      `${VESYNC_API}/cloud/v1/deviceManaged/devices/evil`,
      `${VESYNC_API}${LOGIN}`,
      `${VESYNC_API}${DEVICES}#fragment`,
    ])
      await expect(auth.fetch(url, { method: "POST", body: "{}" })).rejects.toThrow(
        "VeSync request",
      );
    expect(t.requests).toHaveLength(3);
  });
  it.each([
    new Response(null, { status: 401 }),
    { code: -11000022 },
    { code: -11000021 },
  ])("renews exactly once after token expiry (%s)", async (expired) => {
    const t = transport([expired, coreStatus]);
    const auth = createVeSyncSourceAuth({ credentials, transport: t.fetcher });
    await expect(call(auth)).resolves.toBeInstanceOf(Response);
    expect(t.requests.filter(({ url }) => url.endsWith(LOGIN))).toHaveLength(2);
  });
  it("fails closed after a second expiry and never includes credentials in exceptions", async () => {
    const t = transport([{ code: -11000022 }, { code: -11000022 }]);
    const auth = createVeSyncSourceAuth({ credentials, transport: t.fetcher });
    const error = await call(auth).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(t.requests.filter(({ url }) => url.endsWith(LOGIN))).toHaveLength(2);
    const strings = JSON.stringify(error, Object.getOwnPropertyNames(error));
    for (const secret of [email, password, credentials.passwordHash, token, accountID])
      expect(strings).not.toContain(secret);
  });
  it.each([429, 500, 503])("backs off with bounded jitter for HTTP %i", async (status) => {
    const t = transport([
      new Response(null, { status }),
      new Response(null, { status }),
      coreStatus,
    ]);
    const sleep = vi.fn(async () => {});
    const auth = createVeSyncSourceAuth({
      credentials,
      transport: t.fetcher,
      sleep,
      random: () => 0.5,
    });
    await call(auth);
    expect(sleep.mock.calls.map((args) => args[0])).toEqual([1000, 2000]);
    expect(t.requests.filter(({ url }) => url.endsWith(BYPASS))).toHaveLength(3);
  });
  it("exhausts retries, refuses redirects and sanitizes malicious error/response text", async () => {
    const secret = [email, password, credentials.passwordHash, token, accountID].join(" ");
    for (const answers of [
      [
        new Response(null, { status: 429 }),
        new Response(null, { status: 503 }),
        new Response(null, { status: 500 }),
      ],
      [new Response(secret, { status: 302, headers: { location: "https://evil.invalid" } })],
      [new Error(secret)],
      [{ code: 123, msg: secret }],
      [{ code: "0", msg: secret }],
      [new Response(secret)],
      [new Response("{}", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } })],
      [new Response(" ".repeat(MAX_RESPONSE_BYTES + 1))],
    ]) {
      const t = transport(answers),
        auth = createVeSyncSourceAuth({ credentials, transport: t.fetcher, sleep: async () => {} });
      const error = await call(auth).catch((error: Error) => error);
      expect(error).toBeInstanceOf(Error);
      const strings = JSON.stringify(error, Object.getOwnPropertyNames(error));
      for (const value of [email, password, credentials.passwordHash, token, accountID])
        expect(strings).not.toContain(value);
    }
  });
  it("rejects hostile login envelopes with a safe authentication error", async () => {
    for (const result of [null, [], {}, { token: 7, accountID }, { token, accountID: [] }]) {
      const auth = createVeSyncSourceAuth({
        credentials,
        transport: async () => Response.json({ code: 0, result }),
      });
      await expect(call(auth)).rejects.toThrow("VeSync login failed");
    }
  });
  it("honours cancellation during login, response streaming and retry waits", async () => {
    for (const stage of ["login", "body", "retry"] as const) {
      const controller = new AbortController();
      const cancelled = vi.fn();
      const fetcher: typeof fetch = async (url, init) => {
        if (stage === "login")
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              cancelled();
              reject(new Error(password));
            });
          });
        if (String(url).endsWith(LOGIN))
          return Response.json({ code: 0, result: { token, accountID } });
        if (stage === "retry") return new Response(null, { status: 429 });
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("{"));
            },
            cancel() {
              cancelled();
            },
          }),
        );
      };
      const auth = createVeSyncSourceAuth({ credentials, transport: fetcher });
      const pending = call(auth, BYPASS, controller.signal);
      const check = expect(pending).rejects.toThrow();
      await vi.waitFor(() =>
        expect(stage === "login" || stage === "body" || stage === "retry").toBe(true),
      );
      // Flush login/request microtasks before aborting the active transport.
      for (let i = 0; i < 20; i++) await Promise.resolve();
      controller.abort();
      await check;
      if (stage !== "retry") await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());
    }
  });
  it("times out a non-cooperative transport using its AbortSignal", async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const auth = createVeSyncSourceAuth({
      credentials,
      transport: async () => new Promise(() => {}),
    });
    const pending = call(auth);
    const check = expect(pending).rejects.toThrow();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    timeout.abort();
    await check;
  });
});

it("handles UTF-8 split across terminal chunks, backspace, and terminal errors without echo", async () => {
  const result = hiddenPrompt("Hidden: ");
  const bytes = Buffer.from("é😀");
  stdin.emit("data", bytes.subarray(0, 1));
  stdin.emit("data", bytes.subarray(1));
  stdin.emit("data", Buffer.from("\x7f!\r"));
  expect(await result).toBe("é!");
  const failed = hiddenPrompt("Hidden: ");
  const check = expect(failed).rejects.toThrow("VeSync login failed");
  stdin.emit("error", new Error(password));
  await check;
  expect(stdin.isRaw).toBe(false);
  expect(stdin.listenerCount("data")).toBe(0);
});

it("refuses an already-aborted call without any source traffic", async () => {
  const t = transport();
  const controller = new AbortController();
  controller.abort();
  const auth = createVeSyncSourceAuth({ credentials, transport: t.fetcher });
  await expect(call(auth, BYPASS, controller.signal)).rejects.toThrow();
  expect(t.fetcher).not.toHaveBeenCalled();
});

it("honours an already-aborted credential read before consuming environment secrets", async () => {
  vi.stubEnv("VESYNC_EMAIL", email);
  vi.stubEnv("VESYNC_PASSWORD", password);
  const controller = new AbortController();
  controller.abort(new Error(password));
  await expect(readVeSyncCredentials(controller.signal)).rejects.toMatchObject({
    kind: "cancelled",
    message: "Import cancelled.",
  });
  expect(env.VESYNC_PASSWORD).toBe(password);
});
