// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { buildTracker, Tracker, trackerSubject } from "@jeswr/solid-task-model/tracker";
import {
  DataFactory,
  NS,
  node,
  requireHttp,
  requireTitle,
  SCHEMA,
  type Store,
  slug,
  uniqueSlug,
} from "./rdf";

export interface SavedViewDef {
  iri: string;
  name: string;
  payload: string;
}
const SAVED_VIEW = `${NS.WF}savedView`;
const VIEW_QUERY = `${NS.WF}viewQuery`;

export interface Category {
  id: string;
  name: string;
  position?: number | undefined;
  color?: string | undefined;
}
/** App-local extension of the cross-app tracker; unknown workflow RDF is retained. */
export class TaskTracker extends Tracker {
  private get extra() {
    return node(this.id, this.dataset);
  }
  get description() {
    return this.extra.text(`${NS.DCT}description`);
  }
  set description(value: string | undefined) {
    this.extra.setText(`${NS.DCT}description`, value);
  }
  get created() {
    return this.extra.date(`${NS.DCT}created`);
  }
  set created(value: Date | undefined) {
    this.extra.setDate(`${NS.DCT}created`, value);
  }
  get modified() {
    return this.extra.date(`${NS.DCT}modified`);
  }
  set modified(value: Date | undefined) {
    this.extra.setDate(`${NS.DCT}modified`, value);
  }
  get position() {
    return this.extra.number(`${SCHEMA}position`);
  }
  set position(value: number | undefined) {
    this.extra.setNumber(`${SCHEMA}position`, value);
  }
  get color() {
    return this.extra.text(`${SCHEMA}color`);
  }
  set color(value: string | undefined) {
    this.extra.setText(`${SCHEMA}color`, value);
  }
  get archivedAt() {
    return this.extra.date(`${NS.PROV}invalidatedAtTime`);
  }
  set archivedAt(value: Date | undefined) {
    this.extra.setDate(`${NS.PROV}invalidatedAtTime`, value);
  }
  private get base() {
    return this.id.split("#")[0];
  }
  private get savedViewIris() {
    return this.extra.iris(SAVED_VIEW);
  }
  /** Saved-view links must never grant write access to unrelated tracker configuration. */
  isOwnSavedView(iri: string): boolean {
    return (
      iri.startsWith(`${this.base}#view-`) &&
      /^[-a-z0-9]+$/.test(iri.slice(`${this.base}#view-`.length))
    );
  }
  get savedViews(): SavedViewDef[] {
    return [...this.extra.nodes(SAVED_VIEW)]
      .flatMap((link) => {
        const iri = link.value;
        if (link.termType !== "NamedNode" || !this.isOwnSavedView(iri)) return [];
        const item = node(iri, this.dataset);
        const name = item.text(`${NS.DCT}title`);
        const payload = item.text(VIEW_QUERY);
        return name?.trim() && payload !== undefined ? [{ iri, name, payload }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  defineSavedView(name: string, payload: string, iri?: string): SavedViewDef {
    requireTitle(name);
    const prefix = `${this.base}#view-`;
    const occupied = [...this.dataset]
      .map((q) => q.subject.value)
      .concat([...this.extra.nodes(SAVED_VIEW)].map((link) => link.value));
    const target =
      iri && this.isOwnSavedView(iri)
        ? iri
        : `${prefix}${uniqueSlug(
            name,
            occupied.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)),
          )}`;
    for (const quad of this.dataset.match(DataFactory.namedNode(target))) this.dataset.delete(quad);
    const item = node(target, this.dataset);
    item.setText(`${NS.DCT}title`, name.trim());
    item.setText(VIEW_QUERY, payload);
    this.savedViewIris.add(target);
    return { iri: target, name: name.trim(), payload };
  }
  removeSavedView(iri: string): void {
    this.savedViewIris.delete(iri);
    if (!this.isOwnSavedView(iri)) return;
    for (const quad of this.dataset.match(DataFactory.namedNode(iri))) this.dataset.delete(quad);
  }
  private dimension(kind: "Section" | "Label") {
    return `${this.base}#${kind}`;
  }
  private readCategories(kind: "Section" | "Label"): Category[] {
    const parent = this.dimension(kind);
    return [
      ...this.dataset.match(
        null,
        DataFactory.namedNode(`${NS.RDFS}subClassOf`),
        DataFactory.namedNode(parent),
      ),
    ]
      .map((q) => {
        const item = node(q.subject.value, this.dataset);
        return {
          id: item.value,
          name: item.text(`${NS.RDFS}label`) ?? "",
          position: item.number(`${SCHEMA}position`),
          color: item.text(`${SCHEMA}color`),
        };
      })
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id));
  }
  get sections() {
    return this.readCategories("Section");
  }
  get labels() {
    return this.readCategories("Label");
  }
  /** Edit a class in place so existing task type IRIs remain stable. */
  updateSection(id: string, change: { name?: string; position?: number }): void {
    if (!this.sections.some((section) => section.id === id))
      throw new TypeError("Unknown section.");
    const section = node(id, this.dataset);
    if (change.name !== undefined) {
      requireTitle(change.name);
      section.setText(`${NS.RDFS}label`, change.name);
    }
    if (change.position !== undefined) {
      if (!Number.isFinite(change.position)) throw new TypeError("Invalid position.");
      section.setNumber(`${SCHEMA}position`, change.position);
    }
  }
  /** Remove only this tracker's section class; callers clear task references first. */
  removeSection(id: string): void {
    if (!this.sections.some((section) => section.id === id))
      throw new TypeError("Unknown section.");
    for (const quad of this.dataset.match(DataFactory.namedNode(id))) this.dataset.delete(quad);
  }
  defineCategory(
    kind: "Section" | "Label",
    name: string,
    position?: number,
    color?: string,
  ): Category {
    requireTitle(name);
    const parent = this.dimension(kind);
    this.categories.add(parent);
    const root = node(parent, this.dataset);
    root.types.add(`${NS.RDFS}Class`);
    root.setText(`${NS.RDFS}label`, kind);
    // Repeating a name edits that category; distinct names must never share an IRI.
    const existing = this.readCategories(kind).find((category) => category.name === name);
    const base = `${this.base}#${kind.toLowerCase()}-${slug(name)}`;
    let id = existing?.id ?? base;
    for (let suffix = 2; !existing && this.dataset.match(DataFactory.namedNode(id)).size; suffix++)
      id = `${base}-${suffix}`;
    const item = node(id, this.dataset);
    item.types.add(`${NS.RDFS}Class`);
    item.iris(`${NS.RDFS}subClassOf`).add(parent);
    item.setText(`${NS.RDFS}label`, name);
    item.setNumber(`${SCHEMA}position`, position);
    item.setText(`${SCHEMA}color`, color);
    return { id, name, position, color };
  }
  override setGroupMembers(members: string[]): void {
    const id = this.assigneeGroup ?? `${this.base}#members`;
    this.extra.setIri(`${NS.WF}assigneeGroup`, id);
    const group = node(id, this.dataset);
    group.types.add(`${NS.VCARD}Group`);
    const values = group.iris(`${NS.VCARD}hasMember`);
    values.clear();
    for (const member of members) values.add(requireHttp(member));
  }
}
export function createTracker(
  url: string,
  title: string,
  stateStore: string,
  members: string[],
  now: Date,
): { dataset: Store; tracker: TaskTracker } {
  requireTitle(title);
  const dataset = buildTracker(url, { title, stateStore: requireHttp(stateStore) });
  const tracker = new TaskTracker(trackerSubject(url), dataset, DataFactory);
  tracker.created = now;
  tracker.modified = now;
  tracker.setGroupMembers(members);
  // Declare empty dimensions even before the first section or label exists.
  for (const kind of ["Section", "Label"]) {
    const root = node(`${url}#${kind}`, dataset);
    root.types.add(`${NS.RDFS}Class`);
    root.setText(`${NS.RDFS}label`, kind);
    tracker.categories.add(root.value);
  }
  return { dataset, tracker };
}
/** Labels union by case-insensitive name, retaining each tracker-local identity. */
export function unionLabels(trackers: readonly TaskTracker[]): Map<string, Category[]> {
  const result = new Map<string, Category[]>();
  for (const tracker of trackers)
    for (const label of tracker.labels) {
      const key = label.name.toLowerCase();
      result.set(key, [...(result.get(key) ?? []), label]);
    }
  return result;
}
