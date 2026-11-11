// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { ResourceWriteError } from "./errors";
import { isDirectChild } from "./layout";
import { deleteRdf, readRdf, writeRdf } from "./rdf-io";
import { DCT, OA, PD, RDF_TYPE } from "./vocab";

export interface CommentAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  start: string;
  end: string;
}
export interface DocumentComment {
  url: string;
  etag: string | null;
  text: string;
  creator: string;
  created: string;
  target: string;
  kind: "root" | "reply";
  anchor?: CommentAnchor | undefined;
  resolved: boolean;
}
export interface CommentThread {
  root: DocumentComment;
  replies: DocumentComment[];
}
const changed = () => new Error("This comment changed; try again.");
/** Quote context kept per side (capture stores 32 code points). */
const CONTEXT = 32;
const MAX_QUOTE = 10_000;
const MAX_POSITION = 1_024;

class Annotation extends TermWrapper {
  string(predicate: string) {
    return OptionalFrom.subjectPredicate(this, predicate, LiteralAs.string);
  }
  iri(predicate: string) {
    return OptionalFrom.subjectPredicate(this, predicate, NamedNodeAs.string);
  }
  literal(predicate: string, value: string | undefined) {
    OptionalAs.object(this, predicate, value, LiteralFrom.string);
  }
  link(predicate: string, value: string) {
    OptionalAs.object(this, predicate, value, NamedNodeFrom.string);
  }
  read(url: string, etag: string | null): DocumentComment {
    const motivation = this.iri(OA.motivatedBy);
    const text = this.string(OA.bodyValue);
    const creator = this.iri(DCT.creator);
    const created = OptionalFrom.subjectPredicate(this, DCT.created, LiteralAs.date);
    const target = this.iri(OA.hasTarget);
    if (
      this.iri(RDF_TYPE) !== OA.Annotation ||
      !text?.trim() ||
      !creator ||
      !created ||
      !Number.isFinite(created.getTime()) ||
      !target ||
      (motivation !== OA.commenting && motivation !== OA.replying)
    )
      throw new Error("Malformed comment");
    const root = motivation === OA.commenting;
    let anchor: CommentAnchor | undefined;
    let source = target;
    if (root) {
      const node = new Annotation(target, this.dataset, DataFactory);
      const selector = node.iri(OA.hasSelector);
      source = node.iri(OA.hasSource) as string;
      const quote = new Annotation(selector as string, this.dataset, DataFactory);
      const exact = quote.string(OA.exact);
      const prefix = quote.string(OA.prefix);
      const suffix = quote.string(OA.suffix);
      const start = this.string(PD.anchorStart);
      const end = this.string(PD.anchorEnd);
      if (
        !source ||
        !selector ||
        quote.iri(RDF_TYPE) !== OA.TextQuoteSelector ||
        !exact ||
        prefix === undefined ||
        suffix === undefined ||
        !start ||
        !end
      )
        throw new Error("Malformed comment anchor");
      // Other users write these: bound them so anchor resolution stays cheap.
      if (exact.length > MAX_QUOTE || start.length > MAX_POSITION || end.length > MAX_POSITION)
        throw new Error("Malformed comment anchor");
      anchor = {
        exact,
        prefix: Array.from(prefix).slice(-CONTEXT).join(""),
        suffix: Array.from(suffix).slice(0, CONTEXT).join(""),
        start,
        end,
      };
    }
    return {
      url,
      etag,
      text,
      creator,
      created: created.toISOString(),
      target: source,
      kind: root ? "root" : "reply",
      anchor,
      resolved: OptionalFrom.subjectPredicate(this, PD.resolved, LiteralAs.boolean) ?? false,
    };
  }
  write(comment: DocumentComment) {
    this.link(RDF_TYPE, OA.Annotation);
    this.link(OA.motivatedBy, comment.kind === "root" ? OA.commenting : OA.replying);
    this.literal(OA.bodyValue, comment.text);
    this.link(DCT.creator, comment.creator);
    OptionalAs.object(this, DCT.created, new Date(comment.created), LiteralFrom.dateTime);
    const anchor = comment.anchor;
    if (anchor) {
      this.link(OA.hasTarget, `${comment.url}#target`);
      this.literal(PD.anchorStart, anchor.start);
      this.literal(PD.anchorEnd, anchor.end);
      const target = new Annotation(`${comment.url}#target`, this.dataset, DataFactory);
      target.link(OA.hasSource, comment.target);
      target.link(OA.hasSelector, `${comment.url}#quote`);
      const quote = new Annotation(`${comment.url}#quote`, this.dataset, DataFactory);
      quote.link(RDF_TYPE, OA.TextQuoteSelector);
      quote.literal(OA.exact, anchor.exact);
      quote.literal(OA.prefix, anchor.prefix);
      quote.literal(OA.suffix, anchor.suffix);
    } else this.link(OA.hasTarget, comment.target);
  }
}

