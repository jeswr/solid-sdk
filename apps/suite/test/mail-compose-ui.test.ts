// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import type AxeBuilder from "@axe-core/playwright";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MailClient } from "../src/apps/mail/lib/client";
import { MailError, type SavedDraft } from "../src/apps/mail/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  mode: "demo" as "demo" | "solid" | "extension",
  params: new URLSearchParams(),
  router: { push: vi.fn(), replace: vi.fn() },
  invalidate: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.params,
}));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => h("a", props) }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: mocks.toast,
}));
vi.mock("../src/apps/mail/state/mail-context", () => ({
  useMail: () => ({
    client,
    account: "personal",
    session: { mode: mocks.mode },
    invalidate: mocks.invalidate,
  }),
}));

import { ComposePage } from "../src/apps/mail/components/compose";

const requireSuite = createRequire(new URL("../package.json", import.meta.url));
const axe = createRequire(requireSuite.resolve("@axe-core/playwright"))("axe-core") as {
  run(
    node: Element,
    options: Parameters<AxeBuilder["options"]>[0],
  ): ReturnType<AxeBuilder["analyze"]>;
};
const fields = { to: ["bob@example.org"], cc: [], subject: "Garden rota", text: "Water Thursday?" };
let client: MailClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = "demo";
  mocks.params = new URLSearchParams();
  const pod = createDemoPod({ root: "https://mail.example/" });
  client = new MailClient(pod.fetch, pod.root, `${pod.root}profile/card#me`, "demo");
});
afterEach(() => vi.restoreAllMocks());
function button(host: HTMLElement, text: string) {
  const result = [...host.querySelectorAll("button")].find((node) => node.textContent === text);
  if (!result) throw new Error(`Missing button ${text}`);
  return result;
}
function control(host: HTMLElement, label: string) {
  const id = [...host.querySelectorAll("label")].find(
    (node) => node.textContent === label,
  )?.htmlFor;
  const input = [
    ...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea"),
  ].find((node) => node.id === id);
  if (!input) throw new Error(`Missing field ${label}`);
  return input;
}
async function fill(host: HTMLElement, label: string, value: string) {
  const input = control(host, label);
  const prototype =
    input.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  await act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function shortcut(host: HTMLElement, modifier: "ctrlKey" | "metaKey") {
  await act(() =>
    host.querySelector("form")?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        [modifier]: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}
async function editing() {
  const saved = await client.saveDraft("personal", fields);
  const draft = await client.draft(saved.iri);
  mocks.params.set("draft", encodeRef(saved.iri));
  return { saved, draft, view: await mount(h(ComposePage)) };
}

it.each([
  "demo",
  "solid",
  "extension",
] as const)("enables Send with recipients only in %s mode and keeps the form accessible", async (mode) => {
  mocks.mode = mode;
  const view = await mount(h("main", null, h(ComposePage)));
  expect(button(view.host, "Send").disabled).toBe(true);
  await shortcut(view.host, "ctrlKey");
  expect(mocks.toast).not.toHaveBeenCalled();
  await fill(view.host, "To", "Bob Example <bob@example.org>");
  expect(button(view.host, "Send").disabled).toBe(mode !== "demo");
  expect(view.host.textContent).toContain(
    mode === "demo"
      ? "Demo pod: Send files the message in Sent. Nothing leaves your browser."
      : "Sending needs a connected mail account. Drafts are saved in your pod.",
  );
  const note = document.getElementById(
    button(view.host, "Send").getAttribute("aria-describedby") ?? "",
  );
  expect(note?.textContent).toContain(
    mode === "demo" ? "Nothing leaves" : "connected mail account",
  );
  await fill(view.host, "To", " , ; ");
  expect(button(view.host, "Send").disabled).toBe(true);
  await fill(view.host, "Cc", "cara@example.org");
  expect(button(view.host, "Send").disabled).toBe(mode !== "demo");
  if (mode !== "demo") {
    await shortcut(view.host, "metaKey");
    expect(mocks.router.push).not.toHaveBeenCalled();
  }
  const results = await axe.run(view.host, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
  await view.unmount();
});

it("saves a new compose before sending, uses the new ETag, toasts with a View link and navigates to Sent", async () => {
  const persist = client.saveDraft.bind(client);
  const pending = deferred<SavedDraft>();
  const save = vi.spyOn(client, "saveDraft").mockReturnValue(pending.promise);
  const send = vi.spyOn(client, "sendDemo");
  const view = await mount(h(ComposePage));
  await fill(view.host, "To", "Bob <bob@example.org>");
  await fill(view.host, "Subject", fields.subject);
  await fill(view.host, "Message", fields.text);
  await click(button(view.host, "Send"));
  expect(save).toHaveBeenCalledWith("personal", fields, undefined);
  expect(send).not.toHaveBeenCalled();
  expect(button(view.host, "Send").disabled).toBe(true);
  expect(control(view.host, "Message").disabled).toBe(true);
  await shortcut(view.host, "ctrlKey");
  expect(save).toHaveBeenCalledOnce();
  const saved = await persist("personal", fields);
  const draft = await client.draft(saved.iri);
  await act(() => pending.resolve(saved));
  expect(send).toHaveBeenCalledExactlyOnceWith(saved.iri, saved.etag);
  expect(mocks.router.replace).not.toHaveBeenCalled();
  expect(mocks.router.push).toHaveBeenCalledWith("/mail/sent");
  expect(mocks.toast).toHaveBeenCalledWith(
    "Saved in Sent (demo, not delivered)",
    expect.any(Object),
  );
  const options = mocks.toast.mock.calls[0]?.[1] as { action: ReactNode };
  const notice = await mount(h("div", null, options.action));
  expect(notice.host.querySelector("a")?.getAttribute("href")).toBe(
    `/mail/t/${encodeRef(draft.thread)}`,
  );
  expect(notice.host.querySelector("a")?.textContent).toBe("View");
  expect(mocks.invalidate).toHaveBeenCalledTimes(2);
  await notice.unmount();
  await view.unmount();
});

it.each([
  "ctrlKey",
  "metaKey",
] as const)("sends a clean existing draft with %s+Enter without rewriting it", async (modifier) => {
  const { saved, view } = await editing();
  const save = vi.spyOn(client, "saveDraft");
  const send = vi.spyOn(client, "sendDemo");
  await shortcut(view.host, modifier);
  expect(save).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledExactlyOnceWith(saved.iri, saved.etag);
  expect(mocks.router.push).toHaveBeenCalledWith("/mail/sent");
  await view.unmount();
});

it("persists unsaved draft edits before sending the resulting version", async () => {
  const { saved, view } = await editing();
  const save = vi.spyOn(client, "saveDraft");
  const send = vi.spyOn(client, "sendDemo");
  await fill(view.host, "Message", "New message body");
  await click(button(view.host, "Send"));
  expect(save).toHaveBeenCalledWith("personal", { ...fields, text: "New message body" }, saved);
  const next = await save.mock.results[0]?.value;
  if (!next) throw new Error("Draft save did not return its new version");
  expect(next.etag).not.toBe(saved.etag);
  expect(send).toHaveBeenCalledExactlyOnceWith(saved.iri, next.etag);
  expect(mocks.router.push).toHaveBeenCalledWith("/mail/sent");
  await view.unmount();
});

it("preserves compose fields on send conflicts and never toasts or navigates as if sent", async () => {
  const { view } = await editing();
  vi.spyOn(client, "sendDemo").mockRejectedValue(new MailError("conflict", 412));
  await click(button(view.host, "Send"));
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("changed elsewhere");
  expect(control(view.host, "Message").value).toBe(fields.text);
  expect(button(view.host, "Send").disabled).toBe(false);
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(mocks.router.push).not.toHaveBeenCalled();
  await view.unmount();
});

it("keeps malformed recipients in compose and never sends after draft validation fails", async () => {
  const view = await mount(h(ComposePage));
  const send = vi.spyOn(client, "sendDemo");
  await fill(view.host, "To", "not-an-address");
  await click(button(view.host, "Send"));
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("Not an email address");
  expect(control(view.host, "To").value).toBe("not-an-address");
  expect(send).not.toHaveBeenCalled();
  expect(mocks.router.push).not.toHaveBeenCalled();
  await view.unmount();
});

it("retains explicit Save draft behaviour for non-demo compose", async () => {
  mocks.mode = "solid";
  const view = await mount(h(ComposePage));
  await fill(view.host, "To", "bob@example.org");
  await click(button(view.host, "Save draft"));
  expect(mocks.router.replace).toHaveBeenCalledWith(
    expect.stringMatching(/^\/mail\/compose\?draft=/),
  );
  expect(mocks.toast).toHaveBeenCalledWith("Draft saved");
  expect(button(view.host, "Send").disabled).toBe(true);
  await view.unmount();
});
