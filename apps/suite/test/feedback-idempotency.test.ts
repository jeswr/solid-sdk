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

it("recovers a closed reference with one search despite 10,000 newer issues and pull requests", async () => {
  const api = github();
  const h = await client();
  expect((await h.submit()).status).toBe(200);
  const original = api.issues[0];
  if (!original) throw new Error("Missing saved issue");
  original.state = "closed";
  for (let i = 0; i < 10_000; i++)
    api.issues.push({
      number: 124 + i,
      body: i % 2 ? "Unrelated demo feedback" : original.body,
      ...(i % 2 ? {} : { pull_request: {} }),
    });
  const calls = api.calls.length;
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(api.calls.length - calls).toBe(4); // Metadata, head, index, one search.
  const searches = api.calls.filter(({ url }) => new URL(url).pathname === "/search/issues");
  expect(searches).toHaveLength(1);
  const search = new URL(searches[0]?.url ?? "");
  expect(search.searchParams.get("q")).toBe(
    `repo:private/feedback is:issue in:body "feedback-submission:${submissionId}"`,
  );
  expect(search.searchParams.get("per_page")).toBe("1");
  expect(
    api.calls.some(
      ({ url, method }) =>
        new URL(url).pathname === "/repos/private/feedback/issues" && method === "GET",
    ),
  ).toBe(false);
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

it("resumes a committed submission without an issue, linking the original files after a restart", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  const api = github();
  const h = await client();
  api.holdIssue(async () => {
    throw new Error("Issue creation failed");
  });
  expect((await h.submit()).status).toBe(502);
  api.holdIssue(async () => {});
  vi.advanceTimersByTime(86_400_000);
  const restarted = await client();
  const calls = api.calls.length;
  const retry = await restarted.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(api.calls.length - calls).toBe(5); // Recovery plus one issue POST, no new Git writes.
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(1);
  expect(api.issues[0]?.body).toContain(`/feedback/2026-11-11/${submissionId}/submission.json`);
  expect(
    api.calls.filter(({ url, method }) => url.endsWith("/issues") && method === "POST"),
  ).toHaveLength(2);
});

it("finishes issue creation when the successful ref update starts a cooldown", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  const api = github();
  const h = await client();
  api.lowBudget("ref");
  const response = await h.submit();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ reference: 123 });
  const calls = api.calls.length;
  expect((await h.audio()).status).toBe(503);
  expect(api.calls).toHaveLength(calls);
  vi.advanceTimersByTime(120_000);
  expect((await h.submit()).status).toBe(200);
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(1);
});

it("resumes an unattempted issue after the committed ref response was lost", async () => {
  const api = github();
  const h = await client();
  api.loseRefResponse();
  expect((await h.submit()).status).toBe(502);
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(0);
  const restarted = await client();
  const calls = api.calls.length;
  const retry = await restarted.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(api.calls.length - calls).toBe(5);
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(1);
  expect(
    api.calls.filter(({ url, method }) => url.endsWith("/issues") && method === "POST"),
  ).toHaveLength(1);
});

it("shares a 30-second deadline across recovery search and resumed issue creation", async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  const api = github();
  const h = await client();
  api.holdIssue(async () => {
    throw new Error("Issue creation failed");
  });
  expect((await h.submit()).status).toBe(502);
  api.holdIssue(async () => {});
  let searches = 0;
  let posts = 0;
  vi.mocked(fetch).mockImplementation(async (input, options) => {
    const path = new URL(String(input)).pathname;
    if (path === "/search/issues" || (path.endsWith("/issues") && options?.method === "POST")) {
      if (path === "/search/issues") searches++;
      else posts++;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new Error("GitHub request timed out"));
        };
        const timer = setTimeout(() => {
          options?.signal?.removeEventListener("abort", abort);
          resolve();
        }, 20_000);
        options?.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    return api.transport(input, options);
  });
  let status: number | undefined;
  const retry = h.submit().then((response) => {
    status = response.status;
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(searches).toBe(1);
  expect(posts).toBe(1);
  expect(status).toBe(502);
  await retry;
  expect(api.issues).toHaveLength(0);
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
