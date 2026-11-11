// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { isDirectChild } from "@jeswr/solid-docs/layout";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import { ResourceWriteError } from "./errors";
import { deleteRdf, readRdf, writeRdf } from "./rdf-io";

export type { CommentAnchor, CommentThread, DocumentComment } from "@jeswr/solid-docs/comments";

import {
  buildComment,
  type CommentAnchor,
  type CommentThread,
  type DocumentComment,
  readComment,
  setCommentResolution,
  setCommentText,
} from "@jeswr/solid-docs/comments";

const changed = () => new Error("This comment changed; try again.");
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
      comment: readComment(url, result.dataset, result.etag),
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
    const dataset = buildComment(comment);
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
      setCommentResolution(root.url, dataset, resolved, actor, now);
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
    setCommentText(entry.url, dataset, text.trim());
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
