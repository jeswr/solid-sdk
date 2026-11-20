// AUTHORED-BY Codex GPT-6.1-Sol
// Test-only owner transport. Real ACL enforcement is exercised in css.e2e.test.ts.
import { Agent } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { createDemoPod } from "../../suite/src/lib/demo-pod/pod.js";
export const ROOT = "https://pod.example/";
export const WEBID = `${ROOT}profile/card#me`;
export function connectionPod() {
  const dataset = new Store();
  const profile = new Agent(WEBID, dataset, DataFactory);
  profile.pimStorage.add(ROOT);
  const body = new Writer({ format: "text/turtle" }).quadsToString([...dataset]);
  const pod = createDemoPod({
    root: ROOT,
    seed: [{ path: "profile/card", body, contentType: "text/turtle" }],
  });
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const response = await pod.fetch(request);
    if (request.method === "HEAD" && response.status === 404)
      response.headers.set("link", `<${request.url}.acl>; rel="acl"`);
    response.headers.set("updates-via", "wss://pod.example/updates");
    return response;
  };
  return { ...pod, fetch: fetcher };
}
