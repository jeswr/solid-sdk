// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { buildTracker, Tracker, trackerSubject } from "@jeswr/solid-task-model/tracker";
import { DataFactory, NS, node, requireHttp, requireTitle, SCHEMA, type Store, slug } from "./rdf";

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
