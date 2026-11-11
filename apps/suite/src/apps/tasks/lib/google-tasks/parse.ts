// AUTHORED-BY Codex GPT-6.1-Sol
import {
  GoogleTasksImportError,
  type GoogleTasksImportOptions,
  type GoogleTasksImportResult,
  type GoogleTasksProjectDraft,
  type GoogleTasksTaskDraft,
  type GoogleTasksWarning,
  MAX_GOOGLE_TASKS_JSON_BYTES,
  MAX_GOOGLE_TASKS_JSON_DEPTH,
  MAX_GOOGLE_TASKS_LISTS,
  MAX_GOOGLE_TASKS_TASKS,
} from "./model";

type RecordValue = Record<string, unknown>;

function requireValue(
  value: unknown,
  code: GoogleTasksImportError["code"] = "INVALID_DATA",
): asserts value {
  if (!value) throw new GoogleTasksImportError(code);
}

function record(value: unknown): RecordValue {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as RecordValue;
}

function own(value: RecordValue, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function text(value: unknown): string {
  requireValue(typeof value === "string");
  return value;
}

function nonblank(value: unknown): string {
  const result = text(value);
  requireValue(result.trim().length > 0);
  return result;
}

function items(value: RecordValue): unknown[] {
  const result = own(value, "items");
  if (result === undefined) return [];
  requireValue(Array.isArray(result));
  return result;
}

/** Bound bytes and structural nesting before JSON.parse allocates the object graph. */
function checkInput(input: string): void {
  requireValue(typeof input === "string", "INVALID_JSON");
  requireValue(input.length <= MAX_GOOGLE_TASKS_JSON_BYTES, "JSON_TOO_LARGE");
  let bytes = 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(++i);
      requireValue(next >= 0xdc00 && next <= 0xdfff, "INVALID_JSON");
      bytes += 4;
    } else {
      requireValue(code < 0xdc00 || code > 0xdfff, "INVALID_JSON");
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    }
    requireValue(bytes <= MAX_GOOGLE_TASKS_JSON_BYTES, "JSON_TOO_LARGE");
    const char = input[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      requireValue(++depth <= MAX_GOOGLE_TASKS_JSON_DEPTH, "JSON_TOO_DEEP");
    } else if (char === "}" || char === "]") depth--;
  }
}

/** Strict calendar validation before Date.parse; sub-millisecond precision is truncated. */
function timestamp(value: unknown): string {
  requireValue(typeof value === "string", "INVALID_DATE");
  const match = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}:\d{2}:\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(
    value,
  );
  requireValue(match && match[0] === value, "INVALID_DATE");
  const date = match[1] as string;
  const time = match[2] as string;
  const zone = (match[4] as string).toUpperCase();
  const wall = new Date(`${date}T${time}Z`);
  requireValue(
    !date.startsWith("0000") &&
      Number.isFinite(wall.getTime()) &&
      wall.toISOString().slice(0, 19) === `${date}T${time}`,
    "INVALID_DATE",
  );
  if (zone !== "Z")
    requireValue(
      Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4)) <= 59 && zone !== "-00:00",
      "INVALID_DATE",
    );
  const fraction = (match[3] ?? "").slice(0, 4);
  const result = new Date(`${date}T${time}${fraction}${zone}`).toISOString();
  requireValue(result.length === 24 && !result.startsWith("0000"), "INVALID_DATE");
  return result;
}

interface SourceTask {
  readonly sourceParent: string | undefined;
  readonly position: string;
  readonly index: number;
  readonly draft: GoogleTasksTaskDraft;
  parent: SourceTask | null;
  root: SourceTask | undefined;
  depth: number | undefined;
}

