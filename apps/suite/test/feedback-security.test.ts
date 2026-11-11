// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { sniffAudio, validateAudio } from "../src/feedback/audio";
import {
  allowedOrigin,
  createGithubBackoff,
  createLimiter,
  readBody,
  visitorKey,
} from "../src/feedback/security";

it("normalises IPv6 /64s including compressed and mapped addresses", () => {
  expect(visitorKey("2001:0db8:0000:0001::1234")).toBe(visitorKey("2001:db8:0:1:ffff::1"));
  expect(visitorKey("2001:db8:0:2::1")).not.toBe(visitorKey("2001:db8:0:1::1"));
  expect(visitorKey("::ffff:192.0.2.3")).toBe("192.0.2.3");
  expect(visitorKey("127.0.0.1")).toBe("127.0.0.1");
  expect(visitorKey("fake")).toBe("unknown");
});
it("limits turns by ten minutes and rolling day, submits by hour, and instance totals across visitors", () => {
  let now = 0;
  const limit = createLimiter(() => now, { turn: 9999, submit: 9999 });
  for (let i = 0; i < 30; i++) expect(limit("a", "turn")).toBeUndefined();
  expect(limit("a", "turn")).toBe(600_000);
  expect(limit("b", "turn")).toBeUndefined();
  for (let round = 1; round < 4; round++) {
    now += 600_000;
    for (let i = 0; i < 30; i++) expect(limit("a", "turn")).toBeUndefined();
  }
  now += 600_000;
  expect(limit("a", "turn")).toBeGreaterThan(0);
  for (let i = 0; i < 5; i++) expect(limit("a", "submit")).toBeUndefined();
  expect(limit("a", "submit")).toBe(3_600_000);
  now += 3_600_000;
  expect(limit("a", "submit")).toBeUndefined();
  now += 86_400_000;
  expect(limit("a", "turn")).toBeUndefined();
  const instance = createLimiter(() => now, { turn: 1, submit: 1 });
  expect(instance("x", "turn")).toBeUndefined();
  expect(instance("y", "turn")).toBeGreaterThan(0);
  expect(instance("x", "submit")).toBeUndefined();
  expect(instance("y", "submit")).toBeGreaterThan(0);
});
it("allows deployment and localhost origins exactly, or an explicit native allowlist", () => {
  const req = (origin: string) =>
    new Request("https://solid-suite.vercel.app/api", { headers: { Origin: origin } });
  expect(allowedOrigin(req("https://solid-suite.vercel.app"), {})).toBeDefined();
  expect(allowedOrigin(req("http://localhost:3210"), {})).toBeDefined();
  expect(allowedOrigin(req("https://solid-suite.vercel.app.evil.test"), {})).toBeUndefined();
  expect(allowedOrigin(req("http://localhost.evil.test"), {})).toBeUndefined();
  expect(allowedOrigin(new Request("https://solid-suite.vercel.app"), {})).toBeUndefined();
  expect(
    allowedOrigin(req("capacitor://localhost"), {
      FEEDBACK_ALLOWED_ORIGINS: "capacitor://localhost,https://localhost",
    }),
  ).toBe("capacitor://localhost");
  expect(
    allowedOrigin(req("http://localhost:3210"), {
      FEEDBACK_ALLOWED_ORIGINS: "https://example.com",
    }),
  ).toBeUndefined();
});
it("caps bodies using actual bytes even with missing or dishonest content-length", async () => {
  expect(await readBody(new Request("https://a.test", { method: "POST", body: "ok" }), 2)).toEqual(
    new TextEncoder().encode("ok"),
  );
  await expect(
    readBody(
      new Request("https://a.test", {
        method: "POST",
        body: "1234",
        headers: { "content-length": "1" },
      }),
      3,
    ),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    readBody(
      new Request("https://a.test", {
        method: "POST",
        body: "1",
        headers: { "content-length": "100" },
      }),
      3,
    ),
  ).rejects.toMatchObject({ status: 413 });
});
describe("audio admission", () => {
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
  it("sniffs supported containers and checks declared MIME", async () => {
    expect(sniffAudio(webm)).toBe("webm");
    expect(sniffAudio(new TextEncoder().encode("OggS12345678"))).toBe("ogg");
    expect(sniffAudio(new TextEncoder().encode("0000ftypM4A 0000"))).toBe("m4a");
    expect(sniffAudio(new TextEncoder().encode("0000ftypisom0000"))).toBe("m4a");
    expect(sniffAudio(new TextEncoder().encode("0000ftypavif0000"))).toBeUndefined();
    expect(sniffAudio(new TextEncoder().encode("<script>bad</script>"))).toBeUndefined();
    expect(
      (await validateAudio(new File([webm], "a", { type: "audio/webm;codecs=opus" }))).ext,
    ).toBe("webm");
    await expect(validateAudio(new File([webm], "a", { type: "audio/mp4" }))).rejects.toThrow();
    await expect(validateAudio(new File([webm], "a", { type: "image/png" }))).rejects.toThrow();
    await expect(
      validateAudio(new File([new Uint8Array(3 * 1024 * 1024 + 1)], "a", { type: "audio/webm" })),
    ).rejects.toThrow();
    await expect(validateAudio(new File([], "a", { type: "audio/webm" }))).rejects.toThrow();
  });
});

