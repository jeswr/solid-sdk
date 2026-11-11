// AUTHORED-BY Codex GPT-6.1-Sol
import { randomUUID } from "node:crypto";
import type { AudioFile } from "./audio";
import { escapeMarkdown, renderMarkdown } from "./markdown";
import { type FeedbackEnv, FeedbackError } from "./security";
import type { Submission } from "./validation";

export interface FeedbackStore {
  save(submission: Submission, audio: AudioFile[]): Promise<{ reference: number }>;
}
export function createGithubStore(
  env: FeedbackEnv,
  transport: typeof fetch = fetch,
  now = () => new Date(),
  uuid: () => string = randomUUID,
): FeedbackStore {
  return {
    async save(submission, audio) {
      const token = env.FEEDBACK_GITHUB_TOKEN?.trim();
      const repo = env.FEEDBACK_GITHUB_REPO?.trim();
      if (!token || !repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
        throw new FeedbackError(
          503,
          "Feedback storage isn't switched on yet. Download your feedback to keep it.",
        );
      const base = `https://api.github.com/repos/${repo}`;
      const call = (url: string, method: string, body?: unknown) =>
        transport(url, {
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
      const repoResponse = await call(base, "GET");
      if (!repoResponse.ok || (await repoResponse.json()).private !== true)
        throw new FeedbackError(
          503,
          "Private feedback storage is unavailable. Download your feedback to keep it.",
        );
      const id = uuid();
      const directory = `feedback/${now().toISOString().slice(0, 10)}/${id}`;
      const put = async (path: string, bytes: Uint8Array) => {
        const response = await call(`${base}/contents/${path}`, "PUT", {
          message: `Store pilot feedback ${id}`,
          content: Buffer.from(bytes).toString("base64"),
        });
        if (!response.ok)
          throw new FeedbackError(
            502,
            "We couldn't finish saving your feedback. Download a copy before trying again.",
          );
        const result = await response.json();
        const sha: unknown = result.commit?.sha;
        if (typeof sha !== "string" || !/^[a-f0-9]{40,64}$/.test(sha))
          throw new FeedbackError(502, "We couldn't confirm the saved feedback. Download a copy.");
        return `https://github.com/${repo}/blob/${sha}/${path}`;
      };
      const links: string[] = [];
      // Contents API updates to one branch must be serialised.
      for (const [i, clip] of audio.entries())
        links.push(await put(`${directory}/audio-${i + 1}.${clip.ext}`, clip.bytes));
      const recordUrl = await put(
        `${directory}/submission.json`,
        new TextEncoder().encode(
          JSON.stringify(
            { ...submission, id, createdAt: now().toISOString(), audio: links },
            null,
            2,
          ),
        ),
      );
      const first = String(
        submission.answers.summary ?? submission.answers.general ?? "Pilot feedback",
      ).split(/\r?\n/)[0];
      const title = `${submission.pathway}: ${escapeMarkdown(first).replace(/<br>/g, " ")}`.slice(
        0,
        80,
      );
      // Stay below GitHub's issue body limit while keeping the complete transcript in submission.json.
      const markdown = renderMarkdown(submission, links);
      const body =
        markdown.length <= 60000
          ? markdown
          : `${markdown.slice(0, 58000)}\n\nFull record: [submission.json](${recordUrl}) (transcript exceeds issue limit).`;
      const labels = [
        "feedback",
        `pathway:${submission.pathway}`,
        ...(Array.isArray(submission.answers.apps)
          ? submission.answers.apps.map((slug) => `app:${slug}`)
          : []),
      ];
      let issue = await call(`${base}/issues`, "POST", { title, body, labels });
      if (issue.status === 422) issue = await call(`${base}/issues`, "POST", { title, body });
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
