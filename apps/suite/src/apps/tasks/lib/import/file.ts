// AUTHORED-BY Codex GPT-6.1-Sol
import { type ProjectImportDraft, parseGoogleTasksJson } from "../google-tasks";
import { parseTodoistCsv } from "../todoist";

/** Content wins over metadata; metadata still routes malformed files to a useful parser error. */
export function parseTaskImport(
  text: string,
  file: { name: string; type: string; timeZone: string },
): { kind: "google" | "todoist"; projects: readonly (ProjectImportDraft & { name: string })[] } {
  const content = text.trimStart();
  const type = file.type.toLowerCase().replace(/;.*/, "").trim();
  const json = /^[{[]/.test(content);
  const csv = !json && /^[^\r\n]*,/.test(content);
  if (json || (!csv && (/\.json$/i.test(file.name) || type === "application/json"))) {
    return { kind: "google", projects: parseGoogleTasksJson(text).projects };
  }
  if (csv || /\.csv$/i.test(file.name) || type === "text/csv") {
    return {
      kind: "todoist",
      projects: [
        {
          ...parseTodoistCsv(text, { defaultTimeZone: file.timeZone }),
          name: file.name.replace(/\.csv$/i, ""),
        },
      ],
    };
  }
  throw new TypeError("Unsupported task import file");
}
