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

/** Normalize escape spelling and decode RFC 3986 unreserved characters for comparison. */
export function normalizePercentEncoding(value: string): string {
  return value.replace(/%[a-f0-9]{2}/gi, (encoded) => {
    const character = String.fromCharCode(Number.parseInt(encoded.slice(1), 16));
    return /^[a-z0-9._~-]$/i.test(character) ? character : encoded.toUpperCase();
  });
}

function identity(url: string): string {
  const document = new URL(url);
  document.hash = "";
  return normalizePercentEncoding(document.href);
}

function normalizedLwsSegment(segment: string): string {
  const unpaddedStart = normalizePercentEncoding(segment).replace(/^(?:%20)+/, "");
  let end = unpaddedStart.length;
  while (unpaddedStart.endsWith("%20", end)) end -= 3;
  // A literal percent is safe when it cannot start a second round of percent decoding.
  return unpaddedStart.slice(0, end).replace(/%25(?![a-f0-9]{2})/gi, "%");
}

/** Screen LWS identifiers for auxiliary suffixes and ambiguous path syntax before HEAD. */
export function isUnsafeLwsCreatePath(url: string): boolean {
  return new URL(url).pathname.split("/").some((segment) => {
    // A server may trim segment padding. Check the resulting spelling for auxiliary
    // suffixes and traversal, including segments that would disappear completely.
    const normalized = normalizedLwsSegment(segment);
    return (
      (normalized === "" && segment !== "") ||
      /%(?:[01][a-f0-9]|7f)/i.test(normalized) ||
      isAuxiliaryResourceTarget(normalized)
    );
  });
}

/** Recognize known auxiliary destinations from their URL and available HTTP observations. */
export function isAuxiliaryResource(url: string, ...observations: Observation[]): boolean {
  if (new URL(url).pathname.split("/").some(isAuxiliaryResourceTarget)) return true;
  return hasAuxiliaryResourceEvidence(url, identity, observations);
}

/** Treat possible aliases as auxiliary when Link evidence identifies either spelling. */
export function hasLwsAuxiliaryResourceEvidence(
  url: string,
  ...observations: Observation[]
): boolean {
  return hasAuxiliaryResourceEvidence(
    url,
    (value) => {
      const document = new URL(value);
      document.pathname = document.pathname.split("/").map(normalizedLwsSegment).join("/");
      return identity(document.href);
    },
    observations,
  );
}

function hasAuxiliaryResourceEvidence(
  url: string,
  compareIdentity: (url: string) => string,
  observations: Observation[],
): boolean {
  const target = compareIdentity(url);
  const same = (value: string) => URL.canParse(value) && compareIdentity(value) === target;
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
