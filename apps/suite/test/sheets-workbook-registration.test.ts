// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { readRdf, serializeTurtle } from "../src/apps/docs/lib/model/rdf-io";
import {
  ProfileTypeIndexAnchor,
  TypeIndexDataset,
  TypeRegistration,
} from "../src/apps/docs/lib/model/type-index";
import { SheetResource, SPREADSHEET_CLASS } from "../src/apps/sheets/lib/model";
import { harness, INDEX, POD, ROOT, snapshot, WEBID } from "./sheets-workbook-helpers";

describe("Sheets Type Index discovery", () => {
  it("follows preferences and extended profiles, deduplicating shared links", async () => {
    const h = await harness(true);
    const prefs = `${POD}settings/prefs.ttl`;
    const profile = new Store();
    new ProfileTypeIndexAnchor(WEBID, profile, DataFactory).preferencesFiles.add(prefs);
    new SheetResource(WEBID, profile, DataFactory)
      .links("http://www.w3.org/2000/01/rdf-schema#seeAlso")
      .add(prefs);
    await h.pod.fetch(WEBID, {
      method: "PUT",
      body: await serializeTurtle(profile),
      headers: { "content-type": "text/turtle" },
    });
    const preferences = new Store();
    new ProfileTypeIndexAnchor(WEBID, preferences, DataFactory).privateIndex = INDEX;
    await h.pod.fetch(prefs, {
      method: "PUT",
      body: await serializeTurtle(preferences),
      headers: { "content-type": "text/turtle" },
    });
    await h.service.create({ title: "Preferences", snapshot: snapshot() });
    const index = new TypeIndexDataset((await readRdf(INDEX, h.fetch)).dataset, DataFactory);
    expect(index.locate(SPREADSHEET_CLASS).map((r) => r.container)).toEqual([ROOT]);
  });

  it("skips profiles with cyclic extended profiles but no Type Index", async () => {
    const h = await harness();
    const profile = new Store();
    new SheetResource(WEBID, profile, DataFactory)
      .links("http://www.w3.org/2000/01/rdf-schema#seeAlso")
      .add(WEBID);
    await h.pod.fetch(WEBID, {
      method: "PUT",
      body: await serializeTurtle(profile),
      headers: { "content-type": "text/turtle" },
    });
    const book = await h.service.create({ title: "Cycle", snapshot: snapshot() });
    expect(book.metadata.title).toBe("Cycle");
    expect(h.calls.filter((c) => c.method === "PUT").every((c) => c.url.startsWith(ROOT))).toBe(
      true,
    );
    expect(h.calls.length).toBeLessThan(15);
  });

  it("bounds additional links discovered while checking preferences", async () => {
    const h = await harness();
    const profile = new Store();
    new ProfileTypeIndexAnchor(WEBID, profile, DataFactory).preferencesFiles.add(
      `${POD}settings/chain-0`,
    );
    await h.pod.fetch(WEBID, {
      method: "PUT",
      body: await serializeTurtle(profile),
      headers: { "content-type": "text/turtle" },
    });
    h.setHook(async (c) => {
      const match = /\/chain-(\d+)$/.exec(c.url);
      if (!match) return;
      const dataset = new Store();
      new SheetResource(WEBID, dataset, DataFactory)
        .links("http://www.w3.org/2000/01/rdf-schema#seeAlso")
        .add(`${POD}settings/chain-${Number(match[1]) + 1}`);
      return new Response(await serializeTurtle(dataset), {
        headers: { "content-type": "text/turtle" },
      });
    });
    await expect(
      h.service.create({ title: "Bounded", snapshot: snapshot() }),
    ).resolves.toMatchObject({ metadata: { title: "Bounded" } });
    expect(h.calls.filter((c) => c.url.includes("/chain-") && c.method === "GET")).toHaveLength(33);
    expect(h.calls.some((c) => c.url.endsWith("chain-32"))).toBe(false);
    expect(h.calls.filter((c) => c.method === "PUT").every((c) => c.url.startsWith(ROOT))).toBe(
      true,
    );
  });

  it("ignores registration failures and retries on a later create", async () => {
    const h = await harness(true);
    h.setHook((c) =>
      c.method === "PUT" && c.url === INDEX ? new Response(null, { status: 503 }) : undefined,
    );
    await expect(
      h.service.create({ title: "Offline index", snapshot: snapshot() }),
    ).resolves.toMatchObject({ metadata: { title: "Offline index" } });
    h.setHook(() => undefined);
    await h.service.create({ title: "Retry index", snapshot: snapshot() });
    expect(h.calls.filter((c) => c.method === "PUT" && c.url === INDEX)).toHaveLength(2);
    expect(
      new TypeIndexDataset((await readRdf(INDEX, h.fetch)).dataset, DataFactory).locate(
        SPREADSHEET_CLASS,
      ),
    ).toHaveLength(1);
  });

  it("preserves unrelated registrations while adding the Sheets container", async () => {
    const h = await harness(true);
    const dataset = (await readRdf(INDEX, h.fetch)).dataset;
    const otherClass = new TypeRegistration(`${INDEX}#other`, dataset, DataFactory);
    otherClass.markRegistration();
    otherClass.forClass = "https://schema.org/TextDigitalDocument";
    otherClass.instanceContainer = `${POD}docs/`;
    const otherContainer = new TypeRegistration(`${INDEX}#other-sheets`, dataset, DataFactory);
    otherContainer.markRegistration();
    otherContainer.forClass = SPREADSHEET_CLASS;
    otherContainer.instanceContainer = `${POD}legacy-sheets/`;
    await h.pod.fetch(INDEX, {
      method: "PUT",
      body: await serializeTurtle(dataset),
      headers: { "content-type": "text/turtle" },
    });
    await h.service.create({ title: "Registered", snapshot: snapshot() });
    const index = new TypeIndexDataset((await readRdf(INDEX, h.fetch)).dataset, DataFactory);
    expect(index.all()).toHaveLength(3);
    expect(index.locate(SPREADSHEET_CLASS).map((r) => r.container)).toEqual([
      `${POD}legacy-sheets/`,
      ROOT,
    ]);
  });

  it("treats a public-only index as advertised and keeps bootstrap failure best effort", async () => {
    const h = await harness(true);
    const profile = new Store();
    new ProfileTypeIndexAnchor(WEBID, profile, DataFactory).publicIndexes.add(INDEX);
    await h.pod.fetch(WEBID, {
      method: "PUT",
      body: await serializeTurtle(profile),
      headers: { "content-type": "text/turtle" },
    });
    await expect(
      h.service.create({ title: "Public index", snapshot: snapshot() }),
    ).resolves.toMatchObject({ metadata: { title: "Public index" } });
    // The shared helper uses a private index and checks ACLs before linking preferences.
    expect(h.calls.some((c) => c.url === `${POD}settings/prefs.ttl`)).toBe(true);
  });
});
