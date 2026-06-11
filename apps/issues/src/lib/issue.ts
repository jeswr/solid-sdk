import {
  TermWrapper,
  DatasetWrapper,
  OptionalFrom,
  OptionalAs,
  SetFrom,
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  TermAs,
  TermFrom,
} from "@rdfjs/wrapper";
import { WF, DCT, RDF, STATE, wf, dct, rdf, rdfs, sioc, foaf, vcard, schema, xsd, skos } from "./vocab";

export type IssueState = "open" | "closed";
export type Priority = "high" | "medium" | "low";
export const PRIORITIES: readonly Priority[] = ["high", "medium", "low"];

export type StatusSlug = "todo" | "in-progress" | "done";
/** The fixed workflow: ordered columns; `done` is terminal (⇒ state "closed"). */
export const STATUSES: { slug: StatusSlug; label: string; terminal: boolean }[] = [
  { slug: "todo", label: "To Do", terminal: false },
  { slug: "in-progress", label: "In Progress", terminal: false },
  { slug: "done", label: "Done", terminal: true },
];

export type IssueType = "epic" | "story" | "task" | "bug";
/** Jira-style issue types; carried by rdf:type via per-tracker `#type-*` classes. */
export const ISSUE_TYPES: { slug: IssueType; label: string }[] = [
  { slug: "epic", label: "Epic" },
  { slug: "story", label: "Story" },
  { slug: "task", label: "Task" },
  { slug: "bug", label: "Bug" },
];

/** Strip the fragment from an IRI to get its document URL. */
function docOf(iri: string): string {
  const u = new URL(iri);
  u.hash = "";
  return u.toString();
}

/** A comment on an issue: a `wf:Message` linked via `wf:message`. */
export class Comment extends TermWrapper {
  get id(): string {
    return this.value;
  }
  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  markMessage(): void {
    this.types.add(wf("Message"));
  }
  get content(): string | undefined {
    return OptionalFrom.subjectPredicate(this, sioc("content"), LiteralAs.string);
  }
  set content(value: string | undefined) {
    OptionalAs.object(this, sioc("content"), value, LiteralFrom.string);
  }
  get author(): string | undefined {
    return OptionalFrom.subjectPredicate(this, foaf("maker"), NamedNodeAs.string);
  }
  set author(value: string | undefined) {
    OptionalAs.object(this, foaf("maker"), value, NamedNodeFrom.string);
  }
  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }
  /** WebIDs mentioned in this comment, via `schema:mentions` — live set. */
  get mentions(): Set<string> {
    return SetFrom.subjectPredicate(this, schema("mentions"), NamedNodeAs.string, NamedNodeFrom.string);
  }
}

/**
 * A single issue, mapped onto `wf:Task` data (one resource per issue). State,
 * priority, and labels are all carried by `rdf:type` — the SolidOS model. Priority
 * and label classes are fragments of the tracker document (resolvable); the issue
 * derives their IRIs from its own `wf:tracker` link.
 */
