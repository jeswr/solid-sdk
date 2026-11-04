// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { extractMediaType, RdfFetchError, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { NS } from "@jeswr/suite-vocab";
import type { Term } from "@rdfjs/types";
import { TermAs } from "@rdfjs/wrapper";
import { classificationForType, classifySubject } from "../../lib/model/classify";
import { type DomainItem, nameFromUrl } from "../../lib/model/discovery";
import {
  inStorage,
  parseResource,
  primarySubject,
  readResource,
  subjectOf,
} from "../../lib/model/rdf";
import type { AgentRow } from "../../lib/permissions";
import type { HomeSession } from "../../state/use-domain-items";

export class ItemReadError extends Error {
  constructor(readonly status: number) {
    super("Couldn't open this item");
  }
}
export interface ItemRead {
  item: DomainItem;
  body: string | Uint8Array<ArrayBuffer>;
  binary?: boolean;
  contentType: string;
  writable: boolean;
  size: number;
}
export function isContainer(item: DomainItem): boolean {
  return (
    item.url.endsWith("/") ||
    subjectOf(item.dataset, item.subject).types.some((type) =>
      [`${NS.LDP}Container`, `${NS.LDP}BasicContainer`, `${NS.POD_DRIVE}DriveRoot`].includes(type),
    ) ||
    subjectOf(item.dataset, item.subject).contains.length > 0
  );
}
export function canWrite(url: string, storage: string, wac: string | null): boolean {
  if (wac !== null)
    return /\bwrite\b/i.test(/(?:^|,)\s*user\s*=\s*"([^"]*)"/i.exec(wac)?.[1] ?? "");
  return inStorage(url, storage);
}
export async function readItem(
  session: HomeSession,
  url: string,
  subject?: string | Term,
  signal?: AbortSignal,
): Promise<ItemRead> {
  const target = assertWithinPodScope(session.storageUrl, url);
  const response = await session.fetch(target, {
    redirect: "error",
    ...(signal ? { signal } : {}),
    headers: { accept: "text/turtle", "cache-control": "no-cache" },
  });
  if (!response.ok) throw new ItemReadError(response.status);
  const contentType = response.headers.get("content-type") ?? "text/turtle";
  const binary = !SUPPORTED_RDF_MEDIA_TYPES.some((type) => type === extractMediaType(contentType));
  const bytes = new Uint8Array(await response.arrayBuffer());
  const body = binary ? bytes : new TextDecoder().decode(bytes);
  const dataset = binary
    ? (await readResource(session.fetch, new URL(".", target).href, signal)).dataset
    : await parseResource(body as string, contentType, target);
  const node = binary
    ? subjectOf(dataset, target)
    : subject && (typeof subject === "string" || subject.termType !== "BlankNode")
      ? subjectOf(dataset, subject)
      : primarySubject(dataset, target);
  if (!node || ![...dataset].some((quad) => quad.subject.equals(TermAs.term(node))))
    throw new ItemReadError(404);
  return {
    item: {
      ...(binary ? classificationForType("files") : classifySubject(node, session.webId)),
      url: target,
      subject: TermAs.term(node),
      dataset,
      etag: response.headers.get("etag"),
      title: node.name ?? nameFromUrl(target),
      containerUrl: new URL(".", target).href,
      ...(node.modified ? { modified: node.modified } : {}),
    },
    body,
    ...(binary ? { binary: true } : {}),
    contentType,
    writable: canWrite(target, session.storageUrl, response.headers.get("wac-allow")),
    size: bytes.byteLength,
  };
}
/**
 * The WebID profile when it lives outside this storage (an identity provider's host).
 * Read it as the domain store does — public, credential-free, no redirects — never with
 * the storage's authenticated transport. Home can't edit it there, so it is read-only.
 */
export async function readExternalProfile(
  session: Pick<HomeSession, "webId" | "storageUrl">,
  subject?: string | Term,
  signal?: AbortSignal,
  publicFetch: typeof fetch = globalThis.fetch,
): Promise<ItemRead> {
  const url = session.webId.split("#")[0] as string;
  let read: Awaited<ReturnType<typeof readResource>>;
  try {
    read = await readResource(
      (input, init) => publicFetch(input, { ...init, credentials: "omit", redirect: "error" }),
      url,
      signal,
    );
  } catch (error) {
    throw new ItemReadError(error instanceof RdfFetchError ? (error.status ?? 500) : 500);
  }
  const node = subjectOf(
    read.dataset,
    subject && (typeof subject === "string" || subject.termType !== "BlankNode")
      ? subject
      : session.webId,
  );
  if (![...read.dataset].some((quad) => quad.subject.equals(TermAs.term(node))))
    throw new ItemReadError(404);
  return {
    item: {
      ...classifySubject(node, session.webId),
      url,
      subject: TermAs.term(node),
      dataset: read.dataset,
      etag: read.etag,
      title: node.name ?? nameFromUrl(url),
      containerUrl: new URL(".", url).href,
      ...(node.modified ? { modified: node.modified } : {}),
    },
    body: "",
    contentType: "text/turtle",
    writable: false,
    size: 0,
  };
}
/** Rows come from this resource’s effective policy; consent expiry is informational. */
export function accessSummary(rows: readonly AgentRow[], url: string, owner: string) {
  const relevant = rows.filter(
    (row) =>
      row.id !== owner &&
      row.lines.some((line) =>
        line.resources.some((resource) => resource.modes.includes("read") && resource.url === url),
      ),
  );
  const people = [
    ...new Map(
      relevant.filter((row) => row.kind === "person").map((row) => [row.id, row]),
    ).values(),
  ];
  return {
    text: relevant.some((row) => row.kind === "public")
      ? "Anyone with the link"
      : relevant.some((row) => row.kind === "authenticated")
        ? "Anyone signed in"
        : people.length
          ? `You and ${people.length} people`
          : "Only you",
    people,
    apps: relevant.filter((row) => row.kind === "app"),
  };
}
