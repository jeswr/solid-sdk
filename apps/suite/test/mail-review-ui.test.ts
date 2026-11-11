// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/noNonNullAssertion: DOM assertions establish the controls before use.
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  ThreadView as Conversation,
  FolderView,
  ImportResult,
  ThreadRow,
} from "../src/apps/mail/lib/client";
import { MailClient } from "../src/apps/mail/lib/client";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { encodeRef } from "../src/lib/refs";
import { act, click, deferred, h, key, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  params: new URLSearchParams(),
  pathname: "/mail/inbox",
  account: "imported",
  actions: { markRead: vi.fn(), star: vi.fn(), archive: vi.fn(), forRows: vi.fn() },
  setAccount: vi.fn(),
  invalidate: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => mocks.pathname,
  useSearchParams: () => mocks.params,
}));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => h("a", props) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/lib/refs", async () => import("../src/lib/refs"));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  toast: Object.assign(vi.fn(), { error: mocks.error }),
}));
vi.mock("../src/apps/mail/components/attachment", () => ({ MailAttachment: () => null }));
vi.mock("../src/apps/mail/state/mail-context", () => ({
  useMail: () => ({
    client,
    setAccount: mocks.setAccount,
    invalidate: mocks.invalidate,
    account: mocks.account,
  }),
  useMailActions: () => mocks.actions,
  useThread: () => ready(conversation),
  useFolders: () => ready(folders),
  useThreads: () => ready({ items: rows, total: rows.length, next: null }),
  useMailSearch: () => ready(rows),
}));

import { ImportWizard } from "../src/apps/mail/components/import-wizard";
import { NoMail, ThreadList } from "../src/apps/mail/components/thread-list";
import { ThreadView } from "../src/apps/mail/components/thread-view";
import { FolderPage, SearchPage } from "../src/apps/mail/components/views";

