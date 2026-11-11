// AUTHORED-BY Codex (GPT-6.1 Sol)
import { openJournal } from "@jeswr/solid-journal";
import type { PodSession } from "@/lib/session/pod-session";

/** Shared storage, access control and Type Index work belongs to the model package. */
export function openJournalData(session: PodSession) {
  return openJournal(session.fetch, session.storageUrl, session.webId, {
    solidFixture: session.mode === "demo",
  });
}
