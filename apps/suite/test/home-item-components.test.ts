// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { beforeEach, expect, it, vi } from "vitest";
import type { HomeSession } from "../src/apps/home/state/use-domain-items";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import { act, click, h, key, mount } from "./drive-ui-dom";

const { current, router } = vi.hoisted(() => ({
  current: { session: undefined as HomeSession | undefined },
  router: { push: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../src/apps/home/components/home-app", () => ({ useHomeSession: () => current.session }));

import { readItem } from "../src/apps/home/components/item/data";
import { ItemForm } from "../src/apps/home/components/item/item-form";
import { ItemPage } from "../src/apps/home/components/item/item-page";
import { CONTACT_FIELDS } from "../src/apps/home/lib/forms/edit-map";

const root = "https://pod.example/alice/";
const url = `${root}contacts/ada.ttl`;
beforeEach(() => {
  localStorage.clear();
  router.push.mockClear();
});
async function setup(status = 200, wac = 'user="read write"') {
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "contacts/ada.ttl",
        contentType: "text/turtle",
        body: '<#it> a <http://www.w3.org/2006/vcard/ns#Individual>; <https://schema.org/name> "Ada"; <http://www.w3.org/2006/vcard/ns#hasEmail> <mailto:ada@example.org>.',
      },
    ],
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (String(input) === url) {
      if (status !== 200) return new Response(null, { status });
      const response = await pod.fetch(input, init);
      response.headers.set("wac-allow", wac);
      return response;
    }
    return pod.fetch(input, init);
  };
  current.session = {
    mode: "demo",
    fetch,
    storageUrl: root,
    webId: `${root}profile/card#me`,
    displayName: "Alice",
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const view = await mount(h(ItemPage, { domain: "socials", itemRef: encodeRef(url) }));
  // The RDF parser completes through stream tasks, beyond React's own microtask flush.
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.querySelector('[aria-label="Loading item"]')).toBeNull();
  });
  return { view, pod };
}
it("renders one heading, the name and email, source-free details, and item-filtered sharing", async () => {
  const { view } = await setup();
  expect(view.host.querySelectorAll("h1")).toHaveLength(1);
  expect(view.host.querySelector("h1")?.textContent).toBe("Ada");
  expect(view.host.textContent).toContain("ada@example.org");
  expect(view.host.textContent).not.toMatch(/https?:|RDF|Type Index/);
  expect(view.host.querySelector("#access a")?.getAttribute("href")).toBe(
    `/permissions?item=${encodeRef(url)}`,
  );
  await key(view.host, ".");
  expect(router.push).toHaveBeenCalledWith(`/permissions?item=${encodeRef(url)}`);
  await view.unmount();
});
it("has a friendly missing-item state and a back link, and hides Edit for read-only data", async () => {
  let { view } = await setup(404);
  expect(view.host.textContent).toContain("This item isn't here any more");
  expect(view.host.querySelector("a")?.getAttribute("href")).toBe("/home/socials");
  await view.unmount();
  ({ view } = await setup(200, 'user="read"'));
  expect(
    [...view.host.querySelectorAll("button")].some((button) => button.textContent === "Edit"),
  ).toBe(false);
  await view.unmount();
});
it("opens labelled inline fields and associates validation errors with the matching input", async () => {
  const { view } = await setup();
  const edit = [...view.host.querySelectorAll("button")].find(
    (button) => button.textContent === "Edit",
  ) as HTMLButtonElement;
  await click(edit);
  expect(view.host.querySelector("label")?.textContent).toBe("Name (required)");
  const session = current.session as HomeSession;
  const read = await readItem(session, url);
  const save = vi.fn();
  const form = await mount(
    h(ItemForm, {
      fields: CONTACT_FIELDS,
      dataset: read.item.dataset,
      subject: read.item.subject.value,
      blank: true,
      online: true,
      busy: false,
      onSave: save,
      onCancel: vi.fn(),
    }),
  );
  await click(form.host.querySelector('button[type="submit"]') as HTMLButtonElement);
  expect(save).not.toHaveBeenCalled();
  const invalid = form.host.querySelector('[aria-invalid="true"]') as HTMLInputElement;
  expect(invalid.labels?.[0]?.textContent).toBe("Name (required)");
  expect(
    document.getElementById(invalid.getAttribute("aria-describedby") as string)?.textContent,
  ).toBe("Enter name.");
  expect(document.activeElement).toBe(invalid);
  await form.unmount();
  await view.unmount();
});

it("keeps local edits through a real 412 dialog and rebases changed fields on the newest document", async () => {
  const { view, pod } = await setup();
  await click(
    [...view.host.querySelectorAll("button")].find(
      (button) => button.textContent === "Edit",
    ) as HTMLButtonElement,
  );
  const name = view.host.querySelector("input") as HTMLInputElement;
  expect(name.value).toBe("Ada");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "My Ada");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const connection = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => {
    window.dispatchEvent(new Event("offline"));
  });
  expect((view.host.querySelector("input") as HTMLInputElement).value).toBe("My Ada");
  expect(view.host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  connection.mockReturnValue(true);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  expect((view.host.querySelector("input") as HTMLInputElement).value).toBe("My Ada");
  connection.mockRestore();
  const prior = await (await pod.fetch(url)).text();
  await pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: prior.replace("ada@example.org", "new@example.org"),
  });
  await click(view.host.querySelector('button[type="submit"]') as HTMLButtonElement);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "This item changed since you opened it",
    );
  });
  const keep = [...document.querySelectorAll('[role="dialog"] button')].find(
    (button) => button.textContent === "Keep my changes",
  ) as HTMLButtonElement;
  await click(keep);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.querySelector("h1")?.textContent).toBe("My Ada");
  });
  expect(view.host.textContent).toContain("new@example.org");
  await view.unmount();
});

// AUTHORED-BY Claude Opus 5.5 — fix round 3 (finding 4)
it("validates only changed fields, so a legacy email doesn't block saving the name", async () => {
  const subject = `${url}#it`;
  const dataset = await parseRdf(
    '<#it> <http://www.w3.org/2006/vcard/ns#fn> "Ada"; <http://www.w3.org/2006/vcard/ns#hasEmail> <mailto:ada@localhost>.',
    "text/turtle",
    { baseIRI: url },
  );
  const save = vi.fn();
  const form = await mount(
    h(ItemForm, {
      fields: CONTACT_FIELDS,
      dataset,
      subject,
      online: true,
      busy: false,
      onSave: save,
      onCancel: vi.fn(),
    }),
  );
  const input = (label: string) =>
    [...form.host.querySelectorAll<HTMLInputElement>("input")].find((element) =>
      element.labels?.[0]?.textContent?.startsWith(label),
    ) as HTMLInputElement;
  const type = (element: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        element,
        value,
      );
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  expect(input("Email").value).toBe("ada@localhost");
  await type(input("Name"), "Ada L");
  await click(form.host.querySelector('button[type="submit"]') as HTMLButtonElement);
  expect(form.host.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(save).toHaveBeenCalledWith({ [(CONTACT_FIELDS[0] as { id: string }).id]: "Ada L" });
  // Once the email itself is edited, it is checked as before.
  save.mockClear();
  await type(input("Email"), "still@localhost");
  await click(form.host.querySelector('button[type="submit"]') as HTMLButtonElement);
  expect(save).not.toHaveBeenCalled();
  expect(form.host.querySelector('[aria-invalid="true"]')).toBe(input("Email"));
  await form.unmount();
});
