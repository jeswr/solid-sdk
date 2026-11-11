// AUTHORED-BY Codex GPT-6.1-Sol
import { isDirectChild } from "../../../docs/lib/model/layout";
import { ModelError } from "./errors";
import { RdfIO, type Resource } from "./io";
import { type Node, NS, node, requireHttp, Store } from "./rdf";
import type { StoredProject, StoredTask } from "./store";

const OA = "http://www.w3.org/ns/oa#";
const FORMAT = "http://purl.org/dc/elements/1.1/format";
export const DELETED_COMMENT = "[Comment deleted]";
export interface TaskComment {
  url: string;
  id: string;
  etag: string | null;
  text: string;
  creator: string;
  created: string;
  target: string;
  kind: "root" | "reply";
  deleted: boolean;
}
export interface TaskCommentThread {
  root: TaskComment;
  replies: TaskComment[];
}
function only(subject: Node, predicate: string): Node {
  const values = [...subject.nodes(predicate)];
  if (values.length !== 1) throw new TypeError("Malformed comment.");
  return values[0] as Node;
}
function iri(subject: Node, predicate: string): string {
  const value = only(subject, predicate);
  if (value.termType !== "NamedNode") throw new TypeError("Malformed comment.");
  return requireHttp(value.value);
}
function text(subject: Node, predicate: string): string {
  const value = only(subject, predicate);
  if (value.termType !== "Literal" || value.datatype.value !== `${NS.XSD}string`)
    throw new TypeError("Malformed comment.");
  return value.value;
}
function readComment(resource: Resource): TaskComment {
  const id = `${resource.url}#it`;
  const annotation = node(id, resource.dataset);
  const body = only(annotation, `${OA}hasBody`);
  const motivation = iri(annotation, `${OA}motivatedBy`);
  const created = only(annotation, `${NS.DCT}created`);
  if (
    !annotation.types.has(`${OA}Annotation`) ||
    !["BlankNode", "NamedNode"].includes(body.termType) ||
    (body.termType === "NamedNode" && body.value !== `${resource.url}#body`) ||
    !body.types.has(`${OA}TextualBody`) ||
    text(body, FORMAT) !== "text/plain" ||
    created.termType !== "Literal" ||
    created.datatype.value !== `${NS.XSD}dateTime` ||
    !Number.isFinite(Date.parse(created.value)) ||
    ![`${OA}commenting`, `${OA}replying`].includes(motivation)
  )
    throw new TypeError("Malformed comment.");
  const value = text(body, `${NS.RDF}value`);
  if (!value.trim()) throw new TypeError("Malformed comment.");
  return {
    url: resource.url,
    id,
    etag: resource.etag,
    text: value,
    creator: iri(annotation, `${NS.DCT}creator`),
    created: new Date(created.value).toISOString(),
    target: iri(annotation, `${OA}hasTarget`),
    kind: motivation === `${OA}commenting` ? "root" : "reply",
    deleted: annotation.nodes(`${NS.PROV}invalidatedAtTime`).size > 0,
  };
}
const oldest = (a: TaskComment, b: TaskComment) =>
  a.created.localeCompare(b.created) || a.url.localeCompare(b.url);