let client: MailClient;
let conversation: Conversation;
let folders: FolderView[];
let rows: ThreadRow[];
function ready<T>(data: T) {
  return { status: "ready", data, loadedVersion: 0, retry: vi.fn(), loadMore: vi.fn() };
}
function button(host: HTMLElement, text: string) {
  return [...host.querySelectorAll("button")].find((node) => node.textContent === text)!;
}
const summary: ImportResult = {
  messages: 1,
  attachments: 0,
  bytes: 10,
  failed: 0,
  failures: [],
  aborted: true,
  typeIndex: "missing",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.params = new URLSearchParams();
  mocks.pathname = "/mail/inbox";
  mocks.account = "imported";
  vi.stubGlobal("history", window.history);
  vi.stubGlobal("location", window.location);
  history.replaceState({}, "", "/mail/inbox");
  client = new MailClient(
    createDemoPod({ root: "https://mail.example/" }).fetch,
    "https://mail.example/",
  );
  const iri = `${client.root("imported")}threads/garden.ttl#it`;
  conversation = {
    iri,
    subject: "Saturday at the garden",
    messages: [
      {
        iri: `${client.root("imported")}messages/garden.ttl#it`,
        from: "Noel Hart",
        to: ["Mira Vale"],
        cc: [],
        date: new Date("2026-03-22T08:45:00Z"),
        subject: "Saturday at the garden",
        text: "Bring gloves.",
        quoted: {
          segments: [{ kind: "body", text: "Bring gloves.", depth: 0 }],
          visibleText: "Bring gloves.",
          hasQuotedHistory: false,
        },
        read: false,
        starred: false,
        draft: false,
        labels: [],
        attachments: [],
      },
    ],
  };
  rows = [0, 1].map((index) => ({
    iri: index ? `${iri}-2` : iri,
    subject: index ? "Train booking" : "Saturday at the garden",
    participants: ["Noel Hart"],
    snippet: "Bring gloves.",
    latest: new Date("2026-03-22T08:45:00Z"),
    count: 1,
    unread: true,
    starred: false,
    hasAttachment: true,
  }));
  folders = [
    {
      iri: `${client.root("imported")}folders/system:inbox.ttl#it`,
      key: "inbox",
      title: "Inbox",
      system: true,
      total: 2,
      unread: 2,
    },
  ];
});
afterEach(() => vi.restoreAllMocks());
it("renders a message-backed row, links to its message and selects it for bulk actions", async () => {
  const iri = `${client.root("imported")}messages/orphan.ttl#it`;
  const message = await client.store.load(iri.split("#")[0]!, true);
  const m = message.mailbox.createMessage(iri);
  m.partOfThread = `${client.root("imported")}threads/missing.ttl#it`;
  m.subjectLine = "Recovered mail";
  m.body = "Still here";
  m.sender = "mailto:noel@example.org";
  await client.store.save(message);
  const folder = await client.store.load(folders[0]!.iri.split("#")[0]!, true);
  folder.mailbox.createFolder(folders[0]!.iri).addMessage(iri);
  await client.store.save(folder);
  rows = (await client.threads("imported", folders[0]!.iri)).items;
  const view = await mount(h(ThreadList, { rows, title: "Inbox", refresh: vi.fn() }));
  const row = view.host.querySelector(`tr[data-thread="${iri}"]`)!;
  expect(row.textContent).toContain("Recovered mail");
  expect(row.textContent).toContain("Still here");
  expect(row.textContent).toContain("noel@example.org");
  expect(row.getAttribute("data-unread")).toBe("true");
  expect(row.querySelector("a")?.getAttribute("href")).toBe(
    `/mail/t/${encodeRef(iri)}?back=${encodeURIComponent("/mail/inbox")}`,
  );
  await click(row.querySelector("input")!);
  await click(view.host.querySelector('[aria-label="Mark read"]')!);
  expect(mocks.actions.forRows).toHaveBeenCalledWith(rows, "read", true);
  await view.unmount();
  conversation = await client.thread(iri);
  const threadView = await mount(h(ThreadView, { iri }));
  expect(threadView.host.querySelector("h1")?.textContent).toBe("Recovered mail");
  expect(threadView.host.querySelectorAll("article.mail-message")).toHaveLength(1);
  expect(threadView.host.textContent).toContain("Still here");
  expect(mocks.actions.markRead).toHaveBeenCalledWith([iri], true, iri);
  await threadView.unmount();
});
async function startWizard() {
  mocks.pathname = "/mail/import";
  history.replaceState({}, "", "/mail/import");
  const completion = deferred<ImportResult>();
  const importMail = vi.spyOn(client, "importMailbox").mockReturnValue(completion.promise);
  const view = await mount(h(ImportWizard));
  const input = view.host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["mail bytes"], "personal.mbox")],
  });
  await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(view.host.textContent).toContain("personal.mbox");
  expect(view.host.textContent).toContain("10 B");
  await act(() =>
    view.host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(importMail).toHaveBeenCalledOnce();
  return { view, completion, importMail };
}
it("fences a departed import's progress and completion after another account is selected", async () => {
  const { view, completion, importMail } = await startWizard();
  await view.unmount();
  mocks.setAccount("newer-account");
  await act(() => {
    importMail.mock.calls[0]?.[2]?.onProgress?.(summary);
    completion.resolve(summary);
  });
  expect(mocks.setAccount.mock.calls).toEqual([["newer-account"]]);
  expect(mocks.invalidate).not.toHaveBeenCalled();
});
it("invalidates the import generation as soon as confirmed navigation begins", async () => {
  const { view, completion } = await startWizard();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const link = document.createElement("a");
  link.href = "/mail/inbox";
  link.addEventListener("click", (event) => event.preventDefault());
  view.host.append(link);
  await click(link);
  expect(view.host.textContent).toContain("Import cancelled. Messages already saved");
  expect(view.host.querySelector('[aria-label="Import progress"]')).toBeNull();
  await act(() => completion.resolve(summary));
  expect(mocks.setAccount).not.toHaveBeenCalled();
  expect(mocks.invalidate).not.toHaveBeenCalled();
  await view.unmount();
  vi.restoreAllMocks();
});
it.each([
  "/mail/import",
  "/mail/import?view=progress",
  "#progress",
])("lets a same-route link to %s keep importing without a leave confirmation", async (href) => {
  const { view, completion, importMail } = await startWizard();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const link = document.createElement("a");
  link.href = href;
  link.addEventListener("click", (event) => event.preventDefault());
  view.host.append(link);
  await click(link);
  expect(confirm).not.toHaveBeenCalled();
  expect(importMail.mock.calls[0]?.[2]?.signal?.aborted).toBe(false);
  await act(() => completion.resolve({ ...summary, aborted: false }));
  expect(view.host.querySelector("h2")?.textContent).toBe("Import complete");
  expect(mocks.setAccount).toHaveBeenCalledWith("imported");
  await view.unmount();
});
it("can restart a cancelled import when confirmed navigation leaves the wizard mounted", async () => {
  const { view, completion, importMail } = await startWizard();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const link = document.createElement("a");
  link.href = "/mail/inbox";
  link.addEventListener("click", (event) => event.preventDefault());
  view.host.append(link);
  await click(link);
  expect(importMail.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
  const next = deferred<ImportResult>();
  importMail.mockReturnValueOnce(next.promise);
  await act(() =>
    view.host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(importMail).toHaveBeenCalledTimes(2);
  await act(() => completion.resolve(summary));
  expect(view.host.querySelector('[aria-label="Import progress"]')).not.toBeNull();
  expect(mocks.setAccount).not.toHaveBeenCalled();
  await act(() => next.resolve({ ...summary, aborted: false }));
  expect(view.host.querySelector("h2")?.textContent).toBe("Import complete");
  await view.unmount();
});
it.each([
  "unmount",
  "account",
  "route",
])("cancels sample import on %s and fences late completion and errors", async (departure) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("sample"));
  const completion = deferred<ImportResult>();
  const importer = vi.spyOn(client, "importMailbox").mockReturnValue(completion.promise);
  const view = await mount(h(NoMail, { title: "Inbox", inbox: true }));
  await click(button(view.host, "Try a sample mailbox"));
  expect(importer).toHaveBeenCalledOnce();
  if (departure === "unmount") await view.unmount();
  else {
    if (departure === "account") {
      mocks.account = "newer-account";
      mocks.setAccount(mocks.account);
    } else mocks.pathname = "/mail/archive";
    await view.render(h(NoMail, { title: "Inbox", inbox: true }));
    expect(button(view.host, "Try a sample mailbox").disabled).toBe(false);
  }
  expect(importer.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
  await act(() => completion.resolve({ ...summary, failed: 1 }));
  expect(mocks.setAccount.mock.calls).toEqual(departure === "account" ? [["newer-account"]] : []);
  expect(mocks.router.push).not.toHaveBeenCalled();
  expect(mocks.invalidate).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
  if (departure !== "unmount") await view.unmount();
});
it("cancels the sample download before importing and ignores its late rejection", async () => {
  const download = deferred<Response>();
  const fetchSample = vi.spyOn(globalThis, "fetch").mockReturnValue(download.promise);
  const importer = vi.spyOn(client, "importMailbox");
  const view = await mount(h(NoMail, { title: "Inbox", inbox: true }));
  await click(button(view.host, "Try a sample mailbox"));
  await view.unmount();
  expect(fetchSample.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await act(() => download.reject(new Error("cancelled download")));
  expect(importer).not.toHaveBeenCalled();
  expect(mocks.error).not.toHaveBeenCalled();
});
it("selects and opens the sample account after a live import finishes", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("sample"));
  vi.spyOn(client, "importMailbox").mockResolvedValue({ ...summary, aborted: false });
  const view = await mount(h(NoMail, { title: "Inbox", inbox: true }));
  await click(button(view.host, "Try a sample mailbox"));
  expect(mocks.setAccount).toHaveBeenCalledWith("sample");
  expect(mocks.invalidate).toHaveBeenCalledOnce();
  expect(mocks.router.push).toHaveBeenCalledWith("/mail/inbox");
  await view.unmount();
});
it("shows cancellation results while the current wizard is still mounted", async () => {
  const { view, completion } = await startWizard();
  await click(button(view.host, "Cancel import"));
  await act(() => completion.resolve(summary));
  expect(view.host.querySelector("h2")?.textContent).toBe("Import cancelled");
  expect(mocks.setAccount).toHaveBeenCalledWith("imported");
  await view.unmount();
});
it("has a single hidden file picker, a named form and scoped ZIP guidance", async () => {
  const view = await mount(h(ImportWizard));
  const form = view.host.querySelector('form[aria-label="Mailbox import"]')!;
  expect(form.querySelectorAll('input[type="file"]')).toHaveLength(1);
  expect(form.querySelector<HTMLInputElement>('input[type="file"]')!.hidden).toBe(true);
  expect(button(view.host, "Choose mailbox file")).toBeDefined();
  expect(view.host.textContent).not.toMatch(/Upload files|Upload folder/);
  const input = form.querySelector("input")!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["PK"], "Takeout.zip")],
  });
  await act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(form.querySelector('[role="alert"]')?.textContent).toBe(
    "Unzip your Takeout and choose the .mbox file inside",
  );
  expect(button(view.host, "Import mailbox").disabled).toBe(true);
  await view.unmount();
});
it("accepts a mailbox drop and rejects multiple files without extra upload controls", async () => {
  const view = await mount(h(ImportWizard));
  const zone = view.host.querySelector(".mail-file-picker")!;
  for (const files of [
    [new File(["mail"], "inbox.mbox")],
    [new File([], "one.mbox"), new File([], "two.mbox")],
  ]) {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files } });
    await act(() => zone.dispatchEvent(event));
    expect(view.host.textContent).toContain(
      files.length === 1 ? "inbox.mbox" : "Choose one mailbox file at a time.",
    );
  }
  await view.unmount();
});
it("keeps inactive row controls out of Tab order and handles arrows from active controls", async () => {
  const view = await mount(h(ThreadList, { rows, title: "Inbox", refresh: vi.fn() }));
  const elements = [...view.host.querySelectorAll<HTMLTableRowElement>("tr")];
  const controls = (index: number) => [
    ...elements[index]!.querySelectorAll<HTMLElement>("input,button,a"),
  ];
  expect(controls(0).every((element) => element.tabIndex === 0)).toBe(true);
  expect(controls(1).every((element) => element.tabIndex === -1)).toBe(true);
  await act(() => controls(0)[0]!.focus());
  await key(controls(0)[0]!, "ArrowDown");
  expect(document.activeElement).toBe(elements[1]);
  expect(controls(0).every((element) => element.tabIndex === -1)).toBe(true);
  await key(controls(1)[1]!, "ArrowUp");
  expect(document.activeElement).toBe(elements[0]);
  await key(controls(0)[0]!, "Enter");
  expect(mocks.router.push).not.toHaveBeenCalled();
  await key(controls(0)[1]!, "s");
  expect(mocks.actions.forRows).toHaveBeenCalledWith([rows[0]], "star", true);
  expect(view.host.querySelector(".mail-row-copy")?.textContent).toBe(
    "Saturday at the garden — Bring gloves.",
  );
  expect(elements[0]?.querySelectorAll(":scope > td")).toHaveLength(4);
  expect(elements[0]?.querySelector(".mail-row-meta time")).not.toBeNull();
  await view.unmount();
});
it.each([
  FolderPage,
  SearchPage,
])("renders narrow query selections with a visible reading layout and h2 subject", async (Page) => {
  mocks.params.set("t", encodeRef(conversation.iri));
  const view = await mount(h(Page, { folderKey: "inbox" }));
  expect(
    view.host.querySelector('.mail-split[data-reading="true"] .mail-reading-panel h2')?.textContent,
  ).toBe(conversation.subject);
  expect(view.host.querySelectorAll("h1")).toHaveLength(1);
  expect(mocks.actions.markRead).toHaveBeenCalledOnce();
  await view.unmount();
});
it("uses h1 on full threads, medium dates, compact labels and a bounded body's original download", async () => {
  conversation.messages[0]!.labels = [folders[0]!.iri];
  conversation.messages[0]!.truncated = true;
  conversation.messages[0]!.originalUrl = "https://mail.example/original.eml";
  const view = await mount(h(ThreadView, { iri: conversation.iri }));
  expect(view.host.querySelector("h1")?.textContent).toBe(conversation.subject);
  expect(view.host.querySelector("time")?.textContent).toBe(
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
      conversation.messages[0]!.date,
    ),
  );
  expect(view.host.querySelector('.mail-chip[data-slot="badge"]')?.textContent).toBe("Inbox");
  expect(view.host.querySelector(".mail-chip button")).toBeNull();
  expect(view.host.querySelector(".mail-expand")?.textContent).toBe("Expand all");
  // The original is fetched through the pod-scoped client, never a credential-less link.
  expect(view.host.querySelector("a[download]")).toBeNull();
  const fetched = vi
    .spyOn(client, "binaryFetch")
    .mockResolvedValueOnce(new Response("raw", { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:original");
  const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const saved = vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe("original.eml");
    expect(this.href).toBe("blob:original");
  });
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  await click(button(view.host, "Download the original message"));
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(fetched).toHaveBeenCalledWith("https://mail.example/original.eml");
  expect(saved).toHaveBeenCalledOnce();
  expect(revoked).toHaveBeenCalledWith("blob:original");
  await click(button(view.host, "Download the original message"));
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(created).toHaveBeenCalledOnce();
  vi.useRealTimers();
  for (const spy of [saved, created, revoked]) spy.mockRestore();
  await view.unmount();
});
it.each([
  ["Mira Vale <mira@example.org>", "Mira Vale", "<mira@example.org>"],
  ["mira@example.org", "mira@example.org", undefined],
])("separates the sender name and address in %s", async (from, name, email) => {
  conversation.messages[0]!.from = from!;
  const view = await mount(h(ThreadView, { iri: conversation.iri }));
  expect(view.host.querySelector(".mail-message-person strong")?.textContent).toBe(name);
  expect(view.host.querySelector(".mail-sender-address")?.textContent?.trim()).toBe(email);
  if (email) expect(view.host.querySelector("strong .mail-sender-address")).toBeNull();
  await view.unmount();
});
it("uses envelope empty states with equal Button sizes and no skipped heading levels", async () => {
  const view = await mount(
    h("div", null, h("h1", null, "Inbox"), h(NoMail, { title: "Inbox", inbox: true })),
  );
  expect(view.host.querySelector("h2")?.textContent).toBe("No mail yet");
  expect(view.host.querySelector("h3")).toBeNull();
  expect(view.host.querySelector(".lucide-mail")).not.toBeNull();
  expect(
    [...view.host.querySelectorAll("[data-slot=button]")].map((element) =>
      element.getAttribute("data-size"),
    ),
  ).toEqual(["default", "default"]);
  await view.unmount();
});
