// AUTHORED-BY Codex (GPT-6.1 Sol)
import { openSolidDeckRepository } from "@jeswr/solid-slides";
import type { PodSession } from "@/lib/session/pod-session";
/** The session adapter provides an explicit Solid pod root and bounded transport. */
export function connectSlides(session: PodSession) {
  return openSolidDeckRepository(session.fetch, session.storageUrl, session.webId);
}
