// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { signReceipt } from "../src/feedback/receipts";
import { feedbackGithub } from "./helpers/feedback-github";

const env = {
  FEEDBACK_GITHUB_TOKEN: "secret",
  FEEDBACK_GITHUB_REPO: "private/feedback",
  FEEDBACK_ALLOWED_ORIGINS: "https://suite.test",
};
const submissionId = "11111111-1111-4111-8111-111111111111";
const record = {
  pathway: "quick",
  answers: { general: "Alice found the demo confusing." },
  transcript: [{ role: "user", content: "Demo feedback", audio: [0] }],
  contact: { name: "", email: "" },
  metadata: { version: "preview", commit: "", userAgent: "test", walkthrough: [] },
};
const request = (value: unknown) =>
  new Request("https://suite.test/api/feedback/submit", {
    method: "POST",
    headers: { Origin: "https://suite.test", "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });

function github() {
  const api = feedbackGithub();
  vi.spyOn(globalThis, "fetch").mockImplementation(api.transport);
  return api;
}

async function client() {
  vi.resetModules();
  const { createFeedbackHandlers } = await import("../src/feedback/server");
  const receipts = [signReceipt({ submissionId, sha: "a".repeat(40), size: 12, ext: "webm" }, env)];
  // A new handler/store per request exercises the same lifecycle as the production route.
  return {
    submit: (nextRecord = record, nextReceipts = receipts) =>
      createFeedbackHandlers({ env, limiter: () => undefined }).submit(
        request({ submissionId, record: nextRecord, receipts: nextReceipts }),
      ),
    audio: () =>
      createFeedbackHandlers({ env, limiter: () => undefined }).audio(
        new Request(`https://suite.test/api/feedback/audio?submissionId=${submissionId}`, {
          method: "POST",
          headers: { Origin: "https://suite.test", "Content-Type": "audio/webm" },
          body: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]),
        }),
      ),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("repeated POSTs return the original reference and reject changed records or audio under one ID", async () => {
  const api = github();
  const h = await client();
  for (let i = 0; i < 2; i++) {
    const response = await h.submit();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reference: 123 });
  }
  expect((await h.submit({ ...record, answers: { general: "A different record" } })).status).toBe(
    409,
  );
  const changedAudio = signReceipt(
    { submissionId, sha: "b".repeat(40), size: 12, ext: "webm" },
    env,
  );
  expect((await h.submit(record, [changedAudio])).status).toBe(409);
  expect(api.records).toHaveLength(1);
  expect(api.records[0]?.record.id).toBe(submissionId);
  expect(api.issues).toHaveLength(1);
});

it("a losing concurrent writer checks the committed ID before creating another issue", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  const api = github();
  const h = await client();
  const responses = await Promise.all([h.submit(), h.submit()]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(api.conflicts).toBe(1);
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(1);
});

it("preserves identity across restarts, dates, object key ordering and renewed receipts", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  const api = github();
  const first = await client();
  expect((await first.submit()).status).toBe(200);
  vi.advanceTimersByTime(86_400_000);
  const restarted = await client();
  const reordered = {
    ...record,
    metadata: {
      walkthrough: [],
      userAgent: "test",
      commit: "",
      version: "preview",
    },
  };
  const retry = await restarted.submit(reordered);
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(1);
});

it("finds a closed reference beyond the first issue page and ignores pull requests", async () => {
  const api = github();
  const h = await client();
  expect((await h.submit()).status).toBe(200);
  const original = api.issues[0];
  if (!original) throw new Error("Missing saved issue");
  original.state = "closed";
  for (let i = 0; i < 100; i++)
    api.issues.push({
      number: 124 + i,
      body: original.body,
      pull_request: {},
    });
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(api.calls.filter(({ url }) => url.includes("/issues?"))).toEqual([
    {
      url: "https://api.github.com/repos/private/feedback/issues?state=all&sort=created&direction=desc&per_page=100&page=1",
      method: "GET",
    },
    {
      url: "https://api.github.com/repos/private/feedback/issues?state=all&sort=created&direction=desc&per_page=100&page=2",
      method: "GET",
    },
  ]);
  expect(
    api.calls.filter(({ url, method }) => url.endsWith("/issues") && method === "POST"),
  ).toHaveLength(1);
});

it("a retry during issue creation waits without creating a second issue", async () => {
  const api = github();
  const h = await client();
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = () => {};
  const starting = new Promise<void>((resolve) => {
    started = resolve;
  });
  let attempts = 0;
  api.holdIssue(async () => {
    if (++attempts === 1) {
      started();
      await held;
    }
  });
  const first = h.submit();
  await starting;
  const retry = await h.submit();
  release();
  expect((await first).status).toBe(200);
  expect(retry.status).toBe(503);
  expect((await h.submit()).status).toBe(200);
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(1);
});

it("recovers the reference after an issue was created but its response was lost", async () => {
  const api = github();
  const h = await client();
  api.loseIssueResponse();
  expect((await h.submit()).status).toBe(502);
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(1);
});

it("does not repeat an issue POST when a committed submission has no discoverable reference", async () => {
  const api = github();
  const h = await client();
  api.holdIssue(async () => {
    throw new Error("Issue creation failed");
  });
  expect((await h.submit()).status).toBe(502);
  const retry = await h.submit();
  expect(retry.status).toBe(503);
  expect(retry.headers.get("retry-after")).toBe("60");
  expect(await retry.json()).toEqual({ error: expect.stringContaining("download your feedback") });
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(0);
  expect(
    api.calls.filter(({ url, method }) => url.endsWith("/issues") && method === "POST"),
  ).toHaveLength(1);
});

it("returns a successful final issue response at budget 49 and blocks later calls until reset", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  const api = github();
  const h = await client();
  api.lowBudget();
  const response = await h.submit();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ reference: 123 });
  const calls = api.calls.length;
  const blocked = await h.audio();
  expect(blocked.status).toBe(503);
  expect(blocked.headers.get("retry-after")).toBe("120");
  expect(api.calls).toHaveLength(calls);
  vi.advanceTimersByTime(120_000);
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(api.issues).toHaveLength(1);
});
