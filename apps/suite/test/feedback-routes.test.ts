// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { questionById } from "../src/feedback/guide";
import { signReceipt } from "../src/feedback/receipts";
import { createLimiter } from "../src/feedback/security";
import { createFeedbackHandlers } from "../src/feedback/server";
import { validateSubmission } from "../src/feedback/validation";

const complete = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: complete };
  },
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const env = {
  FEEDBACK_GITHUB_TOKEN: "secret",
  ANTHROPIC_API_KEY: "key",
  FEEDBACK_ALLOWED_ORIGINS: "https://suite.test",
};
const turn = {
  pathway: "guided",
  answers: {},
  messages: [{ role: "user", content: "I use files" }],
};
const request = (value: unknown, origin = "https://suite.test") =>
  new Request("https://suite.test/api/feedback/turn", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
function handlers(extra = {}) {
  return createFeedbackHandlers({ env, limiter: createLimiter(), ...extra });
}
it("reports hosted true/false and permits native preflight only for allowed origins", async () => {
  expect(await handlers().get().json()).toEqual({ hosted: true });
  expect(await createFeedbackHandlers({ env: {} }).get().json()).toEqual({ hosted: false });
  expect(handlers().options(request(turn)).status).toBe(204);
  expect(handlers().options(request(turn, "https://evil.test")).status).toBe(403);
});
it("calls the real SDK seam with low-effort structured output and returns a guide control", async () => {
  complete.mockResolvedValue({
    stop_reason: "end_turn",
    content: [
      {
        type: "text",
        text: JSON.stringify({
          reply: "Rate this.",
          updates: [{ id: "seq_drive", value: "5" }],
          nextQuestionId: "umux_ease",
          done: false,
        }),
      },
    ],
  });
  const response = await handlers().turn(request(turn));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    reply: "Rate this.",
    answers: { seq_drive: 5 },
    question: questionById("umux_ease"),
    done: false,
  });
  expect(complete.mock.calls[0]?.[0]).toMatchObject({
    model: "claude-opus-5-5",
    max_tokens: 1500,
    output_config: { effort: "low" },
  });
});
it("does not mark done until read-back is confirmed", async () => {
  const client = {
    complete: vi.fn().mockResolvedValue(
      JSON.stringify({
        reply: "Did I get that right?",
        updates: [{ id: "summary", value: "Your words" }],
        nextQuestionId: "confirmed",
        done: true,
      }),
    ),
  };
  expect((await (await handlers({ client }).turn(request(turn))).json()).done).toBe(false);
  client.complete.mockResolvedValue(
    JSON.stringify({
      reply: "Thanks",
      updates: [
        { id: "summary", value: "You said this" },
        { id: "confirmed", value: "yes" },
      ],
      nextQuestionId: "none",
      done: true,
    }),
  );
  expect(
    (
      await (
        await handlers({ client }).turn(
          request({
            ...turn,
            answers: { summary: "You said this" },
            messages: [{ role: "user", content: "Yes" }],
          }),
        )
      ).json()
    ).done,
  ).toBe(true);
});
it("rejects origins, field injection, body overflow and missing hosting before calling the model", async () => {
  expect((await handlers().turn(request(turn, "https://evil.test"))).status).toBe(403);
  expect((await handlers().turn(request({ ...turn, model: "no" }))).status).toBe(400);
  expect(
    (
      await handlers().turn(
        request({ ...turn, messages: [{ role: "user", content: "x".repeat(241000) }] }),
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await handlers({ env: { FEEDBACK_ALLOWED_ORIGINS: "https://suite.test" } }).turn(
        request(turn),
      )
    ).status,
  ).toBe(503);
  expect(complete).not.toHaveBeenCalled();
});
it("returns safe model errors, refuses truncation, and rate-limits with retry-after", async () => {
  complete.mockRejectedValueOnce(new Error("api-key secret"));
  const failed = await handlers().turn(request(turn));
  expect(failed.status).toBe(502);
  expect(await failed.text()).not.toContain("api-key");
  complete.mockResolvedValueOnce({ stop_reason: "max_tokens", content: [] });
  expect((await handlers().turn(request(turn))).status).toBe(502);
  const client = {
    complete: vi.fn().mockResolvedValue(
      JSON.stringify({
        reply: "Next",
        updates: [],
        nextQuestionId: "context_tools",
        done: false,
      }),
    ),
  };
  const h = handlers({ client, limiter: createLimiter(() => 0, { turn: 1, submit: 1 }) });
  expect((await h.turn(request(turn))).status).toBe(200);
  const limited = await h.turn(request(turn));
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBeDefined();
});
const submission = validateSubmission({
  pathway: "quick",
  answers: { general: "Hello" },
  transcript: [{ role: "user", content: "Hello", audio: [0] }],
  contact: { name: "", email: "" },
  metadata: { version: "preview", commit: "", userAgent: "test", walkthrough: [] },
});
const submissionId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
const receipt = () =>
  signReceipt({ submissionId, sha: "a".repeat(40), size: webm.length, ext: "webm" }, env);
const audioRequest = (bytes = webm, mime = "audio/webm", origin = "https://suite.test") =>
  new Request(`https://suite.test/api/feedback/audio?submissionId=${submissionId}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": mime },
    body: bytes,
  });
it("uploads one sniffed clip and submits only rebuilt JSON and verified receipts", async () => {
  const saved = receipt();
  const upload = vi.fn().mockResolvedValue(saved);
  const save = vi.fn().mockResolvedValue({ reference: 12 });
  const h = handlers({ store: { upload, save } });
  const audio = await h.audio(audioRequest());
  expect(audio.status).toBe(200);
  expect(await audio.json()).toEqual(saved);
  expect(upload).toHaveBeenCalledWith(
    { bytes: webm, ext: "webm", type: "audio/webm" },
    submissionId,
  );
  const response = await h.submit(request({ submissionId, record: submission, receipts: [saved] }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ reference: 12 });
  expect(save).toHaveBeenCalledWith(submission, [saved]);
});
it("rejects audio spoofing, body overflow and forbidden origins before storage", async () => {
  const upload = vi.fn();
  const h = handlers({ store: { upload, save: vi.fn() } });
  expect((await h.audio(audioRequest(webm, "audio/mp4"))).status).toBe(400);
  expect((await h.audio(audioRequest(new TextEncoder().encode("not real audio")))).status).toBe(
    400,
  );
  expect((await h.audio(audioRequest(new Uint8Array(3 * 1024 * 1024 + 1)))).status).toBe(413);
  expect((await h.audio(audioRequest(webm, "audio/webm", "https://evil.test"))).status).toBe(403);
  expect(upload).not.toHaveBeenCalled();
});
it("rejects unknown or duplicate shas, missing attachments, too many receipts, extras and multipart submits", async () => {
  const saved = receipt();
  const save = vi.fn();
  const h = handlers({ store: { save, upload: vi.fn() }, limiter: () => undefined });
  for (const data of [
    { submissionId, record: submission, receipts: [] },
    { submissionId, record: submission, receipts: [saved, saved] },
    { submissionId, record: submission, receipts: [{ ...saved, sha: "b".repeat(40) }] },
    { submissionId, record: submission, receipts: Array(11).fill(saved) },
    { submissionId, record: { ...submission, secret: "x" }, receipts: [saved] },
    { submissionId, record: submission, receipts: [saved], secret: "x" },
  ])
    expect((await h.submit(request(data))).status).toBe(400);
  expect(
    (
      await h.submit(
        new Request("https://suite.test", {
          method: "POST",
          headers: { Origin: "https://suite.test" },
          body: new FormData(),
        }),
      )
    ).status,
  ).toBe(415);
  expect(
    (await h.submit(request({ submissionId, record: "x".repeat(1_000_001), receipts: [] }))).status,
  ).toBe(413);
  expect(save).not.toHaveBeenCalled();
});
it("returns 503 when storage is unconfigured with no repository or credentials in the response", async () => {
  const r = await handlers().submit(
    request({ submissionId, record: { ...submission, transcript: [] }, receipts: [] }),
  );
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("github.com/");
});
it("merges coerced model updates with collected answers and ignores unrecognised ids and invalid scales", async () => {
  const client = {
    complete: vi.fn().mockResolvedValue(
      JSON.stringify({
        reply: "Next",
        updates: [
          { id: "unknown", value: "x" },
          { id: "seq_drive", value: "99" },
          { id: "apps", value: "drive|tasks" },
        ],
        nextQuestionId: "context_tools",
        done: false,
      }),
    ),
  };
  const r = await handlers({ client }).turn(
    request({ ...turn, answers: { seq_drive: 4, general: "Keep me" } }),
  );
  expect(r.status).toBe(200);
  expect((await r.json()).answers).toEqual({
    seq_drive: 4,
    general: "Keep me",
    apps: ["drive", "tasks"],
  });
});
it("exports usable Node route handlers", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  const route = await import("../src/app/api/feedback/turn/route");
  expect(route.runtime).toBe("nodejs");
  expect(await route.GET(new Request("https://suite.test")).json()).toEqual({ hosted: false });
  const submit = await import("../src/app/api/feedback/submit/route");
  expect(submit.runtime).toBe("nodejs");
  const audio = await import("../src/app/api/feedback/audio/route");
  expect(audio.runtime).toBe("nodejs");
  expect((await audio.POST(audioRequest(webm, "audio/webm", "https://evil.test"))).status).toBe(
    403,
  );
  expect((await submit.POST(request(turn, "https://evil.test"))).status).toBe(403);
});
it("rechecks repository privacy for submission after an earlier upload", async () => {
  const transport = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ private: true, default_branch: "main" }))
    .mockResolvedValueOnce(Response.json({ sha: "a".repeat(40) }))
    .mockResolvedValueOnce(Response.json({ private: false, default_branch: "main" }));
  try {
    const h = handlers({ env: { ...env, FEEDBACK_GITHUB_REPO: "private/feedback" } });
    const uploaded = await h.audio(audioRequest());
    expect(uploaded.status).toBe(200);
    const response = await h.submit(
      request({ submissionId, record: submission, receipts: [await uploaded.json()] }),
    );
    expect(response.status).toBe(503);
    expect(transport.mock.calls.map(([, options]) => options?.method)).toEqual([
      "GET",
      "POST",
      "GET",
    ]);
  } finally {
    transport.mockRestore();
  }
});

it("rejects a receipt from another interview, including a tampered submission id", async () => {
  const saved = receipt();
  const save = vi.fn();
  const h = handlers({ store: { save, upload: vi.fn() }, limiter: () => undefined });
  for (const receipts of [[saved], [{ ...saved, submissionId: otherId }]]) {
    const response = await h.submit(
      request({ submissionId: otherId, record: submission, receipts }),
    );
    expect(response.status).toBe(400);
  }
  expect(save).not.toHaveBeenCalled();
});
it.each([
  undefined,
  "not-a-uuid",
])("requires a UUID on uploads and submissions (%s)", async (id) => {
  const upload = vi.fn();
  const save = vi.fn();
  const h = handlers({ store: { upload, save } });
  const audio = audioRequest();
  const url = new URL(audio.url);
  if (id === undefined) url.searchParams.delete("submissionId");
  else url.searchParams.set("submissionId", id);
  expect((await h.audio(new Request(url, audio))).status).toBe(400);
  expect(
    (await h.submit(request({ submissionId: id, record: submission, receipts: [receipt()] })))
      .status,
  ).toBe(400);
  expect(upload).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
it("returns a friendly error with Retry-After on a GitHub limit and blocks later requests", async () => {
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    Response.json(
      {},
      {
        status: 429,
        headers: { "retry-after": "90" },
      },
    ),
  );
  try {
    const h = handlers({ env: { ...env, FEEDBACK_GITHUB_REPO: "private/feedback" } });
    for (const response of [
      await h.audio(audioRequest()),
      await h.submit(
        request({ submissionId, record: { ...submission, transcript: [] }, receipts: [] }),
      ),
    ]) {
      expect(response.status).toBe(503);
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(89);
      expect(response.headers.get("access-control-expose-headers")).toBe("Retry-After");
      expect(await response.json()).toEqual({ error: expect.stringContaining("try again later") });
    }
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    transport.mockRestore();
  }
});
