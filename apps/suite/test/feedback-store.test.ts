// AUTHORED-BY Codex GPT-6.1-Sol
import { unzipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { feedbackArchive } from "../src/feedback/download";
import { plainTitle, renderMarkdown } from "../src/feedback/markdown";
import { signReceipt, verifyReceipts } from "../src/feedback/receipts";
import { createGithubStore } from "../src/feedback/store";
import type { Submission } from "../src/feedback/validation";

const submission: Submission = {
  pathway: "guided",
  answers: {
    apps: ["drive"],
    summary: "@team <script>bad</script> [click](https://evil.test)\nsecond line",
    seq_drive: 6,
    umux_capabilities: 5,
    umux_ease: 4,
    likelihood: 3,
    values_control: "Mine",
    values_ladders: "Because @person",
    incident_best: "worked",
    incident_stuck: "stuck",
    jobs_use: "work",
    one_change: "speed",
    confirmed: "yes",
  },
  transcript: [{ role: "user", content: "</details> @team #1 ![image](url)", audio: [0] }],
  contact: { name: "", email: "" },
  metadata: { version: "preview", commit: "", userAgent: "test", walkthrough: ["drive"] },
};
const env = { FEEDBACK_GITHUB_TOKEN: "secret-token", FEEDBACK_GITHUB_REPO: "private/feedback" };
const sha = "a".repeat(40);
const head = "b".repeat(40);
const baseTree = "c".repeat(40);
const treeSha = "d".repeat(40);
const submissionId = "11111111-1111-4111-8111-111111111111";
const receipt = signReceipt({ submissionId, sha, size: 2, ext: "webm" }, env);
const metadata = { private: true, default_branch: "team/main" };
function commitResponses(
  transport: ReturnType<typeof vi.fn<typeof fetch>>,
  conflict = false,
  nextHead = head,
  nextTree = baseTree,
) {
  transport.mockResolvedValueOnce(Response.json({ object: { sha: nextHead } }));
  transport.mockResolvedValueOnce(Response.json({ tree: { sha: nextTree } }));
  transport.mockResolvedValueOnce(Response.json({ sha: treeSha }));
  transport.mockResolvedValueOnce(Response.json({ sha }));
  transport.mockResolvedValueOnce(
    conflict
      ? Response.json({ message: "Update is not a fast forward" }, { status: 422 })
      : Response.json({}),
  );
}
function initial(transport: ReturnType<typeof vi.fn<typeof fetch>>) {
  transport.mockResolvedValueOnce(Response.json(metadata));
  transport.mockResolvedValueOnce(Response.json({ sha: head }));
  transport.mockResolvedValueOnce(Response.json({ sha: baseTree }));
}
const bodies = (transport: ReturnType<typeof vi.fn<typeof fetch>>) =>
  transport.mock.calls.map(([, o]) => (o?.body ? JSON.parse(String(o.body)) : {}));
it("creates one atomic commit with audio, JSON and Markdown, then an issue with immutable links", async () => {
  const transport = vi.fn<typeof fetch>();
  initial(transport);
  commitResponses(transport);
  transport.mockResolvedValueOnce(new Response("label absent", { status: 422 }));
  transport.mockResolvedValueOnce(Response.json({ number: 12 }));
  const store = createGithubStore(
    env,
    transport,
    () => new Date("2026-11-11T12:00:00Z"),
    () => "test-id",
  );
  expect(await store.save(submission, [receipt])).toEqual({ reference: 12 });
  expect(
    transport.mock.calls.map(([url, o]) => [
      String(url).replace("https://api.github.com/repos/private/feedback", ""),
      o?.method,
    ]),
  ).toEqual([
    ["", "GET"],
    ["/git/blobs", "POST"],
    ["/git/blobs", "POST"],
    ["/git/ref/heads/team/main", "GET"],
    [`/git/commits/${head}`, "GET"],
    ["/git/trees", "POST"],
    ["/git/commits", "POST"],
    ["/git/refs/heads/team/main", "PATCH"],
    ["/issues", "POST"],
    ["/issues", "POST"],
  ]);
  const data = bodies(transport);
  const record = JSON.parse(Buffer.from(data[1].content, "base64").toString());
  expect(record.transcript).toEqual(submission.transcript);
  expect(record.audio).toEqual([{ path: "audio-1.webm", sha, size: 2, ext: "webm" }]);
  expect(Buffer.from(data[2].content, "base64").toString()).toContain("audio-1.webm");
  expect(data[5]).toEqual({
    base_tree: baseTree,
    tree: [
      { path: "feedback/2026-11-11/test-id/audio-1.webm", sha, mode: "100644", type: "blob" },
      {
        path: "feedback/2026-11-11/test-id/submission.json",
        sha: head,
        mode: "100644",
        type: "blob",
      },
      {
        path: "feedback/2026-11-11/test-id/summary.md",
        sha: baseTree,
        mode: "100644",
        type: "blob",
      },
    ],
  });
  expect(data[6]).toMatchObject({ tree: treeSha, parents: [head] });
  expect(data[7]).toEqual({ sha, force: false });
  expect(data[8].labels).toEqual(["feedback", "pathway:guided", "app:drive"]);
  expect(data[9]).not.toHaveProperty("labels");
  expect(data[9].title).toBe(plainTitle(`guided: ${submission.answers.summary}`));
  expect(data[9].body).toContain(
    `https://github.com/private/feedback/blob/${sha}/feedback/2026-11-11/test-id/audio-1.webm`,
  );
  expect(data[9].body).toContain("@\u200dteam");
  expect(data[9].body).not.toContain("@team");
  expect(data[9].body).not.toContain("<script>");
  expect(data[9].body).not.toContain("![image]");
  expect(data[9].body).toContain("&lt;/details&gt;");
  expect(data[9].body).toContain("The suite is easy to use");
  expect(data[9].body).toMatch(/<\/details>\n\nFull record:.*submission.json/);
});
it("uploads a base64 Git blob, signs its receipt and reads private repository metadata once", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(Response.json({ sha }));
  const store = createGithubStore(env, transport);
  const uploaded = await store.upload(
    {
      bytes: new Uint8Array([1, 2]),
      ext: "webm",
      type: "audio/webm",
    },
    submissionId,
  );
  expect(verifyReceipts([uploaded], submissionId, env)).toEqual([uploaded]);
  expect(bodies(transport)[1]).toEqual({ content: "AQI=", encoding: "base64" });
  // Subsequent save uses cached metadata and the audio SHA without uploading it again.
  transport
    .mockResolvedValueOnce(Response.json({ sha: head }))
    .mockResolvedValueOnce(Response.json({ sha: baseTree }));
  commitResponses(transport);
  transport.mockResolvedValueOnce(Response.json({ number: 1 }));
  await store.save(submission, [uploaded]);
  expect(
    transport.mock.calls.filter(([url]) => String(url).endsWith("/private/feedback")),
  ).toHaveLength(1);
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith("/git/blobs"))).toHaveLength(
    3,
  );
});
it("retries a competing branch update with a fresh head and tree, reusing blobs", async () => {
  const transport = vi.fn<typeof fetch>();
  const pause = vi.fn().mockResolvedValue(undefined);
  initial(transport);
  commitResponses(transport, true);
  commitResponses(transport, false, "e".repeat(40), "f".repeat(40));
  transport.mockResolvedValueOnce(Response.json({ number: 2 }));
  await expect(
    createGithubStore(env, transport, undefined, undefined, pause).save(submission, [receipt]),
  ).resolves.toEqual({ reference: 2 });
  const data = bodies(transport);
  expect(data[10].base_tree).toBe("f".repeat(40));
  expect(data[11].parents).toEqual(["e".repeat(40)]);
  expect(pause).toHaveBeenCalledWith(expect.any(Number));
  expect(transport.mock.calls.filter(([url]) => String(url).endsWith("/git/blobs"))).toHaveLength(
    2,
  );
  expect(transport.mock.calls.at(-1)?.[0]).toContain("/issues");
});
it.each(["commit", "conflict", "ref"])("never opens an issue if the %s fails", async (kind) => {
  const transport = vi.fn<typeof fetch>();
  initial(transport);
  if (kind === "conflict") for (let i = 0; i < 6; i++) commitResponses(transport, true);
  else {
    transport.mockResolvedValueOnce(Response.json({ object: { sha: head } }));
    transport.mockResolvedValueOnce(Response.json({ tree: { sha: baseTree } }));
    transport.mockResolvedValueOnce(Response.json({ sha: treeSha }));
    if (kind === "ref") transport.mockResolvedValueOnce(Response.json({ sha }));
    transport.mockResolvedValueOnce(new Response("secret-token private/feedback", { status: 500 }));
  }
  const pause = vi.fn().mockResolvedValue(undefined);
  await expect(
    createGithubStore(env, transport, undefined, undefined, pause).save(submission, [receipt]),
  ).rejects.toThrow("couldn't finish saving");
  expect(transport.mock.calls.some(([url]) => String(url).endsWith("/issues"))).toBe(false);
  expect(pause).toHaveBeenCalledTimes(kind === "conflict" ? 5 : 0);
});
it("refuses missing config or a public repository before any writes", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ private: false }));
  await expect(createGithubStore({}, transport).save(submission, [])).rejects.toMatchObject({
    status: 503,
  });
  expect(transport).not.toHaveBeenCalled();
  await expect(createGithubStore(env, transport).save(submission, [])).rejects.toMatchObject({
    status: 503,
  });
  expect(transport).toHaveBeenCalledTimes(1);
});
it("bounds long issue answers and transcript before closing details and appending the record link", () => {
  const large = {
    ...submission,
    answers: Object.fromEntries(
      Object.keys(submission.answers).map((id) => [id, "@<\n".repeat(4000)]),
    ),
    transcript: Array(160).fill({ role: "user", content: "@<\n".repeat(4000) }),
  };
  const md = renderMarkdown(large, [], {
    maxLength: 59_000,
    recordUrl: "https://example.test/submission.json",
  });
  expect(md.length).toBeLessThan(60_000);
  expect(md.match(/<details>/g)).toHaveLength(1);
  expect(md.match(/<\/details>/g)).toHaveLength(1);
  expect(md).toMatch(/<\/details>\n\nFull record:.*submission.json/);
  expect(plainTitle("@team\u0000 \t [idea]  \n Fix it")).toBe("@\u200dteam [idea] Fix it");
  expect(plainTitle("one\nsecond\u202e")).toBe("one second");
  expect(plainTitle("*idea* [test]")).toBe("*idea* [test]");
  expect(plainTitle("x".repeat(100))).toHaveLength(80);
});
it("downloads JSON, Markdown and all audio in one archive", async () => {
  const zip = unzipSync(
    await feedbackArchive(submission, [
      { blob: new Blob(["voice"], { type: "audio/mp4" }), text: "" },
    ]),
  );
  expect(Object.keys(zip)).toEqual(["submission.json", "feedback.md", "audio-1.m4a"]);
  expect(JSON.parse(new TextDecoder().decode(zip["submission.json"]))).toEqual(submission);
  expect(new TextDecoder().decode(zip["audio-1.m4a"])).toBe("voice");
  const md = renderMarkdown(submission);
  expect(md).toContain("## Values and ladders");
  expect(md).toContain("## Jobs to be done");
  expect(md).toContain("<details>");
});

