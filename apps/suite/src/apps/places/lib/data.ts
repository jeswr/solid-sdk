// AUTHORED-BY Codex (GPT-6.1 Sol)
import { openPlacesRepository } from "@jeswr/solid-places";
import type { PodSession } from "@/lib/session/pod-session";
export function openPlaces(session: PodSession) {
  return openPlacesRepository({
    fetch: session.fetch,
    storageUrl: session.storageUrl,
    owner: session.webId,
    demo: session.mode === "demo",
  });
}
