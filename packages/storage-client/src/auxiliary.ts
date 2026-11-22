// AUTHORED-BY Codex GPT-6
import { isAuxiliaryResourceTarget } from "@jeswr/storage-capabilities";
import { ACP, SOLID } from "@jeswr/storage-capabilities/vocab";
import { mediaTypeOf } from "./http.js";
import type { ReadResult } from "./types.js";

type Observation = Pick<ReadResult, "url" | "links" | "metadataUrl" | "contentType">;
const AUXILIARY_LINKS = new Set([
  "acl",
  "acr",
  "auxiliary",
  "describedby",
  "linkset",
  "metadata",
  ACP.accessControl.toLowerCase(),
  SOLID.storageDescription.toLowerCase(),
]);
const REVERSE_LINKS = new Set(["acl-of", "acr-of", "describes", "metadata-for"]);
const AUXILIARY_TYPES = new Set([
  "http://www.w3.org/ns/auth/acl#Authorization",
  "http://www.w3.org/ns/solid/acp#AccessControlResource",
  "http://www.w3.org/ns/solid/terms#AuxiliaryResource",
  "https://www.w3.org/ns/lws#Linkset",
]);

/** Normalize URL spelling for comparison without changing the URL sent to storage. */
function identity(url: string): string {
  // Unreserved encodings can alias the same resource on the server.
  const document = new URL(url);
  document.hash = "";
  return document.href.replace(/%[a-f0-9]{2}/gi, (encoded) => {
    const character = String.fromCharCode(Number.parseInt(encoded.slice(1), 16));
    return /^[a-z0-9._~-]$/i.test(character) ? character : encoded.toUpperCase();
  });
}

/** Recognize known auxiliary destinations from their URL and available HTTP observations. */
export function isAuxiliaryResource(url: string, ...observations: Observation[]): boolean {
  const target = identity(url);
  if (new URL(url).pathname.split("/").some(isAuxiliaryResourceTarget)) return true;
  const same = (value: string) => URL.canParse(value) && identity(value) === target;
  return observations.some((observation) => {
    const own = same(observation.url);
    if (observation.metadataUrl !== null && same(observation.metadataUrl)) return true;
    if (own && /^application\/linkset(?:\+json)?$/.test(mediaTypeOf(observation.contentType) ?? ""))
      return true;
    for (const [relation, links] of observation.links) {
      const rel = relation
        .toLowerCase()
        .replace(/^https?:\/\/www\.iana\.org\/assignments\/relation\//, "");
      if (AUXILIARY_LINKS.has(rel) && links.some((link) => same(link.target))) return true;
      if (own && REVERSE_LINKS.has(rel)) return true;
      if (own && rel === "type" && links.some((link) => AUXILIARY_TYPES.has(link.target)))
        return true;
    }
    return false;
  });
}