/** One Web Annotation per direct Turtle child; all mutations retain validators. */
export class DocumentCommentStore {
  constructor(
    readonly container: string,
    readonly document: string,
    private readonly http: typeof fetch,
  ) {}
  private location(url: string) {
    if (!isDirectChild(url, this.container) || !url.endsWith(".ttl"))
      throw new Error("Invalid comment location");
  }
  private async read(url: string) {
    this.location(url);
    const result = await readRdf(url, this.http);
    return {
      ...result,
      comment: new Annotation(url, result.dataset, DataFactory).read(url, result.etag),
    };
  }
  async list(
    position: (comment: DocumentComment) => number | undefined = () => undefined,
  ): Promise<CommentThread[]> {
    let listing: Awaited<ReturnType<typeof readRdf>>;
    try {
      listing = await readRdf(this.container, this.http);
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return [];
      throw error;
    }
    const entries: DocumentComment[] = [];
    for (const child of new Container(this.container, listing.dataset, DataFactory).contains) {
      const url = child.id;
      if (!isDirectChild(url, this.container) || !url.endsWith(".ttl")) continue;
      try {
        const { comment } = await this.read(url);
        if (
          comment.kind === "root"
            ? comment.target === this.document
            : isDirectChild(comment.target, this.container)
        )
          entries.push(comment);
      } catch {
        /* Isolate malformed, inaccessible and disappearing children. */
      }
    }
    return entries
      .filter((entry) => entry.kind === "root")
      .map((root) => ({
        root,
        replies: entries
          .filter((entry) => entry.kind === "reply" && entry.target === root.url)
          .sort((a, b) => a.created.localeCompare(b.created) || a.url.localeCompare(b.url)),
      }))
      .sort(
        (a, b) =>
          (position(a.root) ?? Number.MAX_SAFE_INTEGER) -
            (position(b.root) ?? Number.MAX_SAFE_INTEGER) ||
          a.root.created.localeCompare(b.root.created) ||
          a.root.url.localeCompare(b.root.url),
      );
  }
  async create(text: string, creator: string, anchor: CommentAnchor, now = new Date()) {
    return this.publish(text, creator, this.document, anchor, now);
  }
  async reply(root: DocumentComment, text: string, creator: string, now = new Date()) {
    const current = (await this.read(root.url)).comment;
    if (current.kind !== "root" || current.target !== this.document)
      throw new Error("Invalid reply target");
    return this.publish(text, creator, root.url, undefined, now);
  }
  private async publish(
    text: string,
    creator: string,
    target: string,
    anchor: CommentAnchor | undefined,
    now: Date,
  ) {
    if (!text.trim()) throw new Error("Enter a comment.");
    const comment: DocumentComment = {
      url: `${this.container}${crypto.randomUUID()}.ttl`,
      etag: null,
      text: text.trim(),
      creator,
      created: now.toISOString(),
      target,
      kind: anchor ? "root" : "reply",
      anchor,
      resolved: false,
    };
    const dataset = new Store();
    new Annotation(comment.url, dataset, DataFactory).write(comment);
    const { etag } = await writeRdf(comment.url, dataset, {
      fetchImpl: this.http,
      createOnly: true,
    });
    return { ...comment, etag };
  }
  async setResolved(
    root: DocumentComment,
    resolved: boolean,
    actor: string,
    now = new Date(),
  ): Promise<void> {
    const attempt = async () => {
      const { dataset, etag, comment } = await this.read(root.url);
      if (comment.kind !== "root" || comment.target !== this.document)
        throw new Error("Invalid comment target");
      const node = new Annotation(root.url, dataset, DataFactory);
      OptionalAs.object(node, PD.resolved, resolved ? true : undefined, LiteralFrom.boolean);
      OptionalAs.object(node, PD.resolvedBy, resolved ? actor : undefined, NamedNodeFrom.string);
      OptionalAs.object(node, PD.resolvedAt, resolved ? now : undefined, LiteralFrom.dateTime);
      await writeRdf(root.url, dataset, { fetchImpl: this.http, etag });
    };
    try {
      await attempt();
    } catch (error) {
      if (!(error instanceof ResourceWriteError && error.status === 412)) throw error;
      try {
        await attempt();
      } catch (retry) {
        if (retry instanceof ResourceWriteError && retry.status === 412) throw changed();
        throw retry;
      }
    }
  }
  private own(comment: DocumentComment, actor: string) {
    if (comment.creator !== actor)
      throw new Error("You can only edit or delete your own comments.");
  }
  async edit(entry: DocumentComment, text: string, actor: string) {
    const { dataset, comment } = await this.read(entry.url);
    this.own(comment, actor);
    if (!text.trim()) throw new Error("Enter a comment.");
    new Annotation(entry.url, dataset, DataFactory).literal(OA.bodyValue, text.trim());
    await writeRdf(entry.url, dataset, { fetchImpl: this.http, etag: entry.etag });
  }
  private async remove(entry: DocumentComment) {
    this.location(entry.url);
    await deleteRdf(entry.url, this.http, entry.etag);
  }
  async delete(entry: DocumentComment, actor: string) {
    const { comment } = await this.read(entry.url);
    this.own(comment, actor);
    if (comment.etag !== entry.etag) throw changed();
    const thread =
      comment.kind === "root"
        ? (await this.list()).find(({ root }) => root.url === entry.url)
        : undefined;
    // The root goes first and conditionally: if it changed meanwhile, nothing is
    // deleted. Replies follow best effort; list() already hides orphaned replies.
    await this.remove(entry);
    if (thread) await Promise.allSettled(thread.replies.map((reply) => this.remove(reply)));
  }
}
export function commentError(error: unknown): string {
  if (error instanceof Error && "status" in error) {
    if (error.status === 401 || error.status === 403)
      return "You don't have permission to comment on this document.";
    if (error.status === 412) return changed().message;
  }
  return error instanceof Error
    ? error.message
    : "Couldn't load comments. Try again when connected.";
}
export function commentDisabledReason(saved: boolean, online: boolean): string | undefined {
  if (!saved) return "Save this document to your pod before commenting.";
  if (!online) return "Reconnect to comment on this document.";
  return undefined;
}
