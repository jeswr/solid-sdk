// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { beforeEach, expect, it, vi } from "vitest";
import type { HomeSession } from "../src/apps/home/state/use-domain-items";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import { act, click, h, mount } from "./drive-ui-dom";

const { current, router } = vi.hoisted(() => ({
  current: { session: undefined as HomeSession | undefined },
  router: { push: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => current.session }));

import { ItemPage } from "../src/apps/home/components/item/item-page";
import { itemHref } from "../src/apps/home/state/presentation";
import { domainStore } from "../src/apps/home/state/use-domain-items";

const root = "https://pod.example/alice/";
const url = `${root}contacts/ada.ttl`;
const VCARD = "http://www.w3.org/2006/vcard/ns#";
const twoEmails = `<#it> a <${VCARD}Individual>; <https://schema.org/name> "Ada"; <${VCARD}hasEmail> <mailto:a@example.org>, <mailto:b@example.org>.`;
const oneEmail = `<#it> a <${VCARD}Individual>; <https://schema.org/name> "Ada"; <${VCARD}hasEmail> <mailto:a@example.org>.`;

beforeEach(() => {
  localStorage.clear();
  router.push.mockClear();
});

async function open(body: string, options: { webId?: string; target?: string } = {}) {
  const pod = createDemoPod({
    root,
    seed: [{ path: "contacts/ada.ttl", contentType: "text/turtle", body }],
  });
  const fetch = vi.fn<typeof globalThis.fetch>(pod.fetch);
  current.session = {
    mode: "demo",
    fetch,
    storageUrl: root,
    webId: options.webId ?? `${root}profile/card#me`,
    displayName: "Alice",
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const view = await mount(
    h(ItemPage, { domain: "socials", itemRef: encodeRef(options.target ?? url) }),
  );
  await settle(view.host);
  return { view, pod, fetch };
}
async function settle(host: HTMLElement) {
  // The RDF parser completes through stream tasks, beyond React's own microtask flush.
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('[aria-label="Loading item"]')).toBeNull();
  });
}
const button = (host: ParentNode, text: string) =>
  [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === text) as
    | HTMLButtonElement
    | undefined;
const inputLabelled = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll<HTMLInputElement>("input")].find(
    (input) => input.labels?.[0]?.textContent === label,
  ) as HTMLInputElement;
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("finding 2: shows both emails read-only and saving the name keeps both", async () => {
  const { view, pod } = await open(twoEmails);
  await click(button(view.host, "Edit") as HTMLButtonElement);
  const email = inputLabelled(view.host, "Email");
  expect(email.readOnly).toBe(true);
  expect(email.disabled).toBe(false);
  expect(email.value).toBe("a@example.org, b@example.org");
  expect(
    document.getElementById(email.getAttribute("aria-describedby") as string)?.textContent,
  ).toBe("Edit these in the app that created them.");
  await type(inputLabelled(view.host, "Name (required)"), "Ada L");
  await click(view.host.querySelector('button[type="submit"]') as HTMLButtonElement);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.querySelector("h1")?.textContent).toBe("Ada L");
  });
  const saved = await (await pod.fetch(url)).text();
  expect(saved).toContain("mailto:a@example.org");
  expect(saved).toContain("mailto:b@example.org");
  await view.unmount();
});

it("finding 2: Keep my changes never replaces an email that gained a second value elsewhere", async () => {
  const { view, pod } = await open(oneEmail);
  await click(button(view.host, "Edit") as HTMLButtonElement);
  await type(inputLabelled(view.host, "Email"), "c@example.org");
  await pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: twoEmails,
  });
  await click(view.host.querySelector('button[type="submit"]') as HTMLButtonElement);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "This item changed since you opened it",
    );
  });
  await click(button(document, "Keep my changes") as HTMLButtonElement);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe(
      "Email can't be changed here. Edit these in the app that created them.",
    );
  });
  const kept = await (await pod.fetch(url)).text();
  expect(kept).toContain("mailto:a@example.org");
  expect(kept).toContain("mailto:b@example.org");
  expect(kept).not.toContain("c@example.org");
  await view.unmount();
});

