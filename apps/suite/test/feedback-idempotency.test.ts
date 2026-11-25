// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { signReceipt } from "../src/feedback/receipts";
import { feedbackGithub } from "./helpers/feedback-github";

const env = {
  FEEDBACK_GITHUB_TOKEN: "secret",
  FEEDBACK_RECEIPT_SECRET: "receipt-secret",
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
    submit: (nextRecord = record, nextReceipts = receipts, id = submissionId) =>
      createFeedbackHandlers({ env, limiter: () => undefined }).submit(
        request({ submissionId: id, record: nextRecord, receipts: nextReceipts }),
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

it("reads the issue number recorded in the repository first, ignoring unrelated issues", async () => {
  const api = github();
  const h = await client();
  expect((await h.submit()).status).toBe(200);
  const original = api.issues[0];
  if (!original) throw new Error("Missing saved issue");
  original.state = "closed";
  for (let i = 0; i < 1_000; i++)
    api.issues.push({
      number: 124 + i,
      body: i % 2 ? "Unrelated demo feedback" : original.body,
      ...(i % 2 ? {} : { pull_request: {} }),
    });
  const calls = api.calls.length;
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  // Metadata, head, index, recorded issue number: no search and no issue listing at all.
  expect(api.calls.length - calls).toBe(4);
  const paths = api.calls.slice(calls).map(({ url }) => new URL(url).pathname);
  expect(paths).toContain(
    `/repos/private/feedback/contents/feedback/submissions/${submissionId}.issue.json`,
  );
  expect(paths.some((path) => path.includes("/search/"))).toBe(false);
  expect(paths.some((path) => path.endsWith("/issues"))).toBe(false);
  expect(
    api.calls.filter(({ url, method }) => url.endsWith("/issues") && method === "POST"),
  ).toHaveLength(1);
});

// M1/L3: a retry right after a lost POST response must find the issue through the consistent
// list endpoint (the fake throws if search is ever used), not open a second one.
const listCalls = (api: ReturnType<typeof github>) =>
  api.calls.filter(
    ({ url, method }) => new URL(url).pathname.endsWith("/issues") && method === "GET",
  );
async function lostIssue() {
  const api = github();
  const h = await client();
  api.loseIssueResponse();
  expect((await h.submit()).status).toBe(502);
  expect(api.issues).toHaveLength(1);
  return { api, h };
}
const recent = () => new Date(Date.now() + 1000).toISOString();

it("recovers a lost issue response from the list, never searching, and records the number", async () => {
  const { api, h } = await lostIssue();
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(api.issues).toHaveLength(1);
  expect(api.calls.some(({ url }) => new URL(url).pathname === "/search/issues")).toBe(false);
  const listings = listCalls(api);
  expect(listings).toHaveLength(1);
  const query = new URL(listings[0]?.url ?? "").searchParams;
  expect(query.get("state")).toBe("all");
  expect(query.get("sort")).toBe("created");
  expect(query.get("direction")).toBe("desc");
  expect(query.get("per_page")).toBe("100");
  // `since` filters on update time, so it must not be sent.
  expect(query.has("since")).toBe(false);
  const calls = api.calls.length;
  expect(await (await h.submit()).json()).toEqual({ reference: 123 });
  expect(api.calls.slice(calls).some(({ url }) => new URL(url).pathname.endsWith("/issues"))).toBe(
    false,
  );
});

it("finds the issue on page 1 of a big repository whose older issues were recently updated", async () => {
  const { api, h } = await lostIssue();
  // 1,500 issues created long ago but touched just now (bulk relabel): update-time filtering
  // would fill every page with them.
  for (let i = 0; i < 1_500; i++)
    api.issues.push({
      number: 2_000 + i,
      body: "Old feedback",
      created_at: "2020-01-01T00:00:00Z",
      updated_at: new Date().toISOString(),
    });
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(listCalls(api)).toHaveLength(1);
  expect(api.issues).toHaveLength(1_501);
});

it("stops listing at the first issue older than the submission", async () => {
  const api = github();
  const h = await client();
  api.holdIssue(async () => {
    throw new Error("Issue creation failed");
  });
  expect((await h.submit()).status).toBe(502);
  api.holdIssue(async () => {});
  for (let i = 0; i < 250; i++)
    api.issues.push({ number: 5_000 + i, body: "Old", created_at: "2020-01-01T00:00:00Z" });
  // The list proves no issue exists (the old ones are never read past), so one is opened.
  expect((await h.submit()).status).toBe(200);
  expect(listCalls(api)).toHaveLength(1);
  expect(api.issues).toHaveLength(251);
});

it("does not let unrelated issues that quote the marker block recovery", async () => {
  const { api, h } = await lostIssue();
  const marker = `<!-- feedback-submission:${submissionId} -->`;
  api.issues.push(
    { number: 500, body: `quote ${marker} and more text`, created_at: recent() },
    { number: 501, body: `pr ${marker}`, pull_request: {}, created_at: recent() },
    { number: 502, body: "Unrelated", created_at: recent() },
  );
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(api.issues).toHaveLength(4); // Nothing new was opened.
});

it("prefers the exact match even when a quoting issue sits on an earlier page", async () => {
  const { api, h } = await lostIssue();
  const marker = `<!-- feedback-submission:${submissionId} -->`;
  for (let i = 0; i < 100; i++)
    api.issues.push({ number: 1_000 + i, body: `quote ${marker} mid`, created_at: recent() });
  const retry = await h.submit();
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(listCalls(api).length).toBeGreaterThan(1);
});

it("recovers when only a quoting issue still holds the marker after a maintainer edit", async () => {
  const { api, h } = await lostIssue();
  const original = api.issues[0];
  if (!original) throw new Error("Missing saved issue");
  original.body = `${original.body}\n\nTriaged by a maintainer.`;
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(api.issues).toHaveLength(1);
});

it("pages through newer issues to find ours", async () => {
  const { api, h } = await lostIssue();
  for (let i = 0; i < 250; i++)
    api.issues.push({ number: 1_000 + i, body: "Unrelated", created_at: recent() });
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({ reference: 123 });
  expect(listCalls(api).map(({ url }) => new URL(url).searchParams.get("page"))).toEqual([
    "1",
    "2",
    "3",
  ]);
});

it("returns a retry-later answer instead of opening a duplicate when the scan is bounded", async () => {
  const { api, h } = await lostIssue();
  for (let i = 0; i < 2_100; i++)
    api.issues.push({ number: 10_000 + i, body: "Unrelated", created_at: recent() });
  const retry = await h.submit();
  expect(retry.status).toBe(503);
  expect(retry.headers.get("retry-after")).toBe("60");
  expect(await retry.json()).toMatchObject({ code: "storage_busy" });
  expect(listCalls(api)).toHaveLength(20);
  expect(api.issues).toHaveLength(2_101);
});

it("opens one issue when the list proves none exists", async () => {
  const api = github();
  const h = await client();
  api.holdIssue(async () => {
    throw new Error("Issue creation failed");
  });
  expect((await h.submit()).status).toBe(502);
  api.holdIssue(async () => {});
  api.issues.push({ number: 7, body: "Unrelated", created_at: recent() });
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(api.issues).toHaveLength(2);
  expect(api.calls.some(({ url }) => new URL(url).pathname === "/search/issues")).toBe(false);
});

it("ignores a malformed or unreadable recorded issue number and falls back to the list", async () => {
  const api = github();
  const h = await client();
  expect((await h.submit()).status).toBe(200);
  api.corruptIssueRecord();
  expect(await (await h.submit()).json()).toEqual({ reference: 123 });
  api.corruptIssueRecord("{}");
  expect(await (await h.submit()).json()).toEqual({ reference: 123 });
  expect(api.issues).toHaveLength(1);
});

it("still returns the reference when recording the issue number fails", async () => {
  const api = github();
  const h = await client();
  api.failIssueRecord();
  const response = await h.submit();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ reference: 123 });
  api.failIssueRecord(false);
  // The record was never written, so the next retry finds the issue by listing.
  expect(await (await h.submit()).json()).toEqual({ reference: 123 });
  expect(api.issues).toHaveLength(1);
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
  // Recorded-number read, one list page, one issue POST, then the number is recorded.
  expect(api.calls.length - calls).toBe(12);
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
  expect(api.calls.length - calls).toBe(12);
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(1);
  expect(
    api.calls.filter(({ url, method }) => url.endsWith("/issues") && method === "POST"),
  ).toHaveLength(1);
});

