// AUTHORED-BY Codex GPT-6.1-Sol
import { questions } from "./guide";
import type { Submission } from "./validation";

/** Neutralise mentions, HTML, links and Markdown structure from participant text. */
export function escapeMarkdown(value: unknown): string {
  const plain = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  return plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, "@\u200d")
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, "\\$&")
    .replace(/\r?\n/g, "<br>\n");
}
export function renderMarkdown(s: Submission, audio: string[] = []): string {
  const a = s.answers;
  const section = (title: string, ids: string[]) =>
    `## ${title}\n\n${ids
      .filter((id) => a[id] !== undefined)
      .map(
        (id) =>
          `**${escapeMarkdown(questions.find((q) => q.id === id)?.text ?? id)}**\n\n${escapeMarkdown(a[id])}`,
      )
      .join("\n\n")}`;
  const ratingIds = Object.keys(a).filter(
    (id) =>
      /^seq_(?!reason_)/.test(id) || ["umux_capabilities", "umux_ease", "likelihood"].includes(id),
  );
  return [
    `# ${s.pathway === "guided" ? "Guided interview" : "Quick note"}`,
    `## Read-back\n\n${escapeMarkdown(a.summary ?? "Submitted before read-back.")}\n\nConfirmed: ${a.confirmed === "yes" ? "yes" : "no"}`,
    `Apps tried: ${escapeMarkdown(a.apps)}`,
    `## Ratings\n\n| Measure | Rating |\n| --- | --- |\n${ratingIds.map((id) => `| ${escapeMarkdown(questions.find((q) => q.id === id)?.text ?? id)} | ${escapeMarkdown(a[id])} |`).join("\n")}`,
    section("Values and ladders", [
      "values_control",
      "values_permissions",
      "values_stakeholders",
      "values_tradeoff",
      "values_ladders",
    ]),
    section("Critical incidents", ["incident_best", "incident_stuck"]),
    section("Jobs to be done", ["jobs_use", "jobs_replace", "jobs_hesitate"]),
    section("One change", ["one_change"]),
    section(
      "Context, task recall and comments",
      Object.keys(a).filter(
        (id) =>
          /^(context_|recall_|seq_reason_)/.test(id) || ["pod", "general", "comments"].includes(id),
      ),
    ),
    `## Contact\n\n${escapeMarkdown(s.contact.name || "Anonymous")} ${escapeMarkdown(s.contact.email)}`,
    `## Client\n\nVersion: ${escapeMarkdown(s.metadata.version)}\n\nCommit: ${escapeMarkdown(s.metadata.commit)}\n\nUser agent: ${escapeMarkdown(s.metadata.userAgent)}\n\nWalkthrough: ${escapeMarkdown(s.metadata.walkthrough)}`,
    `## Recordings\n\n${audio.map((url, i) => `- [Audio ${i + 1}](${url})`).join("\n")}`,
    `<details>\n<summary>Full transcript</summary>\n\n${s.transcript.map((m) => `**${m.role}**: ${escapeMarkdown(m.content)}${m.audio?.length ? ` (audio ${m.audio.map((i) => i + 1).join(", ")})` : ""}`).join("\n\n")}\n\n</details>`,
  ].join("\n\n");
}
