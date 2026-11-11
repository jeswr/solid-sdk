// AUTHORED-BY Codex GPT-6.1-Sol
import { Provenance } from "@jeswr/pod-connectors/core/provenance";
import { MusicRecording } from "@jeswr/pod-connectors/core/vocab";
import { DataFactory, Store, Writer } from "n3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeSession } from "../src/apps/home/state/use-domain-items";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import { act, h, mount } from "./drive-ui-dom";

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

async function setup(marker: boolean, legacy: boolean) {
  const dataset = new Store();
  const song = new MusicRecording(subject, dataset, DataFactory).mark();
  song.name = "Sample song";
  song.sourceUrl = "https://open.spotify.com/track/sample";
  if (marker) new Provenance(subject, dataset, DataFactory).attributedTo.add(DEMO_CONNECTOR.iri);
  const writer = new Writer();
  writer.addQuads([...dataset]);
  const body = await new Promise<string>((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
  const pod = createDemoPod({
    root,
    seed: [{ path: url.slice(root.length), contentType: "text/turtle", body }],
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
    url,
    subject,
    title: "Sample song",
    containerUrl: `${root}integrations/spotify/music/`,
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