export class Issue extends TermWrapper {
  get id(): string {
    return this.value;
  }

  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The tracker *document* URL (for deriving priority/label class IRIs). */
  private trackerDoc(): string | undefined {
    return this.tracker ? docOf(this.tracker) : undefined;
  }

  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("title"), LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, dct("title"), value, LiteralFrom.string);
  }

  get description(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("description"), LiteralAs.string);
  }
  set description(value: string | undefined) {
    OptionalAs.object(this, wf("description"), value, LiteralFrom.string);
  }

  get tracker(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("tracker"), NamedNodeAs.string);
  }
  set tracker(value: string | undefined) {
    OptionalAs.object(this, wf("tracker"), value, NamedNodeFrom.string);
  }

  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }

  get modified(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, dct("modified"), LiteralAs.date);
  }
  set modified(value: Date | undefined) {
    OptionalAs.object(this, dct("modified"), value, LiteralFrom.dateTime);
  }

  get creator(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("creator"), NamedNodeAs.string);
  }
  set creator(value: string | undefined) {
    OptionalAs.object(this, dct("creator"), value, NamedNodeFrom.string);
  }

  /** WebID of the assigned agent or group (optional). */
  get assignee(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("assignee"), NamedNodeAs.string);
  }
  set assignee(value: string | undefined) {
    OptionalAs.object(this, wf("assignee"), value, NamedNodeFrom.string);
  }

  /** Parent issue (this is a sub-task of it), via `dct:isPartOf`. */
  get parent(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("isPartOf"), NamedNodeAs.string);
  }
  set parent(value: string | undefined) {
    OptionalAs.object(this, dct("isPartOf"), value, NamedNodeFrom.string);
  }

  /** Issues this one is blocked by (must be done first), via `dct:requires` — live set. */
  get blockedBy(): Set<string> {
    return SetFrom.subjectPredicate(this, dct("requires"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Attached file URLs (in the pod), via `wf:attachment` — live set. */
  get attachments(): Set<string> {
    return SetFrom.subjectPredicate(this, wf("attachment"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  get dateDue(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, wf("dateDue"), LiteralAs.date);
  }
  set dateDue(value: Date | undefined) {
    // LiteralFrom.date emits an xsd:date with a full dateTime lexical (a wrapper
    // quirk that fails SHACL); store dateTime, which is well-formed and round-trips.
    OptionalAs.object(this, wf("dateDue"), value, LiteralFrom.dateTime);
  }

  /** Story-point estimate (`dct:extent` — "size of the resource"). */
  get estimate(): number | undefined {
    return OptionalFrom.subjectPredicate(this, dct("extent"), LiteralAs.number);
  }
  set estimate(value: number | undefined) {
    OptionalAs.object(this, dct("extent"), value, LiteralFrom.double);
  }

  /** Backlog rank (`schema:position`); lower sorts first. Fractional for cheap reorder. */
  get rank(): number | undefined {
    return OptionalFrom.subjectPredicate(this, schema("position"), LiteralAs.number);
  }
  set rank(value: number | undefined) {
    OptionalAs.object(this, schema("position"), value, LiteralFrom.double);
  }

  get state(): IssueState {
    return this.types.has(STATE.Closed) ? "closed" : "open";
  }
  set state(value: IssueState) {
    const types = this.types;
    if (value === "closed") {
      types.add(STATE.Closed);
      types.delete(STATE.Open);
    } else {
      types.add(STATE.Open);
      types.delete(STATE.Closed);
    }
    types.add(wf("Task"));
  }
  get isOpen(): boolean {
    return this.state === "open";
  }

  private statusClass(slug: StatusSlug, doc = this.trackerDoc()): string | undefined {
    return doc ? `${doc}#status-${slug}` : undefined;
  }
  /** Workflow status (carried by rdf:type). Falls back to state for unstatused issues. */
  get status(): StatusSlug {
    const doc = this.trackerDoc();
    if (doc) {
      const types = this.types;
      const found = STATUSES.find((s) => types.has(this.statusClass(s.slug, doc)!));
      if (found) return found.slug;
    }
    return this.state === "closed" ? "done" : "todo";
  }
  set status(slug: StatusSlug) {
    const doc = this.trackerDoc();
    if (doc) {
      const types = this.types;
      for (const s of STATUSES) types.delete(this.statusClass(s.slug, doc)!);
      types.add(this.statusClass(slug, doc)!);
    }
    // Keep wf:Open/wf:Closed (and the open/closed filter) in sync with the status.
    this.state = STATUSES.find((s) => s.slug === slug)?.terminal ? "closed" : "open";
  }

  private priorityClass(level: Priority, doc = this.trackerDoc()): string | undefined {
    return doc ? `${doc}#priority-${level}` : undefined;
  }
  get priority(): Priority | undefined {
    const doc = this.trackerDoc();
    if (!doc) return undefined;
    const types = this.types;
    return PRIORITIES.find((level) => types.has(this.priorityClass(level, doc)!));
  }
  set priority(level: Priority | undefined) {
    const doc = this.trackerDoc();
    if (!doc) return;
    const types = this.types;
    for (const l of PRIORITIES) types.delete(this.priorityClass(l, doc)!);
    if (level) types.add(this.priorityClass(level, doc)!);
  }

  private typeClass(slug: IssueType, doc = this.trackerDoc()): string | undefined {
    return doc ? `${doc}#type-${slug}` : undefined;
  }
  /** Issue type (epic/story/task/bug), carried by rdf:type. Defaults to "task". */
  get issueType(): IssueType {
    const doc = this.trackerDoc();
    if (doc) {
      const types = this.types;
      const found = ISSUE_TYPES.find((t) => types.has(this.typeClass(t.slug, doc)!));
      if (found) return found.slug;
    }
    return "task";
  }
  set issueType(slug: IssueType) {
    const doc = this.trackerDoc();
    if (!doc) return;
    const types = this.types;
    for (const t of ISSUE_TYPES) types.delete(this.typeClass(t.slug, doc)!);
    types.add(this.typeClass(slug, doc)!);
  }

  private labelPrefix(doc = this.trackerDoc()): string | undefined {
    return doc ? `${doc}#label-` : undefined;
  }
  /** Label slugs applied to this issue (the class fragment after `#label-`). */
  get labels(): string[] {
    const prefix = this.labelPrefix();
    if (!prefix) return [];
    return [...this.types].filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length));
  }
  set labels(slugs: string[]) {
    const prefix = this.labelPrefix();
    if (!prefix) return;
    const types = this.types;
    for (const t of [...types]) if (t.startsWith(prefix)) types.delete(t);
    for (const s of slugs) types.add(`${prefix}${s}`);
  }

  /** Read a custom-field value (select fields yield the option IRI). */
  getField(def: FieldDef): FieldValue | undefined {
    switch (def.type) {
      case "number":
        return OptionalFrom.subjectPredicate(this, def.iri, LiteralAs.number);
      case "date":
        return OptionalFrom.subjectPredicate(this, def.iri, LiteralAs.date);
      case "select":
        return OptionalFrom.subjectPredicate(this, def.iri, NamedNodeAs.string);
      default: // text, url — both read as strings
        return OptionalFrom.subjectPredicate(this, def.iri, LiteralAs.string);
    }
  }

  /** Write (or clear, with undefined) a custom-field value. */
  setField(def: FieldDef, value: FieldValue | undefined): void {
    switch (def.type) {
      case "number":
        OptionalAs.object(this, def.iri, value as number | undefined, LiteralFrom.double);
        break;
      case "date":
        OptionalAs.object(this, def.iri, value as Date | undefined, LiteralFrom.dateTime);
        break;
      case "select":
        OptionalAs.object(this, def.iri, value as string | undefined, NamedNodeFrom.string);
        break;
      case "url":
        OptionalAs.object(this, def.iri, value as string | undefined, LiteralFrom.anyUriString);
        break;
      default:
        OptionalAs.object(this, def.iri, value as string | undefined, LiteralFrom.string);
    }
  }

  /** Live set of comment objects linked via `wf:message`. */
  get messages(): Set<Comment> {
    return SetFrom.subjectPredicate(this, wf("message"), TermAs.instance(Comment), TermFrom.instance);
  }
  /** Comments, oldest first. */
  get comments(): Comment[] {
    return [...this.messages].sort((a, b) => (a.created?.getTime() ?? 0) - (b.created?.getTime() ?? 0));
  }
}

/** A label definition on the tracker: slug + human label. */
export interface LabelDef {
  slug: string;
  label: string;
}

/** Custom-field value types (Jira/Monday column types). */
export type FieldType = "text" | "number" | "date" | "url" | "select";
export const FIELD_TYPES: { slug: FieldType; label: string }[] = [
  { slug: "text", label: "Text" },
  { slug: "number", label: "Number" },
  { slug: "date", label: "Date" },
  { slug: "url", label: "Link" },
  { slug: "select", label: "Select" },
];

/** One choice of a select field — a `skos:Concept` in the field's scheme. */
export interface FieldOption {
  iri: string;
  label: string;
}

/**
 * A custom field: an `rdf:Property` minted as a fragment of the tracker doc
 * (so the IRI dereferences), typed by its `rdfs:range`. Select fields double
 * as a `skos:ConceptScheme` whose options are `skos:Concept`s.
 */
export interface FieldDef {
  iri: string;
  slug: string;
  label: string;
  type: FieldType;
  options: FieldOption[];
}

/** A custom-field value; select fields hold the chosen option's IRI. */
export type FieldValue = string | number | Date;

/**
 * The URL if it parses with an http(s) scheme, else undefined. Pod data is
 * untrusted input: a stored `javascript:` URL must never become a clickable
 * link, and we reject it on write too.
 */
export function safeHttpUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** `rdfs:range` per field type (xsd datatypes; selects range over concepts). */
const FIELD_RANGES: Record<FieldType, string> = {
  text: xsd("string"),
  number: xsd("double"),
  date: xsd("dateTime"),
  url: xsd("anyURI"),
  select: skos("Concept"),
};

const fieldTypeOfRange = (range: string | undefined): FieldType =>
  (Object.keys(FIELD_RANGES) as FieldType[]).find((t) => FIELD_RANGES[t] === range) ?? "text";

/** Shared slug rule for fragment identifiers minted from display names. */
const fragmentSlug = (label: string): string =>
  label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The tracker configuration node (`wf:Tracker`). Holds the title, the priority and
 * label category classes (declared via `wf:issueCategory`, defined as fragments of
 * the tracker document), and the assignee group (`wf:assigneeGroup` → `vcard:Group`).
 */
export class Tracker extends TermWrapper {
  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  private get doc(): string {
    return docOf(this.value);
  }
  private get categories(): Set<string> {
    return SetFrom.subjectPredicate(this, wf("issueCategory"), NamedNodeAs.string, NamedNodeFrom.string);
  }

  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("title"), LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, dct("title"), value, LiteralFrom.string);
  }

  /** Define a category class (e.g. a priority or label) as a fragment of the doc. */
  private defineClass(fragment: string, label: string, parentFragment?: string): string {
    const iri = `${this.doc}#${fragment}`;
    const klass = new TermWrapper(iri, this.dataset, this.factory);
    SetFrom.subjectPredicate(klass, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(rdfs("Class"));
    OptionalAs.object(klass, rdfs("label"), label, LiteralFrom.string);
    if (parentFragment) {
      OptionalAs.object(klass, rdfs("subClassOf"), `${this.doc}#${parentFragment}`, NamedNodeFrom.string);
    }
    this.categories.add(iri);
    return iri;
  }

  /** Define a workflow status class as a subclass of an external wf state (Open/Closed). */
  private defineStatus(slug: string, label: string, terminal: boolean): void {
    const iri = `${this.doc}#status-${slug}`;
    const klass = new TermWrapper(iri, this.dataset, this.factory);
    SetFrom.subjectPredicate(klass, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(rdfs("Class"));
    OptionalAs.object(klass, rdfs("label"), label, LiteralFrom.string);
    OptionalAs.object(klass, rdfs("subClassOf"), terminal ? STATE.Closed : STATE.Open, NamedNodeFrom.string);
  }

  /** Write the fixed tracker configuration (type, issue class, statuses, priorities). */
  configure(title: string): void {
    this.types.add(wf("Tracker"));
    this.title = title;
    OptionalAs.object(this, wf("issueClass"), wf("Task"), NamedNodeFrom.string);
    // Workflow statuses (subclasses of wf:Open / wf:Closed); To Do is the initial state.
    for (const s of STATUSES) this.defineStatus(s.slug, s.label, s.terminal);
    OptionalAs.object(this, wf("initialState"), `${this.doc}#status-todo`, NamedNodeFrom.string);
    // Priority dimension (#Priority parent + the three ordered priorities).
    this.defineClass("Priority", "Priority");
    this.defineClass("priority-high", "High", "Priority");
    this.defineClass("priority-medium", "Medium", "Priority");
    this.defineClass("priority-low", "Low", "Priority");
    this.defineClass("Label", "Label");
    // Issue-type dimension (#Type parent + epic/story/task/bug).
    this.defineClass("Type", "Type");
    for (const t of ISSUE_TYPES) this.defineClass(`type-${t.slug}`, t.label, "Type");
  }

  /** Label definitions (subclasses of `#Label`), as slug + human label. */
  get labelDefs(): LabelDef[] {
    const out: LabelDef[] = [];
    const prefix = `${this.doc}#label-`;
    for (const iri of this.categories) {
      if (iri.startsWith(prefix)) {
        const klass = new TermWrapper(iri, this.dataset, this.factory);
        out.push({
          slug: iri.slice(prefix.length),
          label: OptionalFrom.subjectPredicate(klass, rdfs("label"), LiteralAs.string) ?? iri.slice(prefix.length),
        });
      }
    }
    return out;
  }

  /** Define (or relabel) a label, returning its slug. */
  defineLabel(label: string): string {
    const slug = fragmentSlug(label);
    this.defineClass(`label-${slug}`, label, "Label");
    return slug;
  }

  /**
   * Define (or redefine) a custom field. Select options get `-opt-` in their
   * fragment so an option IRI can never collide with another field's IRI.
   */
  defineField(label: string, type: FieldType, optionLabels: string[] = []): FieldDef {
    const slug = fragmentSlug(label);
    const iri = `${this.doc}#field-${slug}`;
    // Redefinition must not leave stale triples behind (old options, an old
    // range, a leftover ConceptScheme type) — clear the slug and start fresh.
    this.removeField(slug);
    const prop = new TermWrapper(iri, this.dataset, this.factory);
    SetFrom.subjectPredicate(prop, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(rdf("Property"));
    OptionalAs.object(prop, rdfs("label"), label, LiteralFrom.string);
    OptionalAs.object(prop, rdfs("domain"), wf("Task"), NamedNodeFrom.string);
    OptionalAs.object(prop, rdfs("range"), FIELD_RANGES[type], NamedNodeFrom.string);

    const options: FieldOption[] = [];
    if (type === "select") {
      SetFrom.subjectPredicate(prop, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(skos("ConceptScheme"));
      for (const optionLabel of optionLabels) {
        const optionIri = `${iri}-opt-${fragmentSlug(optionLabel)}`;
        const concept = new TermWrapper(optionIri, this.dataset, this.factory);
        SetFrom.subjectPredicate(concept, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(skos("Concept"));
        OptionalAs.object(concept, skos("prefLabel"), optionLabel, LiteralFrom.string);
        OptionalAs.object(concept, skos("inScheme"), iri, NamedNodeFrom.string);
        options.push({ iri: optionIri, label: optionLabel });
      }
    }
    return { iri, slug, label, type, options };
  }

  /** All custom-field definitions (properties under `#field-`), label order. */
  get fieldDefs(): FieldDef[] {
    const prefix = `${this.doc}#field-`;
    const nn = this.factory.namedNode.bind(this.factory);
    const out: FieldDef[] = [];
    for (const quad of this.dataset.match(null, nn(rdf("type")), nn(rdf("Property")))) {
      const iri = quad.subject.value;
      if (!iri.startsWith(prefix)) continue;
      const prop = new TermWrapper(iri, this.dataset, this.factory);
      const type = fieldTypeOfRange(OptionalFrom.subjectPredicate(prop, rdfs("range"), NamedNodeAs.string));
      const options: FieldOption[] = [];
      if (type === "select") {
        for (const oq of this.dataset.match(null, nn(skos("inScheme")), nn(iri))) {
          const concept = new TermWrapper(oq.subject.value, this.dataset, this.factory);
          options.push({
            iri: oq.subject.value,
            label: OptionalFrom.subjectPredicate(concept, skos("prefLabel"), LiteralAs.string) ?? oq.subject.value,
          });
        }
        options.sort((a, b) => a.label.localeCompare(b.label));
      }
      out.push({
        iri,
        slug: iri.slice(prefix.length),
        label: OptionalFrom.subjectPredicate(prop, rdfs("label"), LiteralAs.string) ?? iri.slice(prefix.length),
        type,
        options,
      });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Remove a field definition and its options (issue values are untouched). */
  removeField(slug: string): void {
    const iri = `${this.doc}#field-${slug}`;
    const nn = this.factory.namedNode.bind(this.factory);
    for (const oq of [...this.dataset.match(null, nn(skos("inScheme")), nn(iri))]) {
      for (const q of [...this.dataset.match(oq.subject)]) this.dataset.delete(q);
    }
    for (const q of [...this.dataset.match(nn(iri))]) this.dataset.delete(q);
  }

  private get groupIri(): string {
    return `${this.doc}#team`;
  }
  /** The assignee group's members (WebIDs). */
  get groupMembers(): string[] {
    const group = OptionalFrom.subjectPredicate(this, wf("assigneeGroup"), NamedNodeAs.string);
    if (!group) return [];
    const wrapper = new TermWrapper(group, this.dataset, this.factory);
    return [...SetFrom.subjectPredicate(wrapper, vcard("hasMember"), NamedNodeAs.string, NamedNodeFrom.string)];
  }
  /** The assignee group IRI, or undefined if no members are set. */
  get assigneeGroup(): string | undefined {
    return OptionalFrom.subjectPredicate(this, wf("assigneeGroup"), NamedNodeAs.string);
  }
  setGroupMembers(webIds: string[]): void {
    OptionalAs.object(this, wf("assigneeGroup"), this.groupIri, NamedNodeFrom.string);
    const group = new TermWrapper(this.groupIri, this.dataset, this.factory);
    SetFrom.subjectPredicate(group, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(vcard("Group"));
    const members = SetFrom.subjectPredicate(group, vcard("hasMember"), NamedNodeAs.string, NamedNodeFrom.string);
    for (const m of [...members]) members.delete(m);
    for (const w of webIds) members.add(w);
  }
}

/**
 * A sprint: a `schema:Event` fragment in the tracker document with start/end
 * dates and `wf:task` links to its issues. Lifecycle derives from the dates:
 * no start ⇒ planned; started & no/unreached end ⇒ active; end passed ⇒ done.
 */
export class Sprint extends TermWrapper {
  get iri(): string {
    return this.value;
  }
  private get types(): Set<string> {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  markSprint(): void {
    this.types.add(schema("Event"));
  }
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, dct("title"), LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, dct("title"), value, LiteralFrom.string);
  }
  get startDate(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, schema("startDate"), LiteralAs.date);
  }
  set startDate(value: Date | undefined) {
    OptionalAs.object(this, schema("startDate"), value, LiteralFrom.dateTime);
  }
  get endDate(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, schema("endDate"), LiteralAs.date);
  }
  set endDate(value: Date | undefined) {
    OptionalAs.object(this, schema("endDate"), value, LiteralFrom.dateTime);
  }
  /** Issue URLs in this sprint (live set), via `wf:task`. */
  get tasks(): Set<string> {
    return SetFrom.subjectPredicate(this, wf("task"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /**
   * Story points committed to the sprint (`dct:extent`, as on issues),
   * snapshotted at completion — completing releases unfinished tasks, so the
   * live task set alone can no longer reconstruct the commitment.
   */
  get committedPoints(): number | undefined {
    return OptionalFrom.subjectPredicate(this, dct("extent"), LiteralAs.number);
  }
  set committedPoints(value: number | undefined) {
    OptionalAs.object(this, dct("extent"), value, LiteralFrom.double);
  }
  state(now = new Date()): "planned" | "active" | "done" {
    if (this.endDate && this.endDate.getTime() <= now.getTime()) return "done";
    if (this.startDate && this.startDate.getTime() <= now.getTime()) return "active";
    return "planned";
  }
}

/** Enumerates the sprints declared in a tracker document. */
export class SprintsDataset extends DatasetWrapper {
  get sprints(): Iterable<Sprint> {
    return this.instancesOf(schema("Event"), Sprint);
  }
}

export { WF, DCT, RDF, STATE };
