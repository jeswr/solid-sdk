// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, click, h, key, mount } from "./drive-ui-dom";

vi.mock("../src/apps/home/components/home-app", () => ({
  useHomeSession: () => ({
    webId: "https://pod.example/profile#me",
    storageUrl: "https://pod.example/",
    fetch,
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

import { ConnectCatalogue } from "../src/apps/home/components/connect/catalogue";
import { ConnectFlow } from "../src/apps/home/components/connect/flow";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it.each([
  "discord",
  "reddit",
])("explains and fixes the required identity permission for %s", async (service) => {
  const { host } = await mount(h(ConnectFlow, { service }));
  const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  const identity = boxes.find((box) => box.disabled);
  if (!identity) throw new Error("Missing required identity permission");
  expect(identity.checked).toBe(true);
  expect(identity.parentElement?.textContent).toContain(
    "Required to identify your account before importing.",
  );
  for (const box of boxes.filter((box) => !box.disabled)) await click(box);
  expect(identity.checked).toBe(true);
  expect(boxes.filter((box) => !box.disabled).every((box) => !box.checked)).toBe(true);
  const next = host.querySelector<HTMLButtonElement>(".hm-connect-result > button");
  expect(next?.disabled).toBe(false);
});

it("honours the shell shortcut setting at each keypress and tolerates blocked storage", async () => {
  const { host } = await mount(h(ConnectCatalogue));
  const search = host.querySelector<HTMLInputElement>('input[type="search"]');
  const link = host.querySelector<HTMLAnchorElement>("a");
  if (!link || !search) throw new Error("Missing Connect controls");
  link.focus();
  localStorage.setItem("suite.settings.shortcuts", "off");
  await key(link, "n");
  expect(document.activeElement).toBe(link);
  localStorage.setItem("suite.settings.shortcuts", "on");
  await key(link, "n");
  expect(document.activeElement).toBe(search);
  await act(() => link.focus());
  vi.spyOn(Object.getPrototypeOf(localStorage), "getItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  await key(link, "n");
  expect(document.activeElement).toBe(search);
});
