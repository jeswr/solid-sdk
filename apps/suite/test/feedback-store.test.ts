// AUTHORED-BY Codex GPT-6.1-Sol
import { unzipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { feedbackArchive } from "../src/feedback/download";
import { renderMarkdown } from "../src/feedback/markdown";
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
it("stores audio and JSON serially, checks privacy, links immutable blobs, escapes Markdown and retries labels", async () => {
  const transport = vi.fn<typeof fetch>();
  transport.mockResolvedValueOnce(Response.json({ private: true }));
  transport.mockResolvedValueOnce(Response.json({ commit: { sha } }));
  transport.mockResolvedValueOnce(Response.json({ commit: { sha } }));
  transport.mockResolvedValueOnce(new Response("label absent", { status: 422 }));
  transport.mockResolvedValueOnce(Response.json({ number: 12 }));
  const store = createGithubStore(
    env,
    transport,
    () => new Date("2026-11-11T12:00:00Z"),
    () => "test-id",
  );
  expect(
    await store.save(submission, [
      { bytes: new Uint8Array([1, 2]), ext: "webm", type: "audio/webm" },
    ]),
  ).toEqual({ reference: 12 });
  expect(transport.mock.calls.map(([url, options]) => [String(url), options?.method])).toEqual([
    ["https://api.github.com/repos/private/feedback", "GET"],
    [
      "https://api.github.com/repos/private/feedback/contents/feedback/2026-11-11/test-id/audio-1.webm",
      "PUT",
    ],
    [
      "https://api.github.com/repos/private/feedback/contents/feedback/2026-11-11/test-id/submission.json",
      "PUT",
    ],
    ["https://api.github.com/repos/private/feedback/issues", "POST"],
    ["https://api.github.com/repos/private/feedback/issues", "POST"],
  ]);
  const bodies = transport.mock.calls.map(([, o]) => (o?.body ? JSON.parse(String(o.body)) : {}));
  expect(Buffer.from(bodies[1].content, "base64")).toEqual(Buffer.from([1, 2]));
  const record = JSON.parse(Buffer.from(bodies[2].content, "base64").toString());
  expect(record.transcript).toEqual(submission.transcript);
  expect(bodies[3].labels).toEqual(["feedback", "pathway:guided", "app:drive"]);
  expect(bodies[4]).not.toHaveProperty("labels");
  expect(bodies[4].title.length).toBeLessThanOrEqual(80);
  expect(bodies[4].title).not.toContain("second line");
  expect(bodies[4].body).toContain(
    `https://github.com/private/feedback/blob/${sha}/feedback/2026-11-11/test-id/audio-1.webm`,
  );
  expect(bodies[4].body).toContain("@\u200dteam");
  expect(bodies[4].body).not.toContain("@team");
  expect(bodies[4].body).not.toContain("<script>");
  expect(bodies[4].body).not.toContain("![image]");
  expect(bodies[4].body).toContain("&lt;/details&gt;");
  expect(bodies[4].body).toContain("The suite is easy to use");
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
it("does not expose upstream errors, repo URLs or credentials", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ private: true }))
    .mockResolvedValueOnce(new Response("secret-token private/feedback", { status: 500 }));
  await expect(createGithubStore(env, transport).save(submission, [])).rejects.toThrow(
    "couldn't finish saving",
  );
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
