// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { questionById } from "../src/feedback/guide";
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
const env = { ANTHROPIC_API_KEY: "key", FEEDBACK_ALLOWED_ORIGINS: "https://suite.test" };
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
          answers: { seq_drive: 5, summary: null },
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
    max_tokens: 4000,
    output_config: { effort: "low" },
  });
});
it("does not mark done until read-back is confirmed", async () => {
  const client = {
    complete: vi.fn().mockResolvedValue(
      JSON.stringify({
        reply: "Did I get that right?",
        answers: { summary: "Your words" },
        nextQuestionId: "confirmed",
        done: true,
      }),
    ),
  };
  expect((await (await handlers({ client }).turn(request(turn))).json()).done).toBe(false);
  client.complete.mockResolvedValue(
    JSON.stringify({
      reply: "Thanks",
      answers: { summary: "You said this", confirmed: "yes" },
      nextQuestionId: null,
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
        answers: {},
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
function multipart(data: unknown = submission, count = 1, bad = false) {
  const form = new FormData();
  form.set("json", JSON.stringify(data));
  for (let i = 0; i < count; i++)
    form.append(
      "audio",
      new Blob(
        [
          bad
            ? new TextEncoder().encode("bad audio text")
            : new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]),
        ],
        { type: "audio/webm" },
      ),
      "untrusted-name.html",
    );
  return new Request("https://suite.test/api/feedback/submit", {
    method: "POST",
    headers: { Origin: "https://suite.test" },
    body: form,
  });
}
it("validates multipart and invokes the store with rebuilt JSON and sniffed audio", async () => {
  const save = vi.fn().mockResolvedValue({ reference: 12 });
  const response = await handlers({ store: { save } }).submit(multipart());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ reference: 12 });
  expect(save.mock.calls[0]?.[0]).toEqual(submission);
  expect(save.mock.calls[0]?.[1][0]).toMatchObject({ ext: "webm", type: "audio/webm" });
});
it("rejects too many recordings, spoofed audio, unknown JSON fields and missing turn attachments", async () => {
  const save = vi.fn();
  const h = handlers({ store: { save } });
  expect((await h.submit(multipart(submission, 11))).status).toBe(400);
  expect((await h.submit(multipart(submission, 1, true))).status).toBe(400);
  expect((await h.submit(multipart({ ...submission, secret: "x" }))).status).toBe(400);
  expect((await h.submit(multipart(submission, 0))).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});
it("returns 503 when storage is unconfigured with no repository or credentials in the response", async () => {
  const r = await handlers().submit(multipart());
  expect(r.status).toBe(503);
  expect(await r.text()).not.toContain("github.com/");
});
it("exports usable Node route handlers", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  const route = await import("../src/app/api/feedback/turn/route");
  expect(route.runtime).toBe("nodejs");
  expect(await route.GET(new Request("https://suite.test")).json()).toEqual({ hosted: false });
  const submit = await import("../src/app/api/feedback/submit/route");
  expect(submit.runtime).toBe("nodejs");
  expect((await submit.POST(request(turn, "https://evil.test"))).status).toBe(403);
});
