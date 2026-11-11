// AUTHORED-BY Codex (GPT-6.1 Sol)
import { openPublishRepository } from "@jeswr/solid-publish";
import type { PodSession } from "@/lib/session/pod-session";
import { ensureSample } from "../../demo/sample";

export async function connectPublish(session: PodSession) {
  const repository = await openPublishRepository(session.fetch, session.storageUrl, session.webId, {
    protocol: "solid",
  });
  await ensureSample(session, repository);
  return repository;
}
