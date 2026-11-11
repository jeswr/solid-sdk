// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { fetchRdf } from "@jeswr/fetch-rdf";
import { resolveStorageDescription } from "@jeswr/storage-capabilities";
import { NS } from "@jeswr/suite-vocab";
import { Writer } from "n3";
import { expect, it, vi } from "vitest";
import { askSearchCapabilities, ensureAskSample } from "../../src/apps/ask/demo/sample";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import type { PodSession } from "../../src/lib/session/pod-session";

const root = "https://fictional.demo.pod/";
function fixture() {
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
  return { pod, session };
}
it("seeds fictional RDF resources in the demo pod once without overwriting edits", async () => {
  const { pod, session } = fixture();
  await ensureAskSample(session);
  expect(pod.snapshot().resources).toHaveLength(3);
  const url = `${root}notes/ask-sample-passport.ttl`;
  const document = await fetchRdf(url, { fetch: pod.fetch });
  expect([...document.dataset].some((q) => q.object.value.includes("18 September 2028"))).toBe(
    true,
  );
  const saved = await pod.fetch(url);
  const original = await saved.text();
  await ensureAskSample(session);
  expect(await (await pod.fetch(url)).text()).toBe(original);
});
it("writes Notes-compatible HTML bodies with Dublin Core metadata and plain-text snippets", async () => {
  const { session } = fixture();
  await ensureAskSample(session);
  const url = `${root}notes/ask-sample-garden.ttl`;
  const { dataset } = await fetchRdf(url, { fetch: session.fetch });
  const value = (predicate: string) =>
    [...dataset].find((q) => q.subject.value === `${url}#it` && q.predicate.value === predicate)
      ?.object.value;
  expect(value(`${NS.POD_DOCS}format`)).toBe("text/html");
  expect(value(`${NS.POD_DOCS}body`)).toMatch(/^<p>Rowan and I .* plants &amp; I will .*<\/p>$/);
  expect(value(`${NS.DCT}title`)).toBe("Garden agreement with Rowan");
  expect(value(`${NS.DCT}description`)).toContain("plants & I will");
  expect(value(`${NS.DCT}modified`)).toBe("2026-11-10T10:00:00.000Z");
});
it("never writes to a real pod", async () => {
  const { session } = fixture();
  const fetch = vi.fn();
  await ensureAskSample({ ...session, mode: "solid", fetch } as unknown as PodSession);
  expect(fetch).not.toHaveBeenCalled();
});
it("surfaces demo writes that fail so preparation can be retried", async () => {
  const { session } = fixture();
  await expect(
    ensureAskSample({ ...session, fetch: async () => new Response(null, { status: 403 }) }),
  ).rejects.toThrow("prepare");
});

it("seeds only the demo's missing discovery metadata into a private memory cache", async () => {
  const { session } = fixture();
  const signal = new AbortController().signal;
  const cache = await askSearchCapabilities(session, signal);
  const fetch = vi.fn(async () => {
    throw new Error("Cached discovery should need no requests");
  });
  const description = await resolveStorageDescription(root, { cache, fetch });
  expect(description.root).toBe(root);
  expect(description.protocol).toBe("solid");
  expect(fetch).not.toHaveBeenCalled();
  const live = await askSearchCapabilities(
    { ...session, mode: "solid", fetch } as unknown as PodSession,
    signal,
  );
  expect(await live.lookupPrefix(root)).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    askSearchCapabilities(
      { ...session, fetch: async () => new Response(null, { status: 403 }) },
      signal,
    ),
  ).rejects.toThrow("open the sample pod");
});

it("does not write an un-serialisable fixture", async () => {
  const { session } = fixture();
  const end = vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback) => {
    callback?.(new Error("Synthetic serializer failure"), "");
  });
  try {
    await expect(ensureAskSample(session)).rejects.toThrow("Synthetic serializer failure");
  } finally {
    end.mockRestore();
  }
});
