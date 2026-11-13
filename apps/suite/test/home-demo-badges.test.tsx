// AUTHORED-BY Codex GPT-6.1-Sol
import { Provenance } from "@jeswr/pod-connectors/core/provenance";
import { MusicRecording, PodThing } from "@jeswr/pod-connectors/core/vocab";
import { DataFactory, Store, Writer } from "n3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainItem } from "../src/apps/home/lib/model/discovery";
import * as permissions from "../src/apps/home/lib/permissions";
import type { HomeSession } from "../src/apps/home/state/use-domain-items";
import { useProvenance } from "../src/apps/home/state/use-provenance";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import { act, deferred, h, mount } from "./drive-ui-dom";

const { current } = vi.hoisted(() => ({
  current: { session: undefined as HomeSession | undefined },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => current.session }));

import { HomeCard } from "../src/apps/home/components/home-card";
import { ItemPage } from "../src/apps/home/components/item/item-page";
import { DEMO_CONNECTOR } from "../src/apps/home/lib/connect/catalogue";
import { classificationForType } from "../src/apps/home/lib/model/classify";
import { connectorKey } from "../src/apps/home/state/connectors";

const root = "https://pod.example/alice/";
const webId = `${root}profile/card#me`;
const url = `${root}integrations/spotify/music/songs.ttl`;
const subject = DataFactory.namedNode(`${url}#it`);
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

