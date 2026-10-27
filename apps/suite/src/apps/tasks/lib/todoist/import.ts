// AUTHORED-BY Codex GPT-6.1-Sol
import { splitContent } from "./content";
import { checkSize, scanCsv } from "./csv";
import { parseDue, zoneFormatter } from "./dates";
import {
  TodoistImportError,
  type TodoistImportOptions,
  type TodoistProjectDraft,
  type TodoistSectionDraft,
  type TodoistTaskDraft,
  type TodoistWarning,
} from "./model";

const supportedColumns = new Set([
  "TYPE",
  "CONTENT",
  "DESCRIPTION",
  "PRIORITY",
  "INDENT",
  "AUTHOR",
  "RESPONSIBLE",
  "DATE",
  "DATE_LANG",
  "TIMEZONE",
  "DURATION",
  "DURATION_UNIT",
]);
// Native Intl formatters are expensive; input row/byte limits do not bound them practically.
const MAX_CACHED_FORMATTERS = 32;

/** Parse a bounded Todoist template into local drafts, with no IO or identity resolution. */
export function parseTodoistCsv(input: string, options: TodoistImportOptions): TodoistProjectDraft {
  checkSize(input);
  scanCsv(input);
  // Validate options only after all input limits; never consult the host's default zone.
  const defaultZone = options?.defaultTimeZone;
  const formats = new Map<string, Intl.DateTimeFormat>();
  formatterFor(defaultZone, 1);
  const sections: TodoistSectionDraft[] = [];
  const tasks: TodoistTaskDraft[] = [];
  const warnings: TodoistWarning[] = [];
  let headers: string[] | undefined;
  let columns: Map<string, number>;
  let sectionId: string | null = null;
  const parents: string[] = [];
  let orderKey = -1;
  scanCsv(input, (cells, line) => {
    if (!headers) {
      headers = cells;
      columns = new Map();
      headers.forEach((name, index) => {
        if (!supportedColumns.has(name)) return;
        if (columns.has(name)) throw new TodoistImportError("INVALID_CSV", line);
        columns.set(name, index);
      });
      if (!columns.has("TYPE") || !columns.has("CONTENT"))
        throw new TodoistImportError("INVALID_CSV", line);
      return;
    }
    orderKey++;
    if (cells.length !== headers.length) throw new TodoistImportError("INVALID_CSV", line);
    const get = (name: string) => cells[columns.get(name) ?? -1] ?? "";
    const type = get("TYPE");
    if (type !== "section" && type !== "task" && type !== "note") {
      warnings.push({ code: "UNKNOWN_TYPE", line });
      return;
    }
    if (type === "note") {
      const previous = tasks.at(-1);
      if (!previous) warnings.push({ code: "ORPHAN_NOTE", line });
      else
        previous.comments.push({
          content: get("CONTENT"),
          description: get("DESCRIPTION"),
          author: get("AUTHOR"),
          line,
        });
      return;
    }
    if (type === "section") {
      const title = get("CONTENT").trim();
      if (!title) throw new TodoistImportError("INVALID_CSV", line);
      sectionId = `section-${orderKey}`;
      sections.push({ id: sectionId, title, description: get("DESCRIPTION"), orderKey, line });
      parents.length = 0;
      return;
    }
    const { title, labels } = splitContent(get("CONTENT"));
    if (!title) throw new TodoistImportError("INVALID_CSV", line);
    const indentText = get("INDENT");
    const indent = indentText === "" ? 1 : Number(indentText);
    if (!["", "1", "2", "3", "4"].includes(indentText) || indent > parents.length + 1)
      throw new TodoistImportError("INVALID_INDENT", line);
    const priorityText = get("PRIORITY");
    if (!["", "1", "2", "3", "4"].includes(priorityText))
      throw new TodoistImportError("INVALID_PRIORITY", line);
    const priority = priorityText === "" ? 4 : (Number(priorityText) as 1 | 2 | 3 | 4);
    const task: TodoistTaskDraft = {
      id: `task-${orderKey}`,
      title,
      labels,
      description: get("DESCRIPTION"),
      priority,
      indent,
      parentId: parents[indent - 2] ?? null,
      sectionId,
      orderKey,
      line,
      author: get("AUTHOR"),
      responsible: get("RESPONSIBLE"),
      dateLang: get("DATE_LANG"),
      comments: [],
      ...duration(get("DURATION"), get("DURATION_UNIT"), line),
      ...deadline(get("DATE"), get("TIMEZONE") || defaultZone, line),
    };
    tasks.push(task);
    parents.length = indent;
    parents[indent - 1] = task.id;
  });
  if (!headers) throw new TodoistImportError("INVALID_CSV", 1);
  return { sections, tasks, warnings };

  function formatterFor(zone: string, line: number): Intl.DateTimeFormat {
    // Invalid runtime option types must still reach the typed timezone validator.
    const key = typeof zone === "string" ? zone.toLowerCase() : zone;
    let format = formats.get(key);
    if (!format) {
      if (formats.size >= MAX_CACHED_FORMATTERS)
        formats.delete(formats.keys().next().value as string);
      format = zoneFormatter(zone, line);
      formats.set(key, format);
    }
    return format;
  }

  function deadline(
    value: string,
    zone: string,
    line: number,
  ): Pick<TodoistTaskDraft, "due" | "dueText"> {
    const format = formatterFor(zone, line);
    if (value === "") return {};
    const due = parseDue(value, zone, format, line);
    if (due) return { due };
    warnings.push({ code: "UNPARSED_DATE", line });
    return { dueText: value };
  }
}

function duration(amount: string, unit: string, line: number): Pick<TodoistTaskDraft, "duration"> {
  if (amount === "" && (unit === "" || unit === "None")) return {};
  const value = Number(amount);
  if (
    /^\d+(?:\.\d+)?$/.exec(amount)?.[0] !== amount ||
    !Number.isFinite(value) ||
    value <= 0 ||
    (unit !== "minute" && unit !== "day")
  )
    throw new TodoistImportError("INVALID_DURATION", line);
  // Reject decimal precision loss rather than silently rounding a template value.
  let canonical = amount.replace(/^0+(?=\d)/, "");
  if (canonical.includes(".")) {
    let end = canonical.length;
    while (canonical[end - 1] === "0") end--;
    if (canonical[end - 1] === ".") end--;
    canonical = canonical.slice(0, end);
  }
  if (value.toString() !== canonical) throw new TodoistImportError("INVALID_DURATION", line);
  return { duration: { amount: value, unit } };
}
