// AUTHORED-BY Codex GPT-6.1-Sol
import { createElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, click, h, mount } from "./drive-ui-dom";

const mutations = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), setLabel: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
}));
vi.mock("../src/apps/contacts/state/contacts-context", () => ({
  useContact: () => ({
    status: "ready",
    book: { url: "https://alice.demo.pod/contacts/book.ttl" },
    data: { people: [], groups: [] },
  }),
  useContactMutations: () => mutations,
}));

import { ContactEditor } from "../src/apps/contacts/components/contact-form";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("HTMLFormElement", window.HTMLFormElement);
  vi.stubGlobal("DocumentFragment", window.DocumentFragment);
});

async function editor(width: number) {
  vi.stubGlobal("matchMedia", () => ({
    matches: width >= 1024,
    addEventListener() {},
    removeEventListener() {},
  }));
  const view = await mount(h(ContactEditor));
  const form = document.querySelector(".con-form") as HTMLFormElement;
  return {
    ...view,
    form,
    field: (name: string) =>
      form.querySelector<HTMLInputElement>(`[name="${name}"]`) as HTMLInputElement,
    button: (text: string) =>
      [...form.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === text,
      ) as HTMLButtonElement,
  };
}
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    // Include RHF's deferred focus pass so it cannot override the chosen field unnoticed.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

it.each([375, 1280])("focuses appended errors in visual order at %spx", async (width) => {
  const view = await editor(width);
  await fill(view.field("name"), "Draft");
  await click(view.button("Add email"));
  await click(view.button("Add phone"));
  await fill(view.field("emails.1.value"), "broken");
  await fill(view.field("phones.1.value"), "broken");
  await fill(view.field("webId"), "broken");

  await submit(view.form);
  expect(view.form.querySelector(".con-form-summary")?.textContent).toBe("3 fields need attention");
  expect(document.activeElement).toBe(view.field("emails.1.value"));
  await fill(view.field("emails.1.value"), "draft@example.org");
  await submit(view.form);
  expect(document.activeElement).toBe(view.field("phones.1.value"));
  await fill(view.field("phones.1.value"), "+1 202 555 0193");
  await submit(view.form);
  expect(document.activeElement).toBe(view.field("webId"));
  expect(mutations.create).not.toHaveBeenCalled();
  expect(mutations.update).not.toHaveBeenCalled();
});

for (const width of [375, 1280]) {
  for (const point of ["email", "phone"] as const) {
    it(`keeps focus after ${point} removal at ${width}px`, async () => {
      const view = await editor(width);
      const add = view.button(`Add ${point}`);
      for (let i = 0; i < 3; i++) await click(add);
      const fields = [0, 1, 2, 3].map((index) => view.field(`${point}s.${index}.value`));
      const remove = async (input: HTMLInputElement, index: number, target: HTMLElement) => {
        const button = view.form.querySelector<HTMLButtonElement>(
          `button[aria-label="Remove ${point} ${index + 1}"]`,
        );
        expect(button).not.toBeNull();
        await act(async () => (button as HTMLButtonElement).focus());
        // A keyboard Enter/Space on a native button dispatches click.
        await click(button as HTMLButtonElement);
        expect(input.isConnected).toBe(false);
        expect(document.activeElement).toBe(target);
      };
      await remove(fields[1] as HTMLInputElement, 1, fields[2] as HTMLInputElement);
      await remove(fields[3] as HTMLInputElement, 2, fields[2] as HTMLInputElement);
      await remove(fields[0] as HTMLInputElement, 0, fields[2] as HTMLInputElement);
      await remove(fields[2] as HTMLInputElement, 0, add);
      expect(view.form.querySelectorAll(`input[name^="${point}s."]`)).toHaveLength(0);
    });
  }
}