async function setup(
  marker: boolean,
  legacy: boolean,
  agent?: string,
  options: { name?: string; person?: boolean; outside?: boolean } = {},
) {
  const itemUrl = options.outside ? `${root}notes/song.ttl` : url;
  const itemSubject = options.outside ? DataFactory.namedNode(`${itemUrl}#it`) : subject;
  const dataset = new Store();
  const song = new MusicRecording(itemSubject, dataset, DataFactory).mark();
  song.name = "Sample song";
  song.sourceUrl = "https://open.spotify.com/track/sample";
  if (agent) {
    song.sourceUrl = undefined;
    new Provenance(itemSubject, dataset, DataFactory).attributedTo.add(agent);
    const app = new PodThing(agent, dataset, DataFactory);
    app.types.add(
      options.person ? "https://schema.org/Person" : "http://www.w3.org/ns/prov#SoftwareAgent",
    );
    if (options.name) app.name = options.name;
  }
  if (marker)
    new Provenance(itemSubject, dataset, DataFactory).attributedTo.add(DEMO_CONNECTOR.iri);
  const writer = new Writer();
  writer.addQuads([...dataset]);
  const body = await new Promise<string>((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
  const pod = createDemoPod({
    root,
    seed: [{ path: itemUrl.slice(root.length), contentType: "text/turtle", body }],
  });
  current.session = {
    mode: "demo",
    fetch: pod.fetch,
    storageUrl: root,
    webId,
    displayName: "Alice",
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  if (legacy)
    localStorage.setItem(
      connectorKey(webId, "spotify"),
      JSON.stringify({
        connectedAt: "2026-11-01T12:00:00Z",
        mode: "demo",
        lastOutcome: "ok",
        added: 1,
        skipped: 0,
        resourceUrls: [url],
      }),
    );
  return {
    ...classificationForType("songs"),
    url: itemUrl,
    subject: itemSubject,
    title: "Sample song",
    containerUrl: options.outside ? `${root}notes/` : `${root}integrations/spotify/music/`,
    dataset,
    etag: null,
  };
}

describe.each(["card", "detail"] as const)("Home %s demo badge", (surface) => {
  it.each([
    { marker: true, legacy: false },
    { marker: false, legacy: true },
    { marker: true, legacy: true },
    { marker: false, legacy: false },
  ])("combines persisted provenance and legacy records ($marker / $legacy)", async ({
    marker,
    legacy,
  }) => {
    const item = await setup(marker, legacy);
    const view = await mount(
      surface === "card"
        ? h(HomeCard, {
            item,
            view: { types: [], title: item.title, properties: [] },
            storage: root,
            webId,
          })
        : h(ItemPage, { domain: "media", itemRef: encodeRef(url) }),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(view.host.textContent).toContain("Provided by Spotify");
    });
    const badges = view.host.querySelectorAll('[role="note"][aria-label="Demo data"]');
    expect(badges).toHaveLength(marker || legacy ? 1 : 0);
    if (marker || legacy) {
      expect(badges[0]?.textContent).toBe("Demo data");
      expect(badges[0]?.classList.contains("bg-warning")).toBe(true);
      expect(badges[0]?.classList.contains("text-warning-foreground")).toBe(true);
    }
    // Losing a connection record cannot hide the marker stored in the item graph.
    if (legacy) {
      localStorage.clear();
      await act(async () => {
        window.dispatchEvent(new window.StorageEvent("storage", { key: null }));
      });
      expect(view.host.querySelectorAll('[aria-label="Demo data"]')).toHaveLength(marker ? 1 : 0);
    }
    await view.unmount();
  });
});

describe.each(["card", "detail"] as const)("Home %s app provenance", (surface) => {
  it.each([
    {
      agent: "https://ui-notenest.example/client.jsonld",
      name: "NoteNest",
      label: "NoteNest",
      fetches: 1,
    },
    {
      agent: "https://ui-unreadable.example/client.jsonld",
      name: undefined,
      label: "ui-unreadable.example",
      fetches: 1,
    },
    {
      agent: "http://ui-rejected.example/client.jsonld",
      name: undefined,
      label: "ui-rejected.example",
      fetches: 0,
    },
  ])("shows a badge for $label with the public client resolver", async ({
    agent,
    name,
    label,
    fetches,
  }) => {
    // Each surface has a separate client URL so the shared Permissions cache stays cold.
    const client = `${agent}?surface=${surface}`;
    const publicFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (!name) throw new Error("Unavailable");
      return Response.json({ client_name: name });
    });
    const item = await setup(false, false, client);
    const view = await mount(
      surface === "card"
        ? h(HomeCard, {
            item,
            view: { types: [], title: item.title, properties: [] },
            storage: root,
            webId,
          })
        : h(ItemPage, { domain: "media", itemRef: encodeRef(url) }),
    );
    await vi.waitFor(() =>
      expect(view.host.querySelector(".hm-provenance")?.textContent).toContain(
        `Provided by ${label}`,
      ),
    );
    expect(view.host.querySelector(".hm-you")).toBeNull();
    expect(view.host.textContent).not.toContain("Added by you");
    expect(publicFetch).toHaveBeenCalledTimes(fetches);
    if (fetches)
      expect(publicFetch).toHaveBeenCalledWith(
        client,
        expect.objectContaining({ credentials: "omit", redirect: "error" }),
      );
    await view.unmount();
  });
});

function ProvenanceProbe({ item, session }: { item?: DomainItem; session: HomeSession }) {
  const provenance = useProvenance(item, session);
  return h("span", {}, provenance?.label ?? "No item");
}

it("shares lookups between cards and ignores late names after switching items or sessions", async () => {
  const oldClient = "https://old-provenance.example/client.jsonld";
  const newClient = "https://new-provenance.example/client.jsonld";
  const delayed = deferred<Response>();
  const publicFetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) =>
      String(input) === oldClient ? delayed.promise : Response.json({ client_name: "Current app" }),
    );
  const oldItem = await setup(false, false, oldClient);
  const session = current.session as HomeSession;
  const dataset = new Store();
  new Provenance(subject, dataset, DataFactory).attributedTo.add(newClient);
  new PodThing(newClient, dataset, DataFactory).types.add(
    "http://www.w3.org/ns/prov#SoftwareAgent",
  );
  const newItem = { ...oldItem, dataset };
  const view = await mount(h(ProvenanceProbe, { session }));
  expect(view.host.textContent).toBe("No item");
  await view.render(
    h(
      "div",
      {},
      h(ProvenanceProbe, { item: oldItem, session }),
      h(ProvenanceProbe, { item: oldItem, session }),
    ),
  );
  expect(publicFetch).toHaveBeenCalledTimes(1);
  await view.render(h(ProvenanceProbe, { item: newItem, session }));
  expect(view.host.textContent).toBe("Current app");
  await view.render(h(ProvenanceProbe, { item: newItem, session: { ...session } }));
  expect(view.host.textContent).toBe("Current app");
  await act(async () => delayed.resolve(Response.json({ client_name: "Stale app" })));
  expect(view.host.textContent).toBe("Current app");
  expect(publicFetch).toHaveBeenCalledTimes(2);
  await view.unmount();
});

