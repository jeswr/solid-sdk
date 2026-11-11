// AUTHORED-BY Codex GPT-6.1-Sol
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createPreferences, type PreferencesHook } from "@jeswr/suite-sdk/preferences";
import { afterEach, expect, it, vi } from "vitest";
import { registry, spotifyAdapterFor } from "../src/apps/home/components/connect/config";
import {
  SpotifyClientForm,
  spotifyClientSchema,
} from "../src/apps/home/components/connect/spotify-client";
import { act, h, mount } from "./drive-ui-dom";

const CLIENT = "0123456789abcdef0123456789abcdef";
const stores: PreferencesHook[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.restoreAllMocks();
});
async function preferences() {
  const storage = createMemoryStorage({ root: "https://spotify-prefs.test/" });
  const card = await storage.create(storage.root, "", { name: "card", contentType: "text/turtle" });
  const locations = new Set<string>();
  const typeIndex = {
    find: async () => [...locations],
    register: async (_iri: string, location: { container: string }) => {
      locations.add(location.container);
      return undefined;
    },
  };
  const options = {
    storage,
    typeIndex,
    webId: `${card.url}#me`,
    profile: await storage.readRdf(card.url),
    ensureOwnerOnly: vi.fn(async () => {}),
  };
  const make = () => {
    const hook = createPreferences(options);
    stores.push(hook);
    return hook;
  };
  return { storage, options, make };
}
async function fill(host: HTMLElement, text: string) {
  const input = host.querySelector("input");
  if (!input) throw new Error("Missing Client ID input");
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(host: HTMLElement) {
  const form = host.querySelector("form");
  if (!form) throw new Error("Missing Client ID form");
  await act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
it.each([
  "secret",
  "a".repeat(31),
  "g".repeat(32),
  "a".repeat(33),
  null,
  {},
])("rejects malformed personal client IDs %j", (value) => {
  expect(() => spotifyClientSchema.parse(value)).toThrow();
});
it("saves through real pod-backed SDK preferences, restores after remount and shows the callback instructions", async () => {
  const { storage, options, make } = await preferences();
  const onClientId = vi.fn();
  const { host, unmount } = await mount(
    h(SpotifyClientForm, { usePreferences: make(), onClientId }),
  );
  await vi.waitFor(() =>
    expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false),
  );
  expect(host.textContent).toContain("https://suite.example/oauth-callback.html");
  expect(host.textContent).toContain("User Management");
  expect(host.textContent).toContain("Never paste a client secret");
  await fill(host, ` ${CLIENT} `);
  await submit(host);
  await vi.waitFor(() => expect(onClientId).toHaveBeenLastCalledWith(CLIENT));
  const file = await storage.read(`${storage.root}settings/suite/connect.spotify-client-id.json`);
  expect(JSON.parse(await file.text())).toBe(CLIENT);
  expect(options.ensureOwnerOnly).toHaveBeenCalled();
  await fill(host, "invalid-draft");
  await vi.waitFor(() => expect(onClientId).toHaveBeenLastCalledWith(""));
  expect(host.textContent).toContain("Save this Client ID before continuing.");
  await unmount();
  const restored = vi.fn();
  const second = await mount(
    h(SpotifyClientForm, { usePreferences: make(), onClientId: restored }),
  );
  await vi.waitFor(() => expect(restored).toHaveBeenLastCalledWith(CLIENT));
  expect(second.host.querySelector<HTMLInputElement>("input")?.value).toBe(CLIENT);
});
it("shows validation errors without persisting invalid input or activating a client", async () => {
  const { make, storage } = await preferences();
  const write = vi.spyOn(storage, "write");
  const create = vi.spyOn(storage, "create");
  const onClientId = vi.fn();
  const { host } = await mount(h(SpotifyClientForm, { usePreferences: make(), onClientId }));
  await vi.waitFor(() =>
    expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false),
  );
  create.mockClear();
  await fill(host, "not-a-client-secret");
  await submit(host);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("valid 32-character");
  expect(onClientId).not.toHaveBeenCalledWith("not-a-client-secret");
  expect(write).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
it("keeps failed pod writes pending and does not activate an unsaved client", async () => {
  const { make, storage } = await preferences();
  const onClientId = vi.fn();
  const { host } = await mount(h(SpotifyClientForm, { usePreferences: make(), onClientId }));
  await vi.waitFor(() =>
    expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false),
  );
  const create = vi.spyOn(storage, "create").mockRejectedValue(new Error("offline"));
  await fill(host, CLIENT);
  await submit(host);
  await vi.waitFor(() => expect(host.textContent).toContain("Couldn't save to your pod"));
  expect(onClientId).not.toHaveBeenCalledWith(CLIENT);
  expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
  create.mockRestore();
  await submit(host);
  await vi.waitFor(() => expect(onClientId).toHaveBeenLastCalledWith(CLIENT));
});
it("uses the environment client before a personal client, without mutating the registry", () => {
  const base = registry.adapterById("spotify");
  const original = base?.oauth;
  if (!base || !original) throw new Error("Missing Spotify adapter");
  expect(spotifyAdapterFor(CLIENT)?.oauth?.clientId).toBe(original.clientId ?? CLIENT);
  expect(base.oauth).toBe(original);
  Object.assign(base, { oauth: { ...original, clientId: "environment-client" } });
  try {
    expect(spotifyAdapterFor(CLIENT)?.oauth?.clientId).toBe("environment-client");
  } finally {
    Object.assign(base, { oauth: original });
  }
  expect(spotifyAdapterFor("invalid")).toBe(base);
});