it("finding 6: opens a WebID profile hosted outside storage read-only, without the pod's transport", async () => {
  const webId = "https://id.example/alice/card#me";
  const publicFetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(
        `<#me> a <http://xmlns.com/foaf/0.1/Person>; <http://xmlns.com/foaf/0.1/name> "Alice Wilder"; <${VCARD}hasEmail> <mailto:alice@example.org>.`,
        { headers: { "content-type": "text/turtle", etag: '"p1"' } },
      ),
  );
  const stub = vi.spyOn(globalThis, "fetch").mockImplementation(publicFetch);
  try {
    const { view, fetch } = await open(oneEmail, {
      webId,
      target: "https://id.example/alice/card",
    });
    expect(view.host.querySelector("h1")?.textContent).toBe("Alice Wilder");
    expect(view.host.textContent).toContain("alice@example.org");
    expect(button(view.host, "Edit")).toBeUndefined();
    // No endless Retry: neither the page nor its access section tries the pod's transport.
    expect(button(view.host, "Retry")).toBeUndefined();
    expect(view.host.textContent).toContain("Anyone with the link");
    expect(publicFetch).toHaveBeenCalledWith(
      "https://id.example/alice/card",
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
    expect(
      fetch.mock.calls.some(([input]) => String(input).startsWith("https://id.example/")),
    ).toBe(false);
    await view.unmount();
    // Any other address outside storage is simply not here; no endless Retry.
    const other = await open(oneEmail, { webId, target: "https://elsewhere.example/doc" });
    expect(other.view.host.textContent).toContain("This item isn't here any more");
    expect(button(other.view.host, "Retry")).toBeUndefined();
    await other.view.unmount();
  } finally {
    stub.mockRestore();
  }
});

it("finding 7: the item page names the person the card names", async () => {
  const bob = "https://bob.example/profile#me";
  const { view } = await open(
    `${oneEmail} <#it> <http://www.w3.org/ns/prov#wasAttributedTo> <${bob}>. <${bob}> a <http://xmlns.com/foaf/0.1/Person>; <http://xmlns.com/foaf/0.1/name> "Bob Jones".`,
  );
  const source = [...view.host.querySelectorAll("dt")].find((dt) => dt.textContent === "Source");
  expect(source?.nextElementSibling?.textContent).toBe("Bob Jones");
  expect(view.host.textContent).not.toContain("another app");
  await view.unmount();
});

it("finding 10: offline, Edit stays disabled and the saved copy says when it was read", async () => {
  const pod = createDemoPod({
    root,
    seed: [{ path: "contacts/ada.ttl", contentType: "text/turtle", body: oneEmail }],
  });
  const session: HomeSession = {
    mode: "demo",
    fetch: pod.fetch,
    storageUrl: root,
    webId: `${root}profile/card#me`,
    displayName: "Alice",
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  current.session = session;
  await domainStore(session).refresh();
  const loadedAt = domainStore(session).getSnapshot().loadedAt as number;
  expect(loadedAt).toBeTypeOf("number");
  const connection = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    const view = await mount(h(ItemPage, { domain: "socials", itemRef: encodeRef(url) }));
    await settle(view.host);
    const time = new Date(loadedAt).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(view.host.textContent).toContain(
      `Showing saved copies as of ${time}. Reconnect to save.`,
    );
    // There is no outbox, so an offline edit could not be saved: Edit is never enabled.
    expect(button(view.host, "Edit")?.disabled ?? true).toBe(true);
    await view.unmount();
  } finally {
    connection.mockRestore();
  }
});

it("offline navigation opens the primary imported record even when its sibling sorts first", async () => {
  const historyUrl = `${root}integrations/netflix/media/viewing-history.ttl`;
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "integrations/netflix/media/viewing-history.ttl",
        contentType: "text/turtle",
        body: `@prefix s: <https://schema.org/>. @prefix prov: <http://www.w3.org/ns/prov#>.
        <#garden> a s:WatchAction; s:name "The Garden"; prov:wasGeneratedBy <#import>.
        <#weekend> a s:WatchAction; s:name "A Quiet Weekend"; prov:wasGeneratedBy <#import>.`,
      },
    ],
  });
  const fetch = vi.fn(pod.fetch);
  const session: HomeSession = {
    mode: "demo",
    fetch,
    storageUrl: root,
    webId: `${root}profile/card#me`,
    displayName: "Alice",
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  current.session = session;
  await domainStore(session).refresh();
  const items = domainStore(session).getSnapshot().items;
  expect(items.map((item) => item.title)).toEqual(["A Quiet Weekend", "The Garden"]);
  const garden = items.find((item) => item.title === "The Garden");
  if (!garden) throw new Error("Missing Garden card");
  expect(itemHref(garden)).not.toContain("?s=");
  const connection = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  fetch.mockClear();
  try {
    const view = await mount(h(ItemPage, { domain: "media", itemRef: encodeRef(historyUrl) }));
    try {
      await settle(view.host);
      expect(view.host.querySelector("h1")?.textContent).toBe("The Garden");
      expect(view.host.textContent).toContain("Showing saved copies");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  } finally {
    connection.mockRestore();
  }
});