describe.each(["card", "detail"] as const)("Home %s attribution styling", (surface) => {
  it.each([
    { name: "you", person: false },
    { name: "You", person: true },
    { name: "Me", person: false },
    { name: "Spotify", person: false },
    { name: "Demo data", person: false },
    { name: "Name\u202e app", person: false },
    { name: "Person Name", person: true },
    { name: "A".repeat(90), person: false },
  ])("uses a sanitised external badge for graph name $name", async ({ name, person }) => {
    const agent = "https://hostile-name.example/client";
    const publicFetch = vi.spyOn(globalThis, "fetch");
    const item = await setup(false, false, agent, { name, person, outside: true });
    const view = await mount(
      surface === "card"
        ? h(HomeCard, {
            item,
            view: { types: [], title: item.title, properties: [] },
            storage: root,
            webId,
          })
        : h(ItemPage, { domain: "media", itemRef: encodeRef(item.url) }),
    );
    const expected = ["you", "me", "spotify", "demo data"].includes(name.toLowerCase())
      ? "hostile-name.example"
      : name.length > 60
        ? `${"A".repeat(59)}…`
        : name.replace("\u202e", "");
    await vi.waitFor(() =>
      expect(view.host.querySelector(".hm-provenance")?.textContent).toContain(
        `Provided by ${expected}`,
      ),
    );
    expect(view.host.querySelector(".hm-you")).toBeNull();
    expect(view.host.textContent).not.toContain("Added by you");
    expect(publicFetch).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("reserves Added by you for the current user's attribution", async () => {
    const item = await setup(false, false, webId, { outside: true });
    const view = await mount(
      surface === "card"
        ? h(HomeCard, {
            item,
            view: { types: [], title: item.title, properties: [] },
            storage: root,
            webId,
          })
        : h(ItemPage, { domain: "media", itemRef: encodeRef(item.url) }),
    );
    await vi.waitFor(() =>
      expect(view.host.querySelector(".hm-you")?.textContent).toBe("Added by you"),
    );
    expect(view.host.querySelector(".hm-provenance")).toBeNull();
    await view.unmount();
  });
});

it("avoids a second hook render when there is no agent to resolve", async () => {
  const item = await setup(false, false);
  const render = vi.fn();
  function Probe() {
    render();
    const provenance = useProvenance(item, current.session as HomeSession);
    return h("span", {}, provenance.label);
  }
  const publicFetch = vi.spyOn(globalThis, "fetch");
  const view = await mount(h(Probe));
  expect(view.host.textContent).toBe("Spotify");
  expect(render).toHaveBeenCalledTimes(1);
  expect(publicFetch).not.toHaveBeenCalled();
  await view.unmount();
});

it("falls back to the host for a rejected lookup and ignores late rejections", async () => {
  const item = await setup(false, false, "https://reject-name.example/client.jsonld");
  const session = current.session as HomeSession;
  const delayed = deferred<permissions.ClientMetadata>();
  vi.spyOn(permissions, "resolveClientName")
    .mockRejectedValueOnce(new Error("Rejected"))
    .mockReturnValueOnce(delayed.promise);
  const view = await mount(h(ProvenanceProbe, { item, session }));
  expect(view.host.textContent).toBe("reject-name.example");
  await view.render(h(ProvenanceProbe, { item: { ...item }, session }));
  await view.render(h(ProvenanceProbe, { session }));
  await act(async () => delayed.reject(new Error("Late rejection")));
  expect(view.host.textContent).toBe("No item");
  await view.unmount();
});
