// AUTHORED-BY Codex GPT-6.1-Sol
import { randomUUID } from "node:crypto";
import type { AudioFile } from "./audio";
import { plainTitle, renderMarkdown } from "./markdown";
import { type AudioReceipt, signReceipt } from "./receipts";
import { type FeedbackEnv, FeedbackError, githubBackoff } from "./security";
import type { Submission } from "./validation";

export interface FeedbackStore {
  upload(audio: AudioFile, submissionId: string): Promise<AudioReceipt>;
  save(submission: Submission, audio: AudioReceipt[]): Promise<{ reference: number }>;
}
const failure = () =>
  new FeedbackError(
    502,
    "We couldn't finish saving your feedback. Download a copy before trying again.",
  );
const checkedSha = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{40,64}$/.test(value)) throw failure();
  return value;
};
export function createGithubStore(
  env: FeedbackEnv,
  transport: typeof fetch = fetch,
  now = () => new Date(),
  uuid: () => string = randomUUID,
  pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): FeedbackStore {
  const token = env.FEEDBACK_GITHUB_TOKEN?.trim();
  const repo = env.FEEDBACK_GITHUB_REPO?.trim();
  const base = `https://api.github.com/repos/${repo}`;
  const call = async (path: string, method: string, body?: unknown) => {
    githubBackoff.check();
    const response = await transport(`${base}${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
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
      await metadata();
      const sha = await blob(audio.bytes);
      return signReceipt(
        { submissionId, sha, size: audio.bytes.length, ext: audio.ext },
        env,
        now().getTime(),
      );
    },
    async save(submission, audio) {
      const { branch } = await metadata();
      const id = uuid();
      const directory = `feedback/${now().toISOString().slice(0, 10)}/${id}`;
      const audioNames = audio.map((clip, i) => `audio-${i + 1}.${clip.ext}`);
      const recordSha = await textBlob(
        JSON.stringify(
          {
            ...submission,
            id,
            createdAt: now().toISOString(),
            audio: audio.map(({ sha, size, ext }, i) => ({ path: audioNames[i], sha, size, ext })),
          },
          null,
          2,
        ),
      );
      const summarySha = await textBlob(renderMarkdown(submission, audioNames));
      const tree = [
        ...audio.map((clip, i) => ({ path: `${directory}/${audioNames[i]}`, sha: clip.sha })),
        { path: `${directory}/submission.json`, sha: recordSha },
        { path: `${directory}/summary.md`, sha: summarySha },
      ].map((entry) => ({ ...entry, mode: "100644", type: "blob" }));
      const ref = `heads/${branch.split("/").map(encodeURIComponent).join("/")}`;
      let commitSha = "";
      // A losing writer rebuilds on the new head; blobs stay immutable and are reused.
      for (let attempt = 0; attempt <= 5; attempt++) {
        const head = checkedSha((await read(`/git/ref/${ref}`)).object?.sha);
        const baseTree = checkedSha((await read(`/git/commits/${head}`)).tree?.sha);
        const nextTree = checkedSha(
          (await read("/git/trees", "POST", { base_tree: baseTree, tree })).sha,
        );
        const commit = checkedSha(
          (
            await read("/git/commits", "POST", {
              message: `Store pilot feedback ${id}`,
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
      const url = (name: string) =>
        `https://github.com/${repo}/blob/${commitSha}/${directory}/${name}`;
      const first = String(
        submission.answers.summary ?? submission.answers.general ?? "Pilot feedback",
      );
      const title = plainTitle(`${submission.pathway}: ${first}`);
      const body = renderMarkdown(submission, audioNames.map(url), {
        maxLength: 59_000,
        recordUrl: url("submission.json"),
      });
      const labels = [
        "feedback",
        `pathway:${submission.pathway}`,
        ...(Array.isArray(submission.answers.apps)
          ? submission.answers.apps.map((slug) => `app:${slug}`)
          : []),
      ];
      let issue = await call("/issues", "POST", { title, body, labels });
      if (issue.status === 422) issue = await call("/issues", "POST", { title, body });
      if (!issue.ok)
        throw new FeedbackError(
          502,
          "The recordings were saved but we couldn't create a reference. Download a copy before trying again.",
        );
      const reference: unknown = (await issue.json()).number;
      if (!Number.isSafeInteger(reference) || (reference as number) < 1)
        throw new FeedbackError(502, "We couldn't confirm your reference. Download a copy.");
      return { reference: reference as number };
    },
  };
}