it("shares a 30-second deadline across the recovery listing and resumed issue creation", async () => {
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
  let listings = 0;
  let posts = 0;
  vi.mocked(fetch).mockImplementation(async (input, options) => {
    const path = new URL(String(input)).pathname;
    const slow = path.endsWith("/issues") && ["GET", "POST"].includes(options?.method ?? "GET");
    if (slow) {
      if (options?.method === "GET") listings++;
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
  expect(listings).toBe(1);
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

// A transport TypeError after the commit used to map to 400, so the client unfroze and
// edited a record that GitHub had already stored.
it("maps a transport failure after the record commit to 502 and resumes on retry", async () => {
  const api = github();
  const h = await client();
  api.holdIssue(async () => {
    throw new TypeError("fetch failed");
  });
  expect((await h.submit()).status).toBe(502);
  api.holdIssue(async () => {});
  const retry = await h.submit();
  expect(retry.status).toBe(200);
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(1);
});

it("stops an admitted save at its next GitHub call when another request hits a secondary limit", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  const api = feedbackGithub();
  const h = await client();
  const { githubBackoff } = await import("../src/feedback/security");
  let tripped = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const response = await api.transport(input, init);
    if (!tripped && String(input).endsWith("/git/commits")) {
      tripped = true;
      // Another request's response reports a secondary limit while this save is in flight.
      await githubBackoff
        .observe(
          Response.json(
            { message: "You have exceeded a secondary rate limit." },
            { status: 403, headers: { "retry-after": "60" } },
          ),
        )
        .catch(() => undefined);
    }
    return response;
  });
  expect((await h.submit()).status).toBe(503);
  const calls = api.calls.map(({ url, method }) => `${method} ${url}`);
  expect(calls.at(-1)).toMatch(/POST .*\/git\/commits$/);
  expect(api.issues).toHaveLength(0);
  vi.advanceTimersByTime(60_000);
  expect((await h.submit()).status).toBe(200);
  expect(api.records).toHaveLength(1);
  expect(api.issues).toHaveLength(1);
});
