// AUTHORED-BY Codex GPT-6.1-Sol
import { exampleHealthKnowledge } from "@jeswr/pkg-health/testing";
import { NanopubStore } from "@jeswr/pkg-memory";
import { createMemoryPodPort, exampleBuildOptions } from "@jeswr/pkg-memory/testing";

/** Only the fictional demo uses this port. It has no fetch or durable storage. */
export async function createKnowledgeDemo() {
  const owner = exampleBuildOptions().owner;
  const port = createMemoryPodPort({ root: "https://example.org/pod/", webId: owner });
  const store = new NanopubStore({
    ...port,
    // This local port defines its own WAC metadata; no remote ACL is inferred.
    async head(target) {
      const acl = new URL(target);
      acl.pathname += ".acl";
      return { acl: acl.href };
    },
  });
  const value = await exampleHealthKnowledge();
  await store.put(value);
  return { owner, store, value };
}
