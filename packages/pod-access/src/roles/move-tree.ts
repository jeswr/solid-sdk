// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@jeswr/fetch-rdf";
import { type StorageClient, StorageError } from "@jeswr/storage-client";

// Same media-type grammar as storage-client's private Solid write helper.
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const MEDIA = new RegExp(
  `^${TOKEN}/${TOKEN}(?:[ \\t]*;[ \\t]*${TOKEN}=(?:${TOKEN}|"(?:[\\t !#-\\[\\]-~\\x80-\\xff]|\\\\[\\t -~\\x80-\\xff])*"))*[ \\t]*$`,
);
export function sourceType(value: string | null, url: string): string {
  if (value === null || value.trim() !== value || !MEDIA.test(value))
    throw new StorageError("invalid-response", {
      url,
      method: "GET",
      message: "Invalid source Content-Type",
    });
  return value;
}

export function moveError(
  url: string,
  message: string,
  code: "unsupported" | "conflict" = "unsupported",
) {
  return new StorageError(code, { url, method: "MOVE", feature: "move", message });
}
export function strongEtag(value: string | null, url: string): string {
  if (value === null || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value))
    throw new StorageError("precondition-required", {
      url,
      method: "MOVE",
      message: "Move requires a strong ETag",
    });
  return value;
}
export function parent(url: string): string {
  return new URL(url.endsWith("/") ? ".." : ".", url).href;
}
export function exactName(url: string): string {
  const segment = url.slice(parent(url).length).replace(/\/$/, "");
  // Public create accepts decoded names only, unlike storage-client's private createExact.
  // Refuse names it cannot reproduce exactly, before creating a placeholder.
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    throw moveError(url, "Name is not UTF-8");
  }
  if (encodeURIComponent(name) !== segment)
    throw moveError(url, "Public create cannot preserve this encoded name exactly");
  return name;
}
// The storage-client allow-list is private. Mirror it here using public readRdf/listAll;
// no arbitrary container RDF or describedby metadata can silently disappear in the copy.
export function checkContainerRdf(url: string, dataset: DatasetCore, members: readonly string[]) {
  const ldp = "http://www.w3.org/ns/ldp#";
  const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const subjects = new Set([url, ...members]);
  for (const q of dataset) {
    if (q.predicate.value === `${ldp}contains`) continue;
    if (
      q.subject.termType === "NamedNode" &&
      members.includes(q.subject.value) &&
      q.predicate.value === rdfType &&
      q.object.termType === "NamedNode" &&
      q.object.value.startsWith("http://www.w3.org/ns/iana/media-types/") &&
      q.object.value.endsWith("#Resource")
    )
      continue;
    if (
      q.subject.termType === "NamedNode" &&
      subjects.has(q.subject.value) &&
      (q.predicate.value === "http://purl.org/dc/terms/modified" ||
        q.predicate.value.startsWith("http://www.w3.org/ns/posix/stat#") ||
        (q.predicate.value === rdfType &&
          q.object.termType === "NamedNode" &&
          (q.object.value.startsWith(ldp) ||
            q.object.value === "http://www.w3.org/ns/pim/space#Storage")))
    )
      continue;
    throw moveError(url, "Container RDF would not be preserved by an emulated move");
  }
}
export async function emptyContainerEtag(storage: StorageClient, url: string): Promise<string> {
  for await (const _entry of storage.listAll(url))
    throw moveError(url, "Container acquired or retained members", "conflict");
  const read = await storage.readRdf(url);
  checkContainerRdf(url, read.dataset, []);
  // listAll and readRdf are separate reads; also reject membership appearing between them.
  if ([...read.dataset].some((q) => q.predicate.value === "http://www.w3.org/ns/ldp#contains"))
    throw moveError(url, "Container acquired members", "conflict");
  return strongEtag(read.etag, url);
}