afterEach(() => vi.useRealTimers());
it("stops on a low GitHub budget and shares the reset cooldown across fresh stores", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  vi.resetModules();
  const { createGithubStore: freshStore } = await import("../src/feedback/store");
  const reset = Date.now() / 1000 + 120;
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(
      Response.json(
        { sha: head },
        {
          headers: {
            "x-ratelimit-remaining": "49",
            "x-ratelimit-reset": String(reset),
          },
        },
      ),
    );
  await expect(freshStore(env, transport).save(submission, [])).rejects.toMatchObject({
    status: 503,
    message: expect.stringContaining("try again later"),
    retryAfter: 120,
  });
  const audio = { bytes: new Uint8Array([1, 2]), ext: "webm" as const, type: "audio/webm" };
  await expect(freshStore(env, transport).upload(audio, submissionId)).rejects.toMatchObject({
    status: 503,
  });
  expect(transport).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(120_000);
  transport
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(Response.json({ sha }));
  await expect(freshStore(env, transport).upload(audio, submissionId)).resolves.toMatchObject({
    sha,
  });
  expect(transport).toHaveBeenCalledTimes(4);
});
it.each([
  { status: 403, headers: { "retry-after": "90" }, wait: 90 },
  { status: 429, headers: { "retry-after": "90" }, wait: 90 },
  { status: 403, headers: {}, wait: 60 },
])("stops immediately for a secondary limit ($status, $wait seconds), without retrying", async ({
  status,
  headers,
  wait,
}) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
  vi.resetModules();
  const { createGithubStore: freshStore } = await import("../src/feedback/store");
  const transport = vi.fn<typeof fetch>();
  const pause = vi.fn();
  initial(transport);
  commitResponses(transport);
  transport.mockResolvedValueOnce(
    Response.json(
      { message: "You have exceeded a secondary rate limit." },
      {
        status,
        headers: { ...headers, "x-ratelimit-remaining": "4000" },
      },
    ),
  );
  const store = freshStore(env, transport, undefined, undefined, pause);
  await expect(store.save(submission, [])).rejects.toMatchObject({ status: 503, retryAfter: wait });
  await expect(freshStore(env, transport).save(submission, [])).rejects.toMatchObject({
    status: 503,
  });
  expect(transport).toHaveBeenCalledTimes(9);
  expect(pause).not.toHaveBeenCalled();
  vi.advanceTimersByTime(wait * 1000);
  initial(transport);
  commitResponses(transport);
  transport.mockResolvedValueOnce(Response.json({ number: 14 }));
  await expect(freshStore(env, transport).save(submission, [])).resolves.toEqual({ reference: 14 });
});
