// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  favouritesKey,
  setPreferencesIdentity,
  useTasksPreferences,
} from "../../src/apps/tasks/state/preferences";
import {
  defaultPreferences,
  parseFavourites,
  parsePreferences,
  preferencesReducer,
} from "../../src/apps/tasks/state/preferences-reducer";
import { act, h, mount } from "../drive-ui-dom";

const alice = "https://alice.example/profile#me";
const bob = "https://bob.example/profile#me";
const home = "https://alice.example/tasks/projects/home.ttl";
const work = "https://bob.example/tasks/projects/work.ttl";
let prefs: ReturnType<typeof useTasksPreferences>;
function Consumer() {
  prefs = useTasksPreferences();
  return h("output", null, prefs.preferences.favourites.join(","));
}
beforeEach(() => {
  setPreferencesIdentity(undefined);
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

it("validates, deduplicates and reduces favourites while ignoring browser-wide data", () => {
  for (const raw of [null, "{", "null", "{}", '"x"']) expect(parseFavourites(raw)).toEqual([]);
  const invalid = [
    null,
    1,
    {},
    "bad",
    "javascript:alert(1)",
    "https://user:pass@example.test/home.ttl",
    `${home}#this`,
    `${home}?x=1`,
    "https://example.test/",
  ];
  expect(parseFavourites(JSON.stringify([...invalid, home, home, work]))).toEqual([home, work]);
  expect(parsePreferences(JSON.stringify({ favourites: [home] })).favourites).toEqual([]);
  for (const url of invalid.filter((value) => typeof value === "string"))
    expect(
      preferencesReducer(defaultPreferences, { type: "favouriteProject", url, value: true }),
    ).toBe(defaultPreferences);
  const add = preferencesReducer(defaultPreferences, {
    type: "favouriteProject",
    url: home,
    value: true,
  });
  expect(add.favourites).toEqual([home]);
  expect(preferencesReducer(add, { type: "favouriteProject", url: home, value: true })).toBe(add);
  expect(
    preferencesReducer(add, { type: "favouriteProject", url: home, value: false }).favourites,
  ).toEqual([]);
  expect(defaultPreferences.favourites).toEqual([]);
});

it("isolates each WebID, sign-out, reloads and global preference writes", async () => {
  const { host, unmount } = await mount(h(Consumer));
  await act(() => prefs.dispatch({ type: "favouriteProject", url: home, value: true }));
  expect(host.textContent).toBe("");
  await act(() => setPreferencesIdentity(alice));
  await act(() => prefs.dispatch({ type: "favouriteProject", url: home, value: true }));
  expect(host.textContent).toBe(home);
  expect(JSON.parse(localStorage.getItem(favouritesKey(alice)) ?? "null")).toEqual([home]);
  await act(() => prefs.dispatch({ type: "weekStart", value: "monday" }));
  expect(localStorage.getItem("suite.tasks.prefs")).not.toContain(home);
  await act(() => setPreferencesIdentity(bob));
  expect(host.textContent).toBe("");
  await act(() => prefs.dispatch({ type: "favouriteProject", url: work, value: true }));
  await act(() => setPreferencesIdentity(undefined));
  expect(host.textContent).toBe("");
  await act(() => setPreferencesIdentity(alice));
  expect(host.textContent).toBe(home);
  await unmount();
  const reloaded = await mount(h(Consumer));
  expect(reloaded.host.textContent).toBe(home);
  await act(() => setPreferencesIdentity(bob));
  expect(reloaded.host.textContent).toBe(work);
});

it("responds only to the current account's storage events", async () => {
  setPreferencesIdentity(alice);
  const { host } = await mount(h(Consumer));
  const event = (key: string) => new window.StorageEvent("storage", { key });
  localStorage.setItem(favouritesKey(alice), JSON.stringify([home]));
  await act(() => window.dispatchEvent(event(favouritesKey(bob))));
  expect(host.textContent).toBe("");
  await act(() => window.dispatchEvent(event(favouritesKey(alice))));
  expect(host.textContent).toBe(home);
});

it("ignores a favourite callback retained from the previous account", async () => {
  setPreferencesIdentity(alice);
  const { host } = await mount(h(Consumer));
  const oldDispatch = prefs.dispatch;
  await act(() => setPreferencesIdentity(bob));
  await act(() => oldDispatch({ type: "favouriteProject", url: home, value: true }));
  expect(host.textContent).toBe("");
  expect(localStorage.getItem(favouritesKey(bob))).toBeNull();
  await act(() => prefs.dispatch({ type: "favouriteProject", url: work, value: true }));
  expect(host.textContent).toBe(work);
});

it("keeps storage-disabled favourites in memory only for their owning WebID", async () => {
  setPreferencesIdentity(alice);
  const prototype = Object.getPrototypeOf(window.localStorage);
  vi.spyOn(prototype, "getItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  vi.spyOn(prototype, "setItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  const { host } = await mount(h(Consumer));
  await act(() => prefs.dispatch({ type: "favouriteProject", url: home, value: true }));
  expect(host.textContent).toBe(home);
  await act(() => window.dispatchEvent(new window.StorageEvent("storage", { key: null })));
  expect(host.textContent).toBe(home);
  await act(() => setPreferencesIdentity(bob));
  expect(host.textContent).toBe("");
  await act(() => setPreferencesIdentity(alice));
  expect(host.textContent).toBe("");
});
