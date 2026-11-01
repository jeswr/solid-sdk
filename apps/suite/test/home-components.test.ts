// AUTHORED-BY Codex GPT-6
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classificationForType } from "../src/apps/home/lib/model/classify";
import type { DomainItem } from "../src/apps/home/lib/model/discovery";
import { DOMAINS } from "../src/apps/home/lib/model/domains";
import type { HomeSession } from "../src/apps/home/state/use-domain-items";
import { act, h, mount } from "./drive-ui-dom";

const { router, current } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  current: { session: undefined as HomeSession | undefined },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/home",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/apps/home/components/home-app", () => ({
  useHomeSession: () => current.session,
}));

import { DomainNavigation } from "../src/apps/home/components/domain-navigation";
import { HomeCard } from "../src/apps/home/components/home-card";
import { HomePage } from "../src/apps/home/components/home-page";

const storage = "https://pod.example/alice/";
beforeEach(() => {
  localStorage.clear();
  router.push.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  current.session = {
    mode: "demo",
    webId: `${storage}profile/card#me`,
    displayName: "Alice",
    storageUrl: storage,
    fetch: vi.fn(),
    subscribe: () => () => {},
    reset: async () => {},
  };
});
afterEach(() => vi.restoreAllMocks());

async function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("Home character shortcuts", () => {
  it("honours the shared off preference immediately and re-enables all nine shortcuts", async () => {
    const view = await mount(
      h(DomainNavigation, { domains: DOMAINS, active: "personal", counts: new Map() }),
    );
    localStorage.setItem("suite.settings.shortcuts", "off");
    for (let key = 1; key <= 9; key++)
      expect((await press(String(key))).defaultPrevented).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    localStorage.removeItem("suite.settings.shortcuts");
    for (const [index, domain] of DOMAINS.entries()) {
      expect((await press(String(index + 1))).defaultPrevented).toBe(true);
      expect(router.push).toHaveBeenLastCalledWith(
        domain.id === "personal" ? "/home" : `/home/${domain.id}`,
      );
    }
    await view.unmount();
    router.push.mockClear();
    await press("2");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("survives unavailable preference storage and preserves modifier and input exclusions", async () => {
    const view = await mount(
      h(DomainNavigation, { domains: DOMAINS, active: "personal", counts: new Map() }),
    );
    vi.spyOn(Object.getPrototypeOf(localStorage), "getItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    await press("2");
    expect(router.push).toHaveBeenCalledWith("/home/documents");
    router.push.mockClear();
    for (const init of [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      expect((await press("2", init)).defaultPrevented).toBe(false);
    }
    for (const tag of ["input", "textarea", "select"]) {
      const input = document.createElement(tag);
      view.host.append(input);
      expect((await press("2", {}, input)).defaultPrevented).toBe(false);
    }
    await press("0");
    expect(router.push).not.toHaveBeenCalled();
    await view.unmount();
  });
});

const item: DomainItem = {
  ...classificationForType("photos"),
  url: `${storage}photos/picture.ttl`,
  subject: DataFactory.namedNode(`${storage}photos/picture.ttl#it`),
  title: "Picture",
  containerUrl: `${storage}photos/`,
  dataset: new Store(),
  etag: null,
};
const card = (src: string) =>
  h(HomeCard, {
    item,
    view: {
      types: [`${NS.SCHEMA}Photograph`],
      title: "Picture",
      properties: [],
      image: { src, alt: "Picture" },
    },
    storage,
    webId: `${storage}profile/card#me`,
  });

describe("Home image scope", () => {
  it("blocks a same-storage image redirect before the session reaches a foreign origin", async () => {
    const image = `${storage}photos/redirect.jpg`;
    const foreign = vi.fn(async () => new Response("Foreign image"));
    const sessionFetch = vi.fn<typeof fetch>(async (_input, init) => {
      // Model fetch's redirect contract: the default follows the Location target.
      const redirect = new Response(null, {
        status: 302,
        headers: { location: "https://foreign.example/image.jpg" },
      });
      if (init?.redirect === "error") throw new TypeError("Redirect refused");
      if (init?.redirect === "manual") return redirect;
      return foreign();
    });
    current.session = { ...(current.session as HomeSession), fetch: sessionFetch };
    const create = vi.spyOn(URL, "createObjectURL");
    const view = await mount(card(image));
    expect(sessionFetch).toHaveBeenCalledExactlyOnceWith(
      image,
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
    expect(foreign).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(view.host.querySelector("img")).toBeNull();
    expect(view.host.querySelector('[aria-label="Image unavailable"]')).not.toBeNull();
    await view.unmount();
  });

  it.each([
    "https://foreign.example/image.jpg",
    "https://pod.example/alice-elsewhere/image.jpg",
    `${storage}photos/..%2f..%2fimage.jpg`,
  ])("does not send an out-of-scope image to the session: %s", async (url) => {
    const view = await mount(card(url));
    expect(current.session?.fetch).not.toHaveBeenCalled();
    expect(view.host.querySelector("img")).toBeNull();
    await view.unmount();
  });

  it("still loads pod images and revokes their blob URL on unmount", async () => {
    const image = `${storage}photos/image.jpg`;
    current.session = {
      ...(current.session as HomeSession),
      fetch: vi.fn(async () => new Response("Image")),
    };
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:home-image");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const view = await mount(card(image));
    expect(view.host.querySelector("img")?.getAttribute("src")).toBe("blob:home-image");
    expect(current.session.fetch).toHaveBeenCalledWith(
      image,
      expect.objectContaining({ redirect: "error" }),
    );
    await view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:home-image");
  });
});

it("renders an offline empty state for a network cold open instead of indefinite skeletons", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  current.session = { ...(current.session as HomeSession), mode: "solid" };
  const view = await mount(h(HomePage, { domain: "personal" }));
  expect(current.session.fetch).not.toHaveBeenCalled();
  expect(view.host.textContent).toContain("Not available offline");
  expect(view.host.textContent).not.toContain("Showing saved copies");
  expect(view.host.querySelector(".suite-loading")).toBeNull();
  await view.unmount();
});
