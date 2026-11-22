// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { openDeckRepository } from "@jeswr/solid-slides";
import type { PodSession } from "@/lib/session/pod-session";
/**
 * Storage discovery picks the Solid or LWS backend. Only the demo pod, a plain Solid transport
 * without a storage description, is opened as Solid without one.
 */
export function connectSlides(session: PodSession) {
  return openDeckRepository({
    fetch: session.fetch,
    storageUrl: session.storageUrl,
    profile: session.webId,
    assumeSolidWhenUndescribed: session.mode === "demo",
  });
}
