// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, refuseRedirects } from "@jeswr/guarded-fetch";
import { LiteralAs, LiteralFrom, OptionalAs, OptionalFrom } from "@rdfjs/wrapper";
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { isDirectChild } from "../../../docs/lib/model/layout";
import { deleteRdf, readRdf, writeRdf } from "../../../docs/lib/model/rdf-io";
import { DCT, OA, PD, RDF_TYPE } from "../../../docs/lib/model/vocab";
import { httpIri, SheetResource, workbookLayout } from "../model/rdf";
import { type CellAnchor, formatCellSelector, parseCellSelector } from "./selector";

const ANNOTATION = "http://www.w3.org/ns/oa#";
const HAS_BODY = `${ANNOTATION}hasBody`;
const TEXTUAL_BODY = `${ANNOTATION}TextualBody`;
const FRAGMENT = `${ANNOTATION}FragmentSelector`;
const VALUE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#value";
// Reuse Docs' resolved vocabulary; selector provenance is Sheets-specific.
const DELETED = "https://jeswr.org/ns/sheets#cellDeleted";
const WORKBOOK_REVISION = "https://jeswr.org/ns/sheets#workbookRevision";
export const MAX_COMMENT_LENGTH = 10_000;
export interface CellComment {
  url: string;
  etag: string | null;
  creator: string;
  /** Resource-specific user Write hint; creator is only a claim. */
  writable: boolean;
  created: string;
  modified: string;
  text: string;
  target: string;
  anchor?: CellAnchor;
  /** workbook.json ETag against which the immutable creation selector was written. */
  workbookRevision?: string | undefined;
  resolved: boolean;
}
export interface CellThread {
  root: CellComment;
  replies: CellComment[];
}
export interface CommentPermissions {
  append: boolean;
  write: boolean;
}

function userModes(headers: Headers): string[] {
  return (
    /(?:^|,)\s*user\s*=\s*"([^"]*)"/i.exec(headers.get("wac-allow") ?? "")?.[1]?.split(/\s+/) ?? []
  );
}
function body(text: string): string {
  if (!text.trim() || text.length > MAX_COMMENT_LENGTH)
    throw new Error("Enter a comment of 1–10,000 characters.");
  return text.trim();
}
function date(node: SheetResource, predicate: string): string {
  const value = OptionalFrom.subjectPredicate(node, predicate, LiteralAs.date);
  if (!value || !Number.isFinite(value.getTime())) throw new Error("Invalid comment date");
  return value.toISOString();
}
function boolean(node: SheetResource, predicate: string): boolean {
  return OptionalFrom.subjectPredicate(node, predicate, LiteralAs.boolean) ?? false;
}
function stamp(node: SheetResource, predicate: string, value: string) {
  OptionalAs.object(node, predicate, new Date(value), LiteralFrom.dateTime);
}

