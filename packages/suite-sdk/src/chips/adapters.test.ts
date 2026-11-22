// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { createChipPeople, createChipSearch } from "./adapters.js";
import { type ChipRef, chipHref } from "./core.js";

const bob: ChipRef = { iri: "https://bob.example/#me", label: "Bob", kind: "person" };
afterEach(() => vi.useRealTimers());
it("loads own identity, contacts and known WebIDs once per loader, then expires", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const fetch = vi.fn(
    async () =>
      new Response(`<${bob.iri}> <http://xmlns.com/foaf/0.1/knows> <https://cat.example/#me>.`, {
        headers: { "content-type": "text/turtle" },
      }),
  );
  const contacts = vi.fn(async () => [{ ...bob, iri: "https://dana.example/#me", label: "Dana" }]);
  const people = createChipPeople({ fetch, webId: bob.iri, displayName: bob.label, contacts });
  expect(await people()).toEqual(
    expect.arrayContaining([
      bob,
      { iri: "https://cat.example/#me", label: "https://cat.example/#me", kind: "person" },
      { ...bob, iri: "https://dana.example/#me", label: "Dana" },
    ]),
  );
  await people();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(contacts).toHaveBeenCalledTimes(1);
  vi.setSystemTime(30_001);
  await people();
  expect(fetch).toHaveBeenCalledTimes(2);
  await createChipPeople({ fetch, webId: bob.iri, displayName: bob.label, contacts })();
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("keeps identity when contact/profile loading fails or the profile has no known people", async () => {
  for (const fetch of [
    async () => {
      throw new Error("offline");
    },
    async () => new Response("", { headers: { "content-type": "text/turtle" } }),
  ]) {
    expect(
      await createChipPeople({
        fetch,
        webId: bob.iri,
        displayName: bob.label,
        contacts: async () => {
          throw new Error("denied");
        },
      })(),
    ).toEqual([bob]);
  }
});
it("adapts shell search types and combines contacts, including an absent source", async () => {
  const signal = new AbortController().signal;
  expect(await createChipSearch()("", signal)).toEqual([]);
  expect(await createChipSearch(null, async () => [bob])("", signal)).toEqual([bob]);
  const search = vi.fn(async () => ({
    source: "local" as const,
    results: [
      ...["calendar", "notes", "sheets", "docs", "tasks", "contacts", "drive"].map((app) => ({
        id: `https://pod.example/${app}`,
        title: app,
        type: "file",
        app,
      })),
      {
        id: "https://pod.example/link",
        title: "Link",
        type: "link",
        parent: "https://pod.example/",
      },
    ],
  }));
  const refs = await createChipSearch({ search })("", signal);
  expect(refs.map((ref) => ref.kind).sort()).toEqual(
    ["event", "note", "sheet", "doc", "task", "person", "file", "link"].sort(),
  );
  expect(search).toHaveBeenCalledWith("", { signal });
});
it("maps chip routes using the caller's encoder and preserves external and unsafe refs", () => {
  const encode = (iri: string) => `encoded:${iri}`;
  const ref: ChipRef = { iri: "https://pod.example/report#it", label: "Report", kind: "doc" };
  for (const [kind, route] of [
    ["doc", "/docs/d/"],
    ["note", "/notes/n/"],
    ["sheet", "/sheets/s/"],
    ["event", "/calendar/e/"],
    ["file", "/drive/p/"],
  ] as const)
    expect(chipHref({ ...ref, kind }, encode)).toBe(`${route}encoded:https://pod.example/report`);
  expect(chipHref({ ...ref, kind: "file", iri: "https://pod.example/folder/" }, encode)).toBe(
    "/drive/f/encoded:https://pod.example/folder/",
  );
  expect(chipHref({ ...ref, kind: "task" }, encode)).toBe(
    "/tasks/inbox?task=encoded:https://pod.example/report#it",
  );
  for (const kind of ["person", "link", "place"] as const)
    expect(chipHref({ ...ref, kind }, encode)).toBe(ref.iri);
  expect(chipHref({ ...ref, iri: "bad" }, encode)).toBe("bad");
  expect(chipHref({ ...ref, kind: "link", app: "docs" }, encode)).toContain("/docs/d/");
  expect(chipHref({ ...ref, app: "unknown" }, encode)).toContain("/docs/d/");
});
