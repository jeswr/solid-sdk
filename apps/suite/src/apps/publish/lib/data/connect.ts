// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { openPublishRepository } from "@jeswr/solid-publish";
import { toast } from "@jeswr/suite-ui";
import type { PodSession } from "@/lib/session/pod-session";
import { ensureSample } from "../../demo/sample";

export async function connectPublish(session: PodSession) {
  const repository = await openPublishRepository(session.fetch, session.storageUrl, session.webId, {
    protocol: "solid",
    onWarning: (message) => toast.warning(message),
  });
  await ensureSample(session, repository);
  return repository;
}