/** Docs' per-annotation layout and I/O, with a cell-specific target and TextualBody. */
export class CellCommentStore {
  readonly container: string;
  readonly workbook: string;
  private readonly http: typeof fetch;
  constructor(container: string, transport: typeof fetch) {
    const layout = workbookLayout(container);
    this.container = `${layout.container}comments/`;
    this.workbook = layout.subject;
    const http = refuseRedirects(transport);
    this.http = (input, init) => {
      assertWithinPodScope(layout.container, String(input));
      return http(input, init);
    };
  }
  private location(url: string) {
    if (!isDirectChild(url, this.container) || !url.endsWith(".ttl"))
      throw new Error("Invalid comment location");
  }
  private async read(
    url: string,
  ): Promise<{ dataset: Awaited<ReturnType<typeof readRdf>>["dataset"]; comment: CellComment }> {
    this.location(url);
    const { dataset, etag, headers } = await readRdf(url, this.http);
    const node = new SheetResource(url, dataset, DataFactory);
    const motivation = node.iri(OA.motivatedBy);
    const target = node.iri(OA.hasTarget);
    const bodyNode = node.iri(HAS_BODY);
    const creator = node.iri(DCT.creator);
    if (
      node.iri(RDF_TYPE) !== OA.Annotation ||
      !target ||
      bodyNode !== `${url}#body` ||
      !creator ||
      (motivation !== OA.commenting && motivation !== OA.replying)
    )
      throw new Error("Malformed comment");
    httpIri(creator);
    const textual = new SheetResource(bodyNode, dataset, DataFactory);
    if (textual.iri(RDF_TYPE) !== TEXTUAL_BODY) throw new Error("Malformed comment body");
    const text = textual.text(VALUE);
    if (text === undefined) throw new Error("Missing comment body");
    body(text);
    let source = target;
    let anchor: CellAnchor | undefined;
    if (motivation === OA.commenting) {
      if (target !== `${url}#target`) throw new Error("Invalid comment target");
      const specific = new SheetResource(target, dataset, DataFactory);
      source = specific.iri(OA.hasSource) as string;
      if (source !== this.workbook || specific.iri(OA.hasSelector) !== `${url}#cell`)
        throw new Error("Foreign comment target");
      const selector = new SheetResource(`${url}#cell`, dataset, DataFactory);
      if (selector.iri(RDF_TYPE) !== FRAGMENT) throw new Error("Invalid cell selector");
      anchor = {
        ...parseCellSelector(selector.text(VALUE) as string),
        deleted: boolean(node, DELETED),
      };
    } else this.location(target);
    return {
      dataset,
      comment: {
        url,
        etag,
        creator,
        writable: userModes(headers).includes("write"),
        created: date(node, DCT.created),
        modified: date(node, DCT.modified),
        text,
        target: source,
        ...(anchor ? { anchor, workbookRevision: node.text(WORKBOOK_REVISION) } : {}),
        resolved: boolean(node, PD.resolved),
      },
    };
  }
  async permissions(): Promise<CommentPermissions> {
    let response = await this.http(this.container, { method: "HEAD", cache: "no-store" });
    if (response.status === 404)
      response = await this.http(new URL("../", this.container).href, {
        method: "HEAD",
        cache: "no-store",
      });
    const modes = response.ok ? userModes(response.headers) : [];
    return {
      append: modes.includes("append") || modes.includes("write"),
      write: modes.includes("write"),
    };
  }
  async list(): Promise<CellThread[]> {
    let listing: Awaited<ReturnType<typeof readRdf>>;
    try {
      listing = await readRdf(this.container, this.http);
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return [];
      throw error;
    }
    const entries: CellComment[] = [];
    for (const child of new Container(this.container, listing.dataset, DataFactory).contains) {
      if (!isDirectChild(child.id, this.container) || !child.id.endsWith(".ttl")) continue;
      try {
        entries.push((await this.read(child.id)).comment);
      } catch {
        /* Isolate hostile, missing or inaccessible children. */
      }
    }
    const order = (a: CellComment, b: CellComment) =>
      a.created.localeCompare(b.created) || a.url.localeCompare(b.url);
    return entries
      .filter((entry) => entry.anchor)
      .sort(order)
      .map((root) => ({
        root,
        replies: entries.filter((entry) => !entry.anchor && entry.target === root.url).sort(order),
      }));
  }
  private async ensureContainer() {
    const response = await this.http(this.container, { method: "HEAD" });
    if (response.ok) return;
    if (response.status !== 404) throw new Error("Couldn't access comments.");
    const dataset = new Store();
    new SheetResource(this.container, dataset, DataFactory).types.add(
      "http://www.w3.org/ns/ldp#BasicContainer",
    );
    try {
      await writeRdf(this.container, dataset, { fetchImpl: this.http, createOnly: true });
    } catch (error) {
      if (!(error instanceof Error && "status" in error && error.status === 412)) throw error;
    }
  }
  async create(
    text: string,
    creator: string,
    anchor: CellAnchor,
    now = new Date(),
    workbookRevision?: string,
  ): Promise<CellComment> {
    formatCellSelector(anchor);
    if (anchor.deleted) throw new Error("Cell deleted");
    return this.publish(text, creator, this.workbook, anchor, now, workbookRevision);
  }
  async reply(
    root: CellComment,
    text: string,
    creator: string,
    now = new Date(),
  ): Promise<CellComment> {
    const { comment } = await this.read(root.url);
    if (!comment.anchor) throw new Error("Invalid reply target");
    return this.publish(text, creator, root.url, undefined, now);
  }
  private async publish(
    text: string,
    creator: string,
    target: string,
    anchor: CellAnchor | undefined,
    now: Date,
    workbookRevision?: string,
  ) {
    const comment: CellComment = {
      url: `${this.container}${crypto.randomUUID()}.ttl`,
      etag: null,
      text: body(text),
      creator: httpIri(creator),
      writable: false,
      created: now.toISOString(),
      modified: now.toISOString(),
      target,
      ...(anchor ? { anchor, workbookRevision } : {}),
      resolved: false,
    };
    const dataset = new Store();
    const node = new SheetResource(comment.url, dataset, DataFactory);
    node.types.add(OA.Annotation);
    node.setIri(OA.motivatedBy, anchor ? OA.commenting : OA.replying);
    node.setIri(DCT.creator, creator);
    stamp(node, DCT.created, comment.created);
    stamp(node, DCT.modified, comment.modified);
    node.setIri(HAS_BODY, `${comment.url}#body`);
    const textual = new SheetResource(`${comment.url}#body`, dataset, DataFactory);
    textual.types.add(TEXTUAL_BODY);
    textual.setText(VALUE, comment.text);
    if (anchor) {
      if (workbookRevision) node.setText(WORKBOOK_REVISION, workbookRevision);
      node.setIri(OA.hasTarget, `${comment.url}#target`);
      const specific = new SheetResource(`${comment.url}#target`, dataset, DataFactory);
      specific.types.add(`${ANNOTATION}SpecificResource`);
      specific.setIri(OA.hasSource, target);
      specific.setIri(OA.hasSelector, `${comment.url}#cell`);
      const selector = new SheetResource(`${comment.url}#cell`, dataset, DataFactory);
      selector.types.add(FRAGMENT);
      selector.setText(VALUE, formatCellSelector(anchor));
    } else node.setIri(OA.hasTarget, target);
    await this.ensureContainer();
    return {
      ...comment,
      ...(await writeRdf(comment.url, dataset, { fetchImpl: this.http, createOnly: true })),
    };
  }
  private own(comment: CellComment, actor: string) {
    if (comment.creator !== actor)
      throw new Error("You can only edit or delete your own comments.");
    if (!comment.writable) throw new Error("You need Write access to this comment resource.");
  }
  private async update(
    entry: CellComment,
    change: (node: SheetResource, comment: CellComment) => void,
    now: Date,
  ) {
    const { dataset, comment } = await this.read(entry.url);
    if (!comment.writable) throw new Error("You need Write access to this comment resource.");
    change(new SheetResource(entry.url, dataset, DataFactory), comment);
    stamp(new SheetResource(entry.url, dataset, DataFactory), DCT.modified, now.toISOString());
    await writeRdf(entry.url, dataset, { fetchImpl: this.http, etag: entry.etag });
  }
  async edit(entry: CellComment, text: string, actor: string, now = new Date()) {
    await this.update(
      entry,
      (node, comment) => {
        this.own(comment, actor);
        new SheetResource(`${entry.url}#body`, node.dataset, DataFactory).setText(
          VALUE,
          body(text),
        );
      },
      now,
    );
  }
  async resolve(entry: CellComment, resolved: boolean, now = new Date()) {
    await this.update(
      entry,
      (node, comment) => {
        if (!comment.anchor) throw new Error("Invalid thread");
        OptionalAs.object(node, PD.resolved, resolved, LiteralFrom.boolean);
      },
      now,
    );
  }
  async delete(entry: CellComment, actor: string) {
    this.own((await this.read(entry.url)).comment, actor);
    // Keep others' replies; without a root they are hidden, as in Docs.
    await deleteRdf(entry.url, this.http, entry.etag);
  }
}
