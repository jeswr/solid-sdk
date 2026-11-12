// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
/** Public Task API over the SHACL-generated core; only cross-field policy lives here. */
import { isSafeAbsoluteIri, tryRead } from "@jeswr/model-runtime";
import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import type { TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, type Store } from "n3";
import { entities, type TaskWrapper } from "./generated/model.js";
import { httpIriOrUndefined, isHttpIri } from "./iri.js";
import {
  httpObjects,
  malformedDate,
  normalizePriority,
  orderTaskStore,
  scalarDates,
  scalarIris,
  unparseableHttpIri,
} from "./task-policy.js";
import type { TaskData, TaskPriority, TaskState } from "./task-types.js";
import { dct, PREFIXES, WF_CLOSED, WF_OPEN } from "./vocab.js";

export { isHttpIri } from "./iri.js";
export { isAssignedTo, PRIORITIES, sortTasks } from "./task-policy.js";
export type { TaskData, TaskPriority, TaskState } from "./task-types.js";

const task = entities.Task;

// Preserve explicit undefined setters under exactOptionalPropertyTypes and mark(): this.
// The second description predicate is an internal generated accessor, not public API.
type Clearable = Exclude<keyof TaskData, "state" | "blockedBy" | "relatesTo">;
type ClearableFields = { [Key in Clearable]: TaskWrapper[Key] };
interface PublicWrapper
  extends TermWrapper,
    Omit<TaskWrapper, Clearable | "mark" | "descriptionDct">,
    ClearableFields {
  mark(): this;
}
const Wrapper = task.Wrapper as new (
  ...args: ConstructorParameters<typeof task.Wrapper>
) => PublicWrapper;
const view = (doc: TermWrapper) => new task.Wrapper(doc.value, doc.dataset, doc.factory);

/** Generated typed accessors plus the public lifecycle and dual-description policies. */
export class Task extends Wrapper {
  get isTask(): boolean {
    return this.isInstance;
  }

  // Both producers must find the body. Generated read aliases cannot dual-write it.
  override get description(): string | undefined {
    return super.description ?? view(this).descriptionDct;
  }
  override set description(value: string | undefined) {
    super.description = value;
    view(this).descriptionDct = value;
  }

  override get priority(): TaskPriority | undefined {
    return normalizePriority(super.priority);
  }
  override set priority(value: TaskPriority | undefined) {
    super.priority = value;
  }

  // SHACL cannot express type-set exclusivity or the close/reopen timestamp side effect.
  get state(): TaskState {
    return this.types.has(WF_CLOSED) ? "closed" : "open";
  }
  set state(value: TaskState) {
    this.mark();
    this.types.add(value === "closed" ? WF_CLOSED : WF_OPEN);
    this.types.delete(value === "closed" ? WF_OPEN : WF_CLOSED);
    if (value === "closed") this.endedAt ??= new Date();
    else this.endedAt = undefined;
  }
  get isOpen(): boolean {
    return this.state === "open";
  }
}

// Direct accessors keep the original wrapper's observable reads where the generated guard
// would silently drop a value consumers rely on detecting: an ill-typed xsd:dateTime reads
// as an Invalid Date, and an unparseable but lexically safe http(s) IRI keeps its spelling.
// Writes stay the generated guarded setters; parseTask keeps its own stricter policy.
function restoreRead(name: string, fallback: (doc: TermWrapper) => unknown): void {
  const generated = Object.getOwnPropertyDescriptor(task.Wrapper.prototype, name);
  const { get, set } = generated ?? {};
  if (!get || !set) throw new TypeError(`missing generated Task accessor: ${name}`);
  Object.defineProperty(Task.prototype, name, {
    get(this: Task) {
      return get.call(this) ?? fallback(this);
    },
    set,
    enumerable: false,
    configurable: true,
  });
}
for (const [name, predicate] of Object.entries(scalarIris)) {
  restoreRead(name, (doc) => unparseableHttpIri(doc, predicate));
}
for (const [name, predicate] of Object.entries(scalarDates)) {
  restoreRead(name, (doc) => malformedDate(doc, predicate));
}

export function taskSubject(resourceUrl: string): string {
  return task.subject(resourceUrl);
}

export function parseTask(resourceUrl: string, dataset: DatasetCore): TaskData | undefined {
  const core = tryRead(() => task.parse(resourceUrl, dataset));
  if (core === undefined) return undefined;
  const doc = new Task(taskSubject(resourceUrl), dataset, DataFactory);
  const data: TaskData = { title: core.title, state: tryRead(() => doc.state) ?? "open" };
  const fields = {
    description: core.description ?? core.descriptionDct,
    created: core.created,
    modified: core.modified,
    endedAt: core.endedAt,
    creator: httpObjects(doc, scalarIris.creator)[0],
    assignee: httpObjects(doc, scalarIris.assignee)[0],
    project: httpObjects(doc, scalarIris.project)[0],
    dueDate: core.dueDate,
    priority: normalizePriority(core.priority),
    rank: Number.isFinite(core.rank) ? core.rank : undefined,
    parent: httpObjects(doc, scalarIris.parent)[0],
    duplicateOf: httpObjects(doc, scalarIris.duplicateOf)[0],
    clonedFrom: httpObjects(doc, scalarIris.clonedFrom)[0],
  };
  Object.assign(
    data,
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  );
  const blockedBy = httpObjects(doc, dct("requires"));
  const relatesTo = httpObjects(doc, dct("relation"));
  if (blockedBy.length > 0) data.blockedBy = blockedBy;
  if (relatesTo.length > 0) data.relatesTo = relatesTo;
  return data;
}

export function buildTask(resourceUrl: string, data: TaskData): Store {
  const input = {
    ...data,
    descriptionDct: data.description,
    endedAt: data.state === "closed" ? data.endedAt : undefined,
    blockedBy: data.blockedBy?.filter(isHttpIri),
    relatesTo: data.relatesTo?.filter(isHttpIri),
  };
  for (const key of Object.keys(scalarIris) as (keyof typeof scalarIris)[]) {
    input[key] = httpIriOrUndefined(data[key]);
  }
  const store = task.build(resourceUrl, input);
  new Task(taskSubject(resourceUrl), store, DataFactory).state = data.state;
  return orderTaskStore(store);
}

/** Keep the generic Store serializer shared by tracker/contacts and its exact bytes. */
export function storeToTurtle(store: Store): Promise<string> {
  return serialize([...store], {
    format: "text/turtle",
    prefixes: { ...PREFIXES },
    emptyAsEmptyString: false,
  });
}
export async function serializeTask(resourceUrl: string, data: TaskData): Promise<string> {
  return storeToTurtle(buildTask(resourceUrl, data));
}
export async function parseTaskTtl(
  url: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<TaskData | undefined> {
  if (!isSafeAbsoluteIri(url)) return undefined;
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  return parseTask(url, await parseRdf(body, contentType ?? "text/turtle", { baseIRI: url }));
}
