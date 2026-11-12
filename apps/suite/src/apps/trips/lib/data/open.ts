// AUTHORED-BY Codex (GPT-6.1 Sol)
import { openTripsStore } from "@jeswr/solid-trips";
import type { PodSession } from "@/lib/session/pod-session";
import { ensureSample } from "../../demo/sample";
export async function openTrips(session: PodSession) {
  const store = await openTripsStore(
    session.fetch,
    session.storageUrl,
    session.webId,
    session.mode === "demo",
  );
  await store.initialise();
  await ensureSample(session, store);
  return { store, snapshot: await store.load() };
}