it("limits audio uploads to twenty per visitor per hour and applies an instance cap", () => {
  let now = 0;
  const limit = createLimiter(() => now);
  for (let i = 0; i < 20; i++) expect(limit("a", "audio")).toBeUndefined();
  expect(limit("a", "audio")).toBe(3_600_000);
  expect(limit("b", "audio")).toBeUndefined();
  now += 3_600_000;
  expect(limit("a", "audio")).toBeUndefined();
  const instance = createLimiter(() => now, { turn: 1, submit: 1, audio: 1 });
  expect(instance("a", "audio")).toBeUndefined();
  expect(instance("b", "audio")).toBeGreaterThan(0);
});

it("preserves a healthy budget and distinguishes GitHub permission failures from throttling", async () => {
  const backoff = createGithubBackoff(() => 1_800_000_000_000);
  for (const response of [
    Response.json({}, { headers: { "x-ratelimit-remaining": "50" } }),
    Response.json({ message: "Resource not accessible by integration" }, { status: 403 }),
    new Response("Forbidden", { status: 403 }),
  ])
    await expect(backoff.observe(response)).resolves.toBeUndefined();
  expect(() => backoff.check()).not.toThrow();
});
it("records a low-budget cooldown without discarding a successful response", async () => {
  let now = 1_800_000_000_000;
  const backoff = createGithubBackoff(() => now);
  await expect(
    backoff.observe(
      Response.json(
        { number: 123 },
        {
          status: 201,
          headers: { "x-ratelimit-remaining": "49", "x-ratelimit-reset": String(now / 1000 + 120) },
        },
      ),
    ),
  ).resolves.toBeUndefined();
  expect(() => backoff.check()).toThrow(expect.objectContaining({ status: 503, retryAfter: 120 }));
  now += 120_000;
  expect(() => backoff.check()).not.toThrow();
});
it.each([
  { reset: 180, retry: 90 },
  { reset: 90, retry: 180 },
])("honours the later primary reset ($reset) and retry HTTP date ($retry)", async ({
  reset,
  retry,
}) => {
  let now = 1_800_000_000_000;
  const backoff = createGithubBackoff(() => now);
  await expect(
    backoff.observe(
      Response.json(
        {},
        {
          status: 429,
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(now / 1000 + reset),
            "retry-after": new Date(now + retry * 1000).toUTCString(),
          },
        },
      ),
    ),
  ).rejects.toMatchObject({ status: 503, retryAfter: 180 });
  now += 90_000;
  expect(() => backoff.check()).toThrow();
  now += 90_000;
  expect(() => backoff.check()).not.toThrow();
});
