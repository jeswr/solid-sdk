// AUTHORED-BY Codex (GPT-6.1 Sol)
import { extractiveAnswer } from "@jeswr/pod-ask";
import { expect, it } from "vitest";
import { ensureAskSample } from "../../src/apps/ask/demo/sample";
import { openAskRetrieval } from "../../src/apps/ask/lib/retrieval";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import type { PodSession } from "../../src/lib/session/pod-session";

it("retrieves seeded evidence through the actual shared pod warmer and Node WASM search", async () => {
  const root = "https://fictional.demo.pod/";
  const pod = createDemoPod({ root });
  const session: PodSession = {
    mode: "demo",
    webId: `${root}profile#me`,
    displayName: "Fictional owner",
    storageUrl: root,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  await ensureAskSample(session);
  const retrieval = await openAskRetrieval(session, new AbortController().signal);
  try {
    const hits = retrieval.retrieve("When does my passport expire?", "notes");
    const answer = extractiveAnswer("When does my passport expire?", hits);
    expect(answer.sentences.some((s) => s.text.includes("18 September 2028"))).toBe(true);
    expect(answer.citations[0]?.url).toContain("ask-sample-passport.ttl#it");
    expect(hits[0]?.href).toMatch(/^\/notes\/n\//);
    expect(
      retrieval.retrieve("Rowan garden", "notes").some((s) => s.text.includes("lavender")),
    ).toBe(true);
    expect(retrieval.retrieve("unicorns", undefined)).toEqual([]);
  } finally {
    retrieval.dispose();
  }
});
