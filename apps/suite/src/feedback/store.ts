// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash, randomUUID } from "node:crypto";
import type { AudioFile } from "./audio";
import { plainTitle, renderMarkdown } from "./markdown";
import { type AudioReceipt, signReceipt, submissionIdSchema } from "./receipts";
import { type FeedbackEnv, FeedbackError, githubBackoff } from "./security";
import type { Submission } from "./validation";

export interface FeedbackStore {
  upload(audio: AudioFile, submissionId: string): Promise<AudioReceipt>;
  save(
    submission: Submission,
    audio: AudioReceipt[],
    submissionId: string,
  ): Promise<{ reference: number }>;
}
const failure = () =>
  new FeedbackError(
    502,
    "We couldn't finish saving your feedback. Download a copy before trying again.",
  );
// Coordinate overlapping requests even when each handler constructs a fresh store.
const creatingIssues = new Set<string>();
const checkedSha = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{40,64}$/.test(value)) throw failure();
  return value;
};
export function createGithubStore(
  env: FeedbackEnv,
  transport: typeof fetch = fetch,
  now = () => new Date(),
  pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): FeedbackStore {
  const token = env.FEEDBACK_GITHUB_TOKEN?.trim();
  const repo = env.FEEDBACK_GITHUB_REPO?.trim();
  const base = `https://api.github.com/repos/${repo}`;
  const call = async (
    path: string,
    method: string,
    body?: unknown,
    options: { api?: string; signal?: AbortSignal } = {},
  ) => {
    const response = await transport(`${options.api ?? base}${path}`, {
      method,
      redirect: "error",
      signal: options.signal ?? AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    await githubBackoff.observe(response);
    return response;
  };
  const read = async (path: string, method = "GET", body?: unknown) => {
    const response = await call(path, method, body);
    if (!response.ok) throw failure();
    return response.json();
  };
  let repository: Promise<{ branch: string }> | undefined;
  const metadata = () => {
    if (!token || !repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
      throw new FeedbackError(
        503,
        "Feedback storage isn't switched on yet. Download your feedback to keep it.",
      );
    repository ??= (async () => {
      const response = await call("", "GET");
      const data = response.ok ? await response.json() : {};
      if (data.private !== true || typeof data.default_branch !== "string" || !data.default_branch)
        throw new FeedbackError(
          503,
          "Private feedback storage is unavailable. Download your feedback to keep it.",
        );
      return { branch: data.default_branch as string };
    })().catch((error) => {
      repository = undefined;
      throw error;
    });
    return repository;
  };
  const blob = async (bytes: Uint8Array) =>
    checkedSha(
      (
        await read("/git/blobs", "POST", {
          content: Buffer.from(bytes).toString("base64"),
          encoding: "base64",
        })
      ).sha,
    );
  const textBlob = (text: string) => blob(new TextEncoder().encode(text));
  return {
    async upload(audio, submissionId) {
      githubBackoff.check();
      await metadata();
      githubBackoff.check();
      const sha = await blob(audio.bytes);
      return signReceipt(
        { submissionId, sha, size: audio.bytes.length, ext: audio.ext },
        env,
        now().getTime(),
      );
    },
    async save(submission, audio, submissionId) {
      githubBackoff.check();
      const id = submissionIdSchema.parse(submissionId).toLowerCase();
      // Identical requests must propose distinct commits: updating a ref to its
      // current SHA is also successful and cannot act as an exclusive claim.
      const writer = randomUUID();
      const { branch } = await metadata();
      githubBackoff.check();
      const directory = `feedback/${now().toISOString().slice(0, 10)}/${id}`;
      const audioNames = audio.map((clip, i) => `audio-${i + 1}.${clip.ext}`);
      const attachments = audio.map(({ sha, size, ext }, i) => ({
        path: audioNames[i],
        sha,
        size,
        ext,
      }));
      // Receipt signatures can be renewed; identity depends on the record and blobs.
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({ submission, audio: attachments }, (_key, value) =>
            value && typeof value === "object" && !Array.isArray(value)
              ? Object.fromEntries(
                  Object.keys(value)
                    .sort()
                    .map((key) => [key, value[key]]),
                )
              : value,
          ),
        )
        .digest("hex");
      const indexPath = `feedback/submissions/${id}.json`;
      const marker = `<!-- feedback-submission:${id} -->`;
      const recordText = JSON.stringify(
        {
          ...submission,
          id,
          createdAt: now().toISOString(),
          audio: attachments,
        },
        null,
        2,
      );
      const makeTree = async () => {
        const recordSha = await textBlob(recordText);
        const summarySha = await textBlob(renderMarkdown(submission, audioNames));
        const indexSha = await textBlob(JSON.stringify({ fingerprint, directory }));
        return [
          ...audio.map((clip, i) => ({ path: `${directory}/${audioNames[i]}`, sha: clip.sha })),
          { path: `${directory}/submission.json`, sha: recordSha },
          { path: `${directory}/summary.md`, sha: summarySha },
          { path: indexPath, sha: indexSha },
        ].map((entry) => ({ ...entry, mode: "100644", type: "blob" }));
      };
      const finishIssue = async (commitSha: string, recordDirectory: string, recover = false) => {
        const key = `${repo}:${id}`;
        if (creatingIssues.has(key))
          throw new FeedbackError(
            503,
            "Your feedback was saved and its reference is being created. Please try again later, or download your feedback.",
            60,
          );
        creatingIssues.add(key);
        try {
          // Search and both possible POSTs share one completion deadline.
          const options = { signal: AbortSignal.timeout(30_000) };
          if (recover) {
            githubBackoff.check("search");
            // One bounded search includes closed issues and excludes pull requests.
            const query = new URLSearchParams({
              q: `repo:${repo} is:issue in:body "feedback-submission:${id}"`,
              per_page: "1",
            });
            const response = await call(`/search/issues?${query}`, "GET", undefined, {
              ...options,
              api: "https://api.github.com",
            });
            if (!response.ok) throw failure();
            const result = await response.json();
            if (result.incomplete_results !== false || !Array.isArray(result.items))
              throw failure();
            const issue = result.items.find(
              (candidate: { pull_request?: unknown; body?: unknown; number?: unknown }) =>
                !candidate.pull_request &&
                typeof candidate.body === "string" &&
                candidate.body.endsWith(marker) &&
                Number.isSafeInteger(candidate.number) &&
                Number(candidate.number) > 0,
            );
            if (issue) return { reference: issue.number as number };
            if (result.items.length) throw failure();
          }
          const url = (name: string) =>
            `https://github.com/${repo}/blob/${commitSha}/${recordDirectory}/${name}`;
          const first = String(
            submission.answers.summary ?? submission.answers.general ?? "Pilot feedback",
          );
          const title = plainTitle(`${submission.pathway}: ${first}`);
          const body = `${renderMarkdown(submission, audioNames.map(url), {
            maxLength: 59_000,
            recordUrl: url("submission.json"),
          })}\n\n${marker}`;
          const labels = [
            "feedback",
            `pathway:${submission.pathway}`,
            ...(Array.isArray(submission.answers.apps)
              ? submission.answers.apps.map((slug) => `app:${slug}`)
              : []),
          ];
          let issue = await call("/issues", "POST", { title, body, labels }, options);
          if (issue.status === 422) issue = await call("/issues", "POST", { title, body }, options);
          if (!issue.ok)
            throw new FeedbackError(
              502,
              "The recordings were saved but we couldn't create a reference. Download a copy before trying again.",
            );
          const reference: unknown = (await issue.json()).number;
          if (!Number.isSafeInteger(reference) || (reference as number) < 1)
            throw new FeedbackError(502, "We couldn't confirm your reference. Download a copy.");
          return { reference: reference as number };
        } finally {
          creatingIssues.delete(key);
        }
      };
      let tree: Awaited<ReturnType<typeof makeTree>> | undefined;
      const ref = `heads/${branch.split("/").map(encodeURIComponent).join("/")}`;
      let commitSha = "";
      // A losing writer rebuilds on the new head; blobs stay immutable and are reused.
      for (let attempt = 0; attempt <= 5; attempt++) {
        const head = checkedSha((await read(`/git/ref/${ref}`)).object?.sha);
        if (!tree) githubBackoff.check();
        const existing = await call(`/contents/${indexPath}?ref=${head}`, "GET");
        if (existing.ok) {
          const data = await existing.json();
          if (data.encoding !== "base64" || typeof data.content !== "string") throw failure();
          const saved = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
          if (saved.fingerprint !== fingerprint)
            throw new FeedbackError(
              409,
              "This submission ID has already been used for different feedback. Download your feedback to keep it.",
            );
          if (
            typeof saved.directory !== "string" ||
            saved.directory !== `feedback/${saved.directory.split("/")[1]}/${id}` ||
            !/^feedback\/\d{4}-\d{2}-\d{2}\//.test(saved.directory)
          )
            throw failure();
          return finishIssue(head, saved.directory, true);
        }
        if (existing.status !== 404) throw failure();
        const baseTree = checkedSha((await read(`/git/commits/${head}`)).tree?.sha);
        // The index and record enter the branch together. Every competing writer
        // checks the index again after a failed fast-forward, before opening an issue.
        if (!tree) {
          // Admit once, before the first write. A low successful response must
          // never interrupt this submission after its record has been committed.
          githubBackoff.check();
          tree = await makeTree();
        }
        const nextTree = checkedSha(
          (await read("/git/trees", "POST", { base_tree: baseTree, tree })).sha,
        );
        const commit = checkedSha(
          (
            await read("/git/commits", "POST", {
              message: `Store pilot feedback ${id}\n\nFeedback-Writer: ${writer}`,
              tree: nextTree,
              parents: [head],
            })
          ).sha,
        );
        const update = await call(`/git/refs/${ref}`, "PATCH", { sha: commit, force: false });
        if (update.ok) {
          commitSha = commit;
          break;
        }
        const error = await update.json().catch(() => ({}));
        if (
          update.status !== 422 ||
          !/not (?:a )?fast forward/i.test(error.message ?? "") ||
          attempt === 5
        )
          throw failure();
        await pause(100 * 2 ** attempt + Math.floor(Math.random() * 150));
      }
      if (!commitSha) throw failure();
      return finishIssue(commitSha, directory);
    },
  };
}