function parseList(
  list: RecordValue,
  listIndex: number,
  source: unknown[],
): GoogleTasksProjectDraft {
  const kind = own(list, "kind");
  requireValue(kind === undefined || kind === "tasks#taskList");
  const name = nonblank(own(list, "title")).trim();
  const warnings: GoogleTasksWarning[] = [];
  const warn = (code: GoogleTasksWarning["code"], index: number) =>
    warnings.push({ code, list: listIndex + 1, task: index + 1 });
  const byId = new Map<string, SourceTask>();
  const ids = new Set<string>();
  source.forEach((value, index) => {
    const task = record(value);
    const kind = own(task, "kind");
    requireValue(kind === undefined || kind === "tasks#task");
    const sourceId = nonblank(own(task, "id"));
    requireValue(!ids.has(sourceId));
    ids.add(sourceId);
    for (const key of ["deleted", "hidden"]) {
      const flag = own(task, key);
      requireValue(flag === undefined || typeof flag === "boolean");
    }
    if (own(task, "deleted") === true) {
      warn("DELETED_TASK", index);
      return;
    }
    const status = own(task, "status");
    requireValue(status === "needsAction" || status === "completed");
    if (own(task, "hidden") === true && status === "completed") warn("HIDDEN_COMPLETED", index);
    const notes = own(task, "notes");
    const description = notes === undefined ? [] : [text(notes)];
    const links = own(task, "links");
    if (links !== undefined) {
      requireValue(Array.isArray(links));
      for (const value of links) {
        const link = record(value);
        description.push(`${text(own(link, "description"))}: ${text(own(link, "link"))}`);
      }
    }
    const due = own(task, "due");
    let date: string | undefined;
    if (due !== undefined) {
      timestamp(due);
      // Google due timestamps encode a calendar date; never convert it to a local day.
      date = (due as string).slice(0, 10);
    }
    const completed = own(task, "completed");
    const completedAt = completed === undefined ? undefined : timestamp(completed);
    requireValue(completedAt === undefined || status === "completed");
    const parent = own(task, "parent");
    const position = text(own(task, "position"));
    requireValue(/^\d+$/.exec(position)?.[0] === position);
    byId.set(sourceId, {
      sourceParent: parent === undefined ? undefined : nonblank(parent),
      position,
      index,
      parent: null,
      root: undefined,
      depth: undefined,
      draft: {
        id: `task-${listIndex}-${index}`,
        sourceId,
        title: nonblank(own(task, "title")).trim(),
        description: description.filter(Boolean).join("\n"),
        indent: 1,
        labels: [],
        parentId: null,
        sectionId: null,
        orderKey: index,
        line: index + 1,
        author: "",
        responsible: "",
        dateLang: "",
        comments: [],
        state: status === "completed" ? "closed" : "open",
        ...(completedAt === undefined ? {} : { completedAt }),
        ...(date === undefined
          ? {}
          : { due: { kind: "date", date, dateTime: `${date}T00:00:00.000Z`, timeZone: "UTC" } }),
      },
    });
  });
  for (const task of byId.values()) {
    if (task.sourceParent !== undefined) {
      task.parent = byId.get(task.sourceParent) ?? null;
      if (!task.parent) warn("UNKNOWN_PARENT", task.index);
    }
  }
  // Memoised, iterative ancestor walks bound work to O(tasks), even for reversed chains.
  for (const task of byId.values()) {
    const path = new Set<SourceTask>();
    let current: SourceTask | null = task;
    while (current !== null && current.depth === undefined) {
      requireValue(!path.has(current), "INVALID_HIERARCHY");
      path.add(current);
      current = current.parent;
    }
    for (const entry of [...path].reverse()) {
      entry.depth = (entry.parent?.depth ?? -1) + 1;
      entry.root = entry.parent?.root ?? entry;
    }
  }
  const children = new Map<SourceTask | null, SourceTask[]>();
  const ordered = [...byId.values()].sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : a.index - b.index,
  );
  for (const task of ordered) {
    if ((task.depth as number) > 1) {
      task.parent = task.root as SourceTask;
      warn("DEPTH_FLATTENED", task.index);
    }
    const siblings = children.get(task.parent) ?? [];
    siblings.push(task);
    children.set(task.parent, siblings);
  }
  const pending = [...(children.get(null) ?? [])].reverse();
  const tasks: GoogleTasksTaskDraft[] = [];
  while (pending.length > 0) {
    const task = pending.pop() as SourceTask;
    tasks.push({
      ...task.draft,
      parentId: task.parent?.draft.id ?? null,
      indent: task.parent ? 2 : 1,
      orderKey: tasks.length,
    });
    pending.push(...[...(children.get(task) ?? [])].reverse());
  }
  return { id: `project-${listIndex}`, name, sections: [], tasks, warnings };
}

/** Parse Takeout Tasks.json or one tasks.list API response, without IO or ambient state. */
export function parseGoogleTasksJson(
  input: string,
  options: GoogleTasksImportOptions = {},
): GoogleTasksImportResult {
  checkInput(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.startsWith("\uFEFF") ? input.slice(1) : input);
  } catch {
    throw new GoogleTasksImportError("INVALID_JSON");
  }
  const root = record(parsed);
  const kind = own(root, "kind");
  let lists: RecordValue[];
  if (kind === "tasks#tasks") {
    const name = own(record(options), "singleListName");
    lists = [{ title: name === undefined ? "Imported tasks" : nonblank(name), items: items(root) }];
  } else {
    requireValue(kind === "tasks#taskLists");
    const values = items(root);
    requireValue(values.length <= MAX_GOOGLE_TASKS_LISTS, "TOO_MANY_LISTS");
    const ids = new Set<string>();
    lists = values.map((value) => {
      const list = record(value);
      const id = nonblank(own(list, "id"));
      requireValue(!ids.has(id));
      ids.add(id);
      return list;
    });
  }
  let count = 0;
  const sources = lists.map((list) => {
    const source = items(list);
    count += source.length;
    requireValue(count <= MAX_GOOGLE_TASKS_TASKS, "TOO_MANY_TASKS");
    return source;
  });
  const projects = lists.map((list, index) => parseList(list, index, sources[index] as unknown[]));
  return { projects, warnings: projects.flatMap((project) => project.warnings) };
}
