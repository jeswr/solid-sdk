// AUTHORED-BY Codex GPT-6

import { Writer } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { parseDocument } from "../src/apps/docs/lib/model/document";
import { discoverDomainItems } from "../src/apps/home/lib/model/discovery";
import { provenanceOf } from "../src/apps/home/lib/model/provenance";
import { readResource } from "../src/apps/home/lib/model/rdf";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { buildHomeSeed } from "../src/lib/demo-pod/seed-home";

it("round-trips the shared Launch plan fixture through the Docs parser", async () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildHomeSeed(now) });
  const url = `${DEMO_ROOT}docs/launch.ttl`;
  const { dataset } = await readResource(pod.fetch, url);
  expect(parseDocument(url, dataset)).toMatchObject({
    title: "Launch plan",
    body: "A shared plan for the next chapter.",
    format: "text/plain",
    revisions: [{ body: "A shared plan for the next chapter.", format: "text/plain" }],
  });
});

it("discovers the Home acceptance fixtures through the actual demo pod", async () => {
  const seed = await buildDemoSeed(Date.now());
  const pod = createDemoPod({ root: DEMO_ROOT, seed });
  const { items, failures, truncated } = await discoverDomainItems("all", {
    fetch: pod.fetch,
    storage: DEMO_ROOT,
    webId: DEMO_WEBID,
  });
  expect(failures).toEqual([]);
  expect(truncated).toBe(false);
  const inDomain = (domain: string) => items.filter((item) => item.domain.id === domain);
  expect(inDomain("personal").map((item) => item.dataType?.id)).toEqual(["identity"]);
  expect(inDomain("media")).toHaveLength(3);
  expect(inDomain("media").every((item) => item.dataType?.id === "music")).toBe(true);
  expect(
    inDomain("media").map((item) => provenanceOf(item.dataset, item.subject, item.containerUrl)),
  ).toEqual(Array(3).fill({ kind: "source", label: "Spotify", logoId: "spotify" }));
  expect(new Set(inDomain("documents").map((item) => item.dataType?.id))).toEqual(
    new Set(["files", "docs", "notes", "bookmarks"]),
  );
  expect(inDomain("socials")).toHaveLength(2);
  expect(inDomain("calendar")).toHaveLength(1);
  expect(inDomain("mobility")).toEqual([]);
});

afterEach(() => vi.restoreAllMocks());
it("propagates serialization errors in Home seed resources", async () => {
  const error = new Error("Cannot serialize");
  vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback) => callback?.(error, ""));
  await expect(buildHomeSeed(Date.now())).rejects.toBe(error);
});

// AUTHORED-BY Claude Opus 5.5 — finding 12
it("writes contact emails as mailto: IRIs that the contact editor reads back", async () => {
  const { CONTACT_FIELDS } = await import("../src/apps/home/lib/forms/edit-map");
  const { readFieldValue } = await import("../src/apps/home/lib/forms/subject-edit");
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildHomeSeed(Date.now()) });
  const url = `${DEMO_ROOT}contacts/ada.ttl`;
  const { dataset } = await readResource(pod.fetch, url);
  const emails = [...dataset].filter(
    (quad) => quad.predicate.value === "http://www.w3.org/2006/vcard/ns#hasEmail",
  );
  expect(emails.map((quad) => [quad.object.termType, quad.object.value])).toEqual([
    ["NamedNode", "mailto:ada@example.org"],
  ]);
  const email = CONTACT_FIELDS.find((field) => field.label === "Email");
  expect(readFieldValue(dataset, `${url}#it`, email as NonNullable<typeof email>)).toBe(
    "ada@example.org",
  );
  const modified = [...dataset].find(
    (quad) => quad.predicate.value === "http://purl.org/dc/terms/modified",
  );
  expect(modified?.object).toMatchObject({
    termType: "Literal",
    datatype: { value: "http://www.w3.org/2001/XMLSchema#dateTime" },
  });
});
