// AUTHORED-BY Claude Opus 5.5
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import type { PodSession } from "@/lib/session/pod-session";

const anonymous: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "omit", referrerPolicy: "no-referrer" });
/**
 * Credentials go only to the signed-in pod. An image URL elsewhere (for example one set by an
 * imported Markdown file) is fetched without them, so a deck can't make Slides send
 * authenticated requests to other hosts.
 */
export function slideImageFetch(session: PodSession, url: string): typeof fetch {
  if (isWithinPodScope(session.storageUrl, url)) return session.fetch;
  return session.mode === "demo" ? anonymous : session.publicFetch;
}
