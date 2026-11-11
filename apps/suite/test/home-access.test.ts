// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { useHomeAccess } from "../src/apps/home/state/use-home-access";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";
import { h, mount } from "./drive-ui-dom";

it("counts access across the full demo pod including nested Docs CRDT files", async () => {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    displayName: "Alice",
    storageUrl: DEMO_ROOT,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  let access: ReturnType<typeof useHomeAccess>;
  function Probe() {
    access = useHomeAccess(session, 0);
    return null;
  }
  await mount(h(Probe));
  await expect.poll(() => access).toEqual({ apps: 1, people: 1, publicItems: 1 });
});
