// AUTHORED-BY Codex GPT-6.1-Sol
import { normalizePodBase, RedirectRefusedError, refuseRedirects } from "@jeswr/guarded-fetch";
import { decodeRef, encodeRef } from "@/lib/refs";
import { isDirectChild } from "../../docs/lib/model/layout";
import { readRdf } from "../../docs/lib/model/rdf-io";
import { parseNote } from "./model/note";
import type { StoredNote } from "./model/store";

export const noteHref = (url: string) => `/notes/n/${encodeRef(url)}`;
export class NoteLinkError extends Error {}
/** A shared note its reader can't open: anonymously ("private") or with their account. */
export class PrivateNoteError extends NoteLinkError {
  constructor(readonly reason: "private" | "denied") {
    super(
      reason === "private"
        ? "This note is private. You need access from its owner's pod to open it."
        : "Your account doesn't have access to this note. Ask its owner to share it with you.",
    );
  }
}

/** Same-origin foreign pods only, as in Sheets. Canonical direct note URLs, no auxiliaries. */
export function noteLink(reference: string, podRoot: string) {
  try {
    const resource = decodeRef(reference);
    const url = new URL(resource);
    const root = normalizePodBase(podRoot);
    if (
      ["notes/", "notes/archive/", "notes/.trash/"].some((path) =>
        isDirectChild(resource, new URL(path, root).href),
      )
    )
      return { url: resource, ownerRoot: root, foreign: false };
    if (
      url.origin !== new URL(podRoot).origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.includes("//") ||
      /[\\\s%]/.test(resource) ||
      !/\/notes\/(?:archive\/|\.trash\/)?[^/.][^/]*\.ttl$/.test(url.pathname) ||
      /\.(?:acl|acr)(?:\.|\/|$)/i.test(url.pathname)
    )
      throw new NoteLinkError();
    const at = url.pathname.lastIndexOf("/notes/");
    const ownerRoot = new URL(url.pathname.slice(0, at + 1), url.origin).href;
    return { url: resource, ownerRoot, foreign: ownerRoot !== new URL(podRoot).href };
  } catch {
    throw new NoteLinkError(
      "This note link isn't supported. Open a direct note link on your storage's origin.",
    );
  }
}

/**
 * Never a writer for another pod. Anonymous by default; `account` is the session's fetch,
 * used only after the reader granted it this note, and still view-only with no redirects.
 */
export async function readSharedNote(
  reference: string,
  podRoot: string,
  publicFetch: typeof fetch = globalThis.fetch,
  account?: typeof fetch,
): Promise<{ note: StoredNote; ownerRoot: string }> {
  const link = noteLink(reference, podRoot);
  const http = refuseRedirects(account ?? publicFetch);
  try {
    const { dataset, etag } = await readRdf(link.url, (input, init) =>
      http(input, { ...init, credentials: "omit" }),
    );
    const note = parseNote(link.url, dataset, "active");
    if (!note) throw new NoteLinkError("This shared note could not be read.");
    return {
      note: {
        ...note,
        etag,
        readOnly: true,
      },
      ownerRoot: link.ownerRoot,
    };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403)
      throw new PrivateNoteError(account ? "denied" : "private");
    if (
      error instanceof RedirectRefusedError ||
      (error as Error).cause instanceof RedirectRefusedError
    )
      throw new NoteLinkError(
        "This shared note redirects to another address. Open a direct note link.",
      );
    throw error;
  }
}