/** Task-targeted annotations; authenticated transport and actor belong to this session. */
export class TaskCommentStore {
  readonly container: string;
  private readonly target: string;
  private readonly io: RdfIO;
  constructor(
    project: StoredProject,
    task: StoredTask,
    private readonly webId: string,
    http: typeof fetch,
  ) {
    const folder = project.tracker.stateStore;
    if (!folder) throw new TypeError("Expected a stateStore container.");
    const location = new URL(requireHttp(folder));
    if (
      location.href !== folder ||
      location.search ||
      location.hash ||
      !folder.endsWith("/") ||
      !isDirectChild(task.url, folder) ||
      task.task.id !== `${task.url}#it`
    )
      throw new TypeError("Invalid comment task.");
    this.container = `${folder}comments/`;
    this.target = task.task.id;
    this.io = new RdfIO(http);
    requireHttp(webId);
  }
  private location(url: string) {
    if (!isDirectChild(url, this.container) || !url.endsWith(".ttl"))
      throw new TypeError("Invalid comment location.");
  }
  private async read(url: string) {
    this.location(url);
    const resource = await this.io.read(url);
    const comment = readComment(resource);
    if (
      comment.kind === "root" ? comment.target !== this.target : !this.replyTarget(comment.target)
    )
      throw new TypeError("Invalid comment target.");
    return { ...resource, comment };
  }
  private replyTarget(target: string) {
    return (
      target.endsWith("#it") &&
      isDirectChild(target.slice(0, -3), this.container) &&
      target.endsWith(".ttl#it")
    );
  }
  async list(): Promise<TaskCommentThread[]> {
    const entries: TaskComment[] = [];
    for (const url of await this.io.list(this.container)) {
      if (!isDirectChild(url, this.container) || !url.endsWith(".ttl")) continue;
      try {
        entries.push((await this.read(url)).comment);
      } catch {
        // Untrusted, inaccessible or disappearing resources do not break other threads.
      }
    }
    return entries
      .filter((entry) => entry.kind === "root")
      .sort(oldest)
      .map((root) => ({
        root,
        replies: entries
          .filter((entry) => entry.kind === "reply" && entry.target === root.id)
          .sort(oldest),
      }));
  }
  async create(value: string, creator = this.webId, now = new Date()): Promise<TaskComment> {
    return this.publish(value, creator, this.target, "root", now);
  }
  async reply(root: TaskComment, value: string, creator = this.webId, now = new Date()) {
    const current = (await this.read(root.url)).comment;
    if (current.kind !== "root") throw new TypeError("Invalid reply target.");
    return this.publish(value, creator, current.id, "reply", now);
  }
  private async publish(
    value: string,
    creator: string,
    target: string,
    kind: "root" | "reply",
    now: Date,
  ) {
    if (creator !== this.webId)
      throw new TypeError("The comment creator must be the signed-in account.");
    if (!value.trim()) throw new TypeError("Enter a comment.");
    const url = `${this.container}${crypto.randomUUID()}.ttl`;
    const dataset = new Store();
    const annotation = node(`${url}#it`, dataset);
    annotation.types.add(`${OA}Annotation`);
    annotation.setIri(`${OA}motivatedBy`, `${OA}${kind === "root" ? "commenting" : "replying"}`);
    annotation.setIri(`${OA}hasTarget`, target);
    annotation.setIri(`${NS.DCT}creator`, creator);
    annotation.setDate(`${NS.DCT}created`, now);
    const body = annotation.child();
    annotation.nodes(`${OA}hasBody`).add(body);
    body.types.add(`${OA}TextualBody`);
    body.setText(`${NS.RDF}value`, value.trim());
    body.setText(FORMAT, "text/plain");
    await this.io.container(this.container);
    return readComment(await this.io.write(url, dataset, { create: true }));
  }
  private async own(entry: TaskComment) {
    const current = await this.read(entry.url);
    if (current.comment.kind === "reply") {
      const parent = (await this.read(current.comment.target.slice(0, -3))).comment;
      if (parent.kind !== "root") throw new TypeError("Invalid reply target.");
    }
    if (current.comment.creator !== this.webId)
      throw new TypeError("You can only edit or delete your own comments.");
    if (current.etag !== entry.etag) throw new ModelError(412, entry.url, current.etag);
    return current;
  }
  async edit(entry: TaskComment, value: string, now = new Date()) {
    const current = await this.own(entry);
    if (!value.trim() || current.comment.deleted) throw new TypeError("Enter a comment.");
    await this.replaceBody(current, value.trim(), now);
  }
  private async replaceBody(
    current: Awaited<ReturnType<TaskCommentStore["own"]>>,
    value: string,
    now: Date,
    deleted = false,
  ) {
    const annotation = node(current.comment.id, current.dataset);
    only(annotation, `${OA}hasBody`).setText(`${NS.RDF}value`, value);
    annotation.setDate(`${NS.DCT}modified`, now);
    if (deleted) annotation.setDate(`${NS.PROV}invalidatedAtTime`, now);
    await this.io.write(current.url, current.dataset, { etag: current.etag });
  }
  async delete(entry: TaskComment, now = new Date()) {
    const current = await this.own(entry);
    if (
      current.comment.kind === "root" &&
      (await this.list()).some(({ root, replies }) => root.url === entry.url && replies.length > 0)
    )
      await this.replaceBody(current, DELETED_COMMENT, now, true);
    else await this.io.remove(entry.url, current.etag);
  }
}
