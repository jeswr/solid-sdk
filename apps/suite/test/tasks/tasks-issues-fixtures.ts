// AUTHORED-BY Codex GPT-6.1-Sol

import { IssuesTaskStore } from "../../src/apps/tasks/lib/issues/store";
import { NS, node, Store, serialize } from "../../src/apps/tasks/lib/model/rdf";
import { now, Pod, storage, webId } from "./pod";

export const trackerUrl = `${storage}issue-tracker/tracker.ttl`;
export const containerUrl = `${storage}issue-tracker/issues/`;
export async function issuesFixture() {
  const pod = new Pod();
  await pod.emptyContainer(`${storage}issue-tracker/`);
  await pod.emptyContainer(containerUrl);
  const dataset = new Store();
  const tracker = node(`${trackerUrl}#this`, dataset);
  tracker.types.add(`${NS.WF}Tracker`);
  tracker.setText(`${NS.DCT}title`, "Support");
  tracker.setIri(`${NS.WF}issueClass`, `${NS.WF}Task`);
  tracker.iris(`${NS.WF}issueCategory`).add(`${trackerUrl}#Priority`);
  const store = new IssuesTaskStore({
    storage,
    webId,
    fetch: pod.fetch,
    now: () => now,
    ensurePrivateTasksAccess: pod.ensurePrivateIndexAccess,
    ensurePrivateIndexAccess: pod.ensurePrivateIndexAccess,
  });
  pod.seed(trackerUrl, await serialize(dataset));
  const project = await store.readProject(trackerUrl);
  return { pod, store, project };
}
