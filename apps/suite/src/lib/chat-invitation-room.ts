// AUTHORED-BY Claude Opus 5.5
import { isWithinPodScope, normalizePodBase } from "@jeswr/guarded-fetch";
import { safeHttpIri } from "@jeswr/rdf-serialize";

/**
 * The room an inbox Offer names, shared by Chat and the always-loaded shell tray. It stays
 * free of Chat's model so the shell bundle does not load Chat's RDF interop.
 */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/$/;

function invalid(): never {
  throw new TypeError("Not a Chat room invitation target");
}
/** Lexical http(s) IRIs only: no rewriting, no userinfo. */
function httpUrl(value: string): URL {
  if (safeHttpIri(value) !== value) invalid();
  const url = new URL(value);
  if (url.username || url.password) invalid();
  return url;
}
function container(value: string): string {
  const url = httpUrl(value);
  if (url.search || url.hash) invalid();
  return normalizePodBase(value);
}

/**
 * Offers name a Chat room container (`…/chat/rooms/<slug>/`) or its `index.ttl#it` subject.
 * Inside `storage`, the room must sit directly under `<storage>chat/rooms/`. Throws otherwise.
 */
export function invitationRoomTarget(value: string, storage?: string): string {
  const url = httpUrl(value);
  if (url.search || value.includes("?")) invalid();
  if (url.pathname.endsWith("/index.ttl") && (!url.hash || url.hash === "#it")) {
    url.hash = "";
    url.pathname = url.pathname.slice(0, -"index.ttl".length);
  }
  if (!/\/chat\/rooms\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/$/.test(url.pathname)) invalid();
  if (url.href.includes("#")) invalid();
  const room = container(url.href);
  if (storage && isWithinPodScope(storage, room)) {
    const prefix = `${container(storage)}chat/rooms/`;
    if (!room.startsWith(prefix) || !SLUG.test(room.slice(prefix.length))) invalid();
  }
  return room;
}
