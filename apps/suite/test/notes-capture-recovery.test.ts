// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const webId = "https://pod.example/profile/card#me";
const mocks = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  toast: { error: vi.fn() },
}));
vi.mock("../src/apps/notes/state/notes-context", () => ({ useNotesContext: () => mocks.context }));
vi.mock("@jeswr/suite-ui", async (original) => ({
  ...(await original<typeof import("@jeswr/suite-ui")>()),
  toast: mocks.toast,
}));
let clock = 1_000;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.toast.error.mockClear();
  vi.useFakeTimers();
  clock = 1_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  mocks.context = {
    session: { webId },
    labels: [],
    create: vi.fn().mockResolvedValue({} as StoredNote),
  };
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function page() {
  vi.resetModules();
  const { CaptureBar } = await import("../src/apps/notes/components/capture-bar");
  const { getPendingDrafts } = await import("../src/apps/notes/state/draft-registry");
  const id = getPendingDrafts(webId).tabId;
  return { CaptureBar, id, key: `notes-capture-draft:${id}` };
}
async function enter(host: HTMLElement, text: string) {
  await act(() => host.querySelector<HTMLInputElement>('[aria-label="Take a note"]')?.focus());
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea");
  expect(textarea).not.toBeNull();
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      text,
    );
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function close(host: HTMLElement) {
  const button = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Close",
  );
  expect(button).toBeDefined();
  return click(button as HTMLButtonElement);
}

it("recovers both different captures after two duplicated tabs close, clearing each only after success", async () => {
  sessionStorage.setItem("suite.notes.tab-id", "copied-id");
  const failed = vi.fn().mockRejectedValue(new Error("Offline"));
  mocks.context.create = failed;
  const a = await page();
  const first = await mount(h(a.CaptureBar));
  await enter(first.host, "A's unique <capture>");
  clock++;
  // The duplicate opens while A is live, so it takes a fresh id.
  const b = await page();
  const second = await mount(h(b.CaptureBar));
  await enter(second.host, "B's different capture");
  await act(() => window.dispatchEvent(new Event("pagehide")));
  await first.unmount();
  clock++;
  await second.unmount();
  expect(a.id).not.toBe(b.id);
  expect(JSON.parse(localStorage.getItem(a.key) as string).body).toBe("A's unique <capture>");
  expect(JSON.parse(localStorage.getItem(b.key) as string).body).toBe("B's different capture");
  clock = 31_004;
  const writing = deferred<StoredNote>();
  const create = vi
    .fn()
    .mockReturnValueOnce(writing.promise)
    .mockResolvedValue({} as StoredNote);
  mocks.context.create = create;
  const receiver = await page();
  const reopened = await mount(h(receiver.CaptureBar));
  expect(reopened.host.querySelector("textarea")?.value).toBe("B's different capture");
  expect(create).toHaveBeenCalledExactlyOnceWith(
    {
      title: "A's unique <capture>",
      body: "<p>A&#39;s unique &lt;capture&gt;</p>",
      labels: [],
    },
    false,
    "default",
  );
  expect(localStorage.getItem(a.key)).not.toBeNull();
  expect(JSON.parse(localStorage.getItem(receiver.key) as string).body).toBe(
    "B's different capture",
  );
  await act(() => writing.resolve({} as StoredNote));
  expect(localStorage.getItem(a.key)).toBeNull();
  await close(reopened.host);
  expect(create).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(receiver.key)).toBeNull();
  await reopened.unmount();
  expect(create).toHaveBeenCalledTimes(2);
});

it.each([
  "success",
  "failure",
])("does not restore or resubmit an in-flight capture after label navigation (%s)", async (outcome) => {
  const writing = deferred<StoredNote>();
  const create = vi
    .fn()
    .mockReturnValueOnce(writing.promise)
    .mockResolvedValue({} as StoredNote);
  mocks.context.create = create;
  const { CaptureBar, key } = await page();
  const original = await mount(h(CaptureBar));
  await enter(original.host, "Exactly one capture");
  await close(original.host);
  expect(JSON.parse(localStorage.getItem(key) as string).submitting).toBe(true);
  await original.unmount();
  const replacement = await mount(h(CaptureBar, { label: "A" }));
  expect(replacement.host.querySelector("textarea")).toBeNull();
  expect(
    replacement.host.querySelector<HTMLInputElement>('[aria-label="Take a note"]')?.disabled,
  ).toBe(true);
  if (outcome === "success") {
    await act(() => writing.resolve({} as StoredNote));
    expect(replacement.host.querySelector("textarea")).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    // Open the replacement and press Close: completed text must not reappear.
    await act(() =>
      replacement.host.querySelector<HTMLInputElement>('[aria-label="Take a note"]')?.focus(),
    );
    await close(replacement.host);
    expect(create).toHaveBeenCalledTimes(1);
  } else {
    await act(() => writing.reject(new Error("Offline")));
    expect(replacement.host.querySelector("textarea")?.value).toBe("Exactly one capture");
    expect(replacement.host.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't create",
    );
    const textarea = replacement.host.querySelector("textarea");
    await act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        "Edited after navigation",
      );
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => mocks.toast.error.mock.lastCall?.[1].action.onClick());
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenLastCalledWith(
      {
        title: "Edited after navigation",
        body: "<p>Edited after navigation</p>",
        labels: [],
      },
      false,
      "default",
    );
    expect(localStorage.getItem(key)).toBeNull();
  }
  await replacement.unmount();
  expect(create).toHaveBeenCalledTimes(outcome === "success" ? 1 : 2);
});

it("migrates the legacy capture once and ignores live, damaged and foreign drafts", async () => {
  const draft = {
    webId,
    title: "Old title",
    body: "Old capture",
    labels: [],
    pinned: false,
    colour: "default",
  };
  localStorage.setItem("notes-capture-draft", JSON.stringify(draft));
  localStorage.setItem(
    "notes-capture-draft:live",
    JSON.stringify({ ...draft, tabId: "live", body: "Still editing", updatedAt: 2_000 }),
  );
  localStorage.setItem("suite.notes.heartbeat:live", String(clock));
  localStorage.setItem(
    "notes-capture-draft:foreign",
    JSON.stringify({ ...draft, tabId: "foreign", webId: "https://other.example/#me" }),
  );
  localStorage.setItem("notes-capture-draft:damaged", "{");
  const create = mocks.context.create as ReturnType<typeof vi.fn>;
  const { CaptureBar, key } = await page();
  const ui = await mount(h(CaptureBar));
  expect(localStorage.getItem("notes-capture-draft")).toBeNull();
  expect(ui.host.querySelector("textarea")?.value).toBe("Old capture");
  expect(JSON.parse(localStorage.getItem(key) as string).body).toBe("Old capture");
  expect(create).not.toHaveBeenCalled();
  await close(ui.host);
  await ui.unmount();
  const reopened = await mount(h(CaptureBar));
  expect(reopened.host.querySelector("textarea")).toBeNull();
  expect(create).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("notes-capture-draft:live")).toContain("Still editing");
  expect(localStorage.getItem("notes-capture-draft:foreign")).not.toBeNull();
});

it("keeps failed extra orphan recovery durable for a later mount, including literal checklist text", async () => {
  const draft = {
    webId,
    title: "",
    body: "[X] Keep <this>",
    labels: [],
    pinned: false,
    colour: "default",
    tabId: "older",
    updatedAt: 1,
  };
  localStorage.setItem("notes-capture-draft:older", JSON.stringify(draft));
  localStorage.setItem(
    "notes-capture-draft:newer",
    JSON.stringify({ ...draft, tabId: "newer", body: "Newest", updatedAt: 2 }),
  );
  localStorage.setItem("notes-capture-draft", "{");
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue({} as StoredNote);
  mocks.context.create = create;
  const { CaptureBar } = await page();
  const first = await mount(h(CaptureBar));
  expect(first.host.querySelector("textarea")?.value).toBe("Newest");
  expect(create).toHaveBeenCalledExactlyOnceWith(
    { title: "[X] Keep <this>", body: "<p>[X] Keep &lt;this&gt;</p>", labels: [] },
    false,
    "default",
  );
  expect(localStorage.getItem("notes-capture-draft:older")).not.toBeNull();
  await close(first.host);
  // Once the bar is free, the orphan whose recovery failed is offered in it,
  // and the reset after the successful capture does not wipe it.
  expect(first.host.querySelector("textarea")?.value).toBe("[X] Keep <this>");
  // Navigation's plain-text fallback saves unsupported syntax.
  await first.unmount();
  expect(create).toHaveBeenLastCalledWith(
    { title: "[X] Keep <this>", body: "<p>[X] Keep &lt;this&gt;</p>", labels: [] },
    false,
    "default",
  );
  expect(localStorage.getItem("notes-capture-draft:older")).toBeNull();
  const reopened = await mount(h(CaptureBar));
  expect(reopened.host.querySelector("textarea")).toBeNull();
  await reopened.unmount();
});

it("retains an older draft from this tab when a newer orphan replaces the bar and extra recovery fails", async () => {
  const { CaptureBar, id, key } = await page();
  const draft = {
    webId,
    title: "",
    body: "This tab's unique older capture",
    labels: [],
    pinned: false,
    colour: "default",
    tabId: id,
    updatedAt: 1,
  };
  localStorage.setItem(key, JSON.stringify(draft));
  localStorage.setItem(
    "notes-capture-draft:newer",
    JSON.stringify({ ...draft, tabId: "newer", body: "Other tab's newer capture", updatedAt: 2 }),
  );
  const create = vi.fn().mockRejectedValue(new Error("Offline"));
  mocks.context.create = create;
  const ui = await mount(h(CaptureBar));
  expect(ui.host.querySelector("textarea")?.value).toBe("Other tab's newer capture");
  expect(create).toHaveBeenCalledTimes(1);
  const storedBodies = () =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("notes-capture-draft:"))
      .map((key) => JSON.parse(localStorage.getItem(key) as string).body);
  expect(storedBodies()).toContain("This tab's unique older capture");
  expect(storedBodies()).toContain("Other tab's newer capture");
  await ui.unmount();
  expect(storedBodies()).toContain("This tab's unique older capture");
});

it("restores this tab's own unfinished capture right after a reload", async () => {
  // The reload cancels the unmount's create request, so it never settles.
  mocks.context.create = vi.fn(() => new Promise<StoredNote>(() => {}));
  const before = await page();
  const ui = await mount(h(before.CaptureBar));
  await enter(ui.host, "Typed before reload");
  // A reload fires pagehide (flush + heartbeat release) and then unmounts.
  await act(() => window.dispatchEvent(new Event("pagehide")));
  await ui.unmount();
  clock += 2_000;
  const after = await page();
  expect(after.id).toBe(before.id);
  const reloaded = await mount(h(after.CaptureBar));
  expect(reloaded.host.querySelector("textarea")?.value).toBe("Typed before reload");
  expect(reloaded.host.querySelector('[role="alert"]')?.textContent).toContain(
    "may already have been saved",
  );
  await reloaded.unmount();
});

it("retries from the toast even when no capture bar is mounted", async () => {
  const create = vi.fn().mockRejectedValue(new Error("Offline"));
  mocks.context.create = create;
  const { CaptureBar, key } = await page();
  const ui = await mount(h(CaptureBar));
  await enter(ui.host, "Retry me later");
  await close(ui.host);
  const onClick = mocks.toast.error.mock.lastCall?.[1].action.onClick;
  await ui.unmount();
  expect(create).toHaveBeenCalledTimes(2);
  create.mockResolvedValue({} as StoredNote);
  await act(() => onClick());
  expect(create).toHaveBeenCalledTimes(3);
  expect(create).toHaveBeenLastCalledWith(
    { title: "Retry me later", body: "<p>Retry me later</p>", labels: [] },
    false,
    "default",
  );
  expect(localStorage.getItem(key)).toBeNull();
});

it("never auto-creates a capture that was in flight when its page closed, and warns when offering it", async () => {
  const base = { webId, title: "", labels: [], pinned: false, colour: "default" };
  localStorage.setItem(
    "notes-capture-draft:gone-1",
    JSON.stringify({
      ...base,
      body: "Maybe saved",
      tabId: "gone-1",
      updatedAt: 1,
      submitting: true,
    }),
  );
  localStorage.setItem(
    "notes-capture-draft:gone-2",
    JSON.stringify({ ...base, body: "Newest", tabId: "gone-2", updatedAt: 2 }),
  );
  const create = mocks.context.create as ReturnType<typeof vi.fn>;
  const { CaptureBar, key } = await page();
  const ui = await mount(h(CaptureBar));
  expect(ui.host.querySelector("textarea")?.value).toBe("Newest");
  expect(create).not.toHaveBeenCalled();
  expect(localStorage.getItem("notes-capture-draft:gone-1")).not.toBeNull();
  await close(ui.host);
  expect(ui.host.querySelector("textarea")?.value).toBe("Maybe saved");
  expect(ui.host.querySelector('[role="alert"]')?.textContent).toContain(
    "may already have been saved",
  );
  expect(create).toHaveBeenCalledTimes(1);
  // Close, an outside click, Escape and unmount keep it stored and the bar
  // open instead of creating it; a collapsed bar never holds its text.
  await close(ui.host);
  expect(ui.host.querySelector("textarea")?.value).toBe("Maybe saved");
  await act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(ui.host.querySelector("textarea")?.value).toBe("Maybe saved");
  await act(() =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(ui.host.querySelector("textarea")?.value).toBe("Maybe saved");
  expect(ui.host.querySelector('[aria-label="New list"]')).toBeNull();
  await ui.unmount();
  expect(create).toHaveBeenCalledTimes(1);
  const stored = JSON.parse(localStorage.getItem(key) as string);
  expect(stored).toMatchObject({ body: "Maybe saved", maybeSaved: true });
  // A flagged record is never auto-created as an orphan either.
  localStorage.setItem(
    "notes-capture-draft:gone-3",
    JSON.stringify({ ...base, body: "Newer", tabId: "gone-3", updatedAt: 3 }),
  );
  localStorage.setItem(
    "notes-capture-draft:gone-4",
    JSON.stringify({ ...stored, tabId: "gone-4", updatedAt: 1 }),
  );
  localStorage.removeItem(key);
  const { CaptureBar: Again } = await page();
  const again = await mount(h(Again));
  expect(again.host.querySelector("textarea")?.value).toBe("Newer");
  expect(create).toHaveBeenCalledTimes(1);
  await again.unmount();
});

it("offers Save anyway and Discard for a capture that may already have been saved", async () => {
  const base = { webId, title: "", labels: [], pinned: false, colour: "default" };
  const record = { ...base, body: "Check me", tabId: "gone", updatedAt: 1, maybeSaved: true };
  localStorage.setItem("notes-capture-draft:gone", JSON.stringify(record));
  const create = mocks.context.create as ReturnType<typeof vi.fn>;
  const { CaptureBar, key } = await page();
  const ui = await mount(h(CaptureBar));
  const button = (name: string) =>
    [...ui.host.querySelectorAll("button")].find(
      (b) => b.textContent === name,
    ) as HTMLButtonElement;
  expect(ui.host.querySelector("textarea")?.value).toBe("Check me");
  await click(button("Discard"));
  expect(ui.host.querySelector("textarea")).toBeNull();
  expect(localStorage.getItem(key)).toBeNull();
  expect(create).not.toHaveBeenCalled();
  await ui.unmount();
  expect(create).not.toHaveBeenCalled();
  localStorage.setItem("notes-capture-draft:gone", JSON.stringify(record));
  const second = await mount(h(CaptureBar));
  await click(
    [...second.host.querySelectorAll("button")].find(
      (b) => b.textContent === "Save anyway",
    ) as HTMLButtonElement,
  );
  expect(create).toHaveBeenCalledExactlyOnceWith(
    { title: "Check me", body: "<p>Check me</p>", labels: [] },
    false,
    "default",
  );
  expect(localStorage.getItem(key)).toBeNull();
  expect(second.host.querySelector("textarea")).toBeNull();
  await second.unmount();
  expect(create).toHaveBeenCalledTimes(1);
  // Save anyway on emptied text removes the flagged record instead of keeping it.
  localStorage.setItem("notes-capture-draft:gone", JSON.stringify(record));
  const third = await mount(h(CaptureBar));
  const textarea = third.host.querySelector("textarea");
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      "",
    );
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(
    [...third.host.querySelectorAll("button")].find(
      (b) => b.textContent === "Save anyway",
    ) as HTMLButtonElement,
  );
  expect(localStorage.getItem(key)).toBeNull();
  expect(create).toHaveBeenCalledTimes(1);
  await third.unmount();
});

it("retries a failed Save anyway from the toast after the bar unmounts", async () => {
  const base = { webId, title: "", labels: [], pinned: false, colour: "default" };
  localStorage.setItem(
    "notes-capture-draft:gone",
    JSON.stringify({ ...base, body: "Flagged", tabId: "gone", updatedAt: 1, maybeSaved: true }),
  );
  const create = vi.fn().mockRejectedValue(new Error("Offline"));
  mocks.context.create = create;
  const { CaptureBar, key } = await page();
  const ui = await mount(h(CaptureBar));
  const writing = deferred<StoredNote>();
  create.mockReturnValueOnce(writing.promise);
  await click(
    [...ui.host.querySelectorAll("button")].find(
      (b) => b.textContent === "Save anyway",
    ) as HTMLButtonElement,
  );
  await ui.unmount();
  await act(() => writing.reject(new Error("Offline")));
  create.mockResolvedValue({} as StoredNote);
  const retry = mocks.toast.error.mock.lastCall?.[1].action.onClick;
  await act(() => retry());
  expect(create).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenLastCalledWith(
    { title: "Flagged", body: "<p>Flagged</p>", labels: [] },
    false,
    "default",
  );
  expect(localStorage.getItem(key)).toBeNull();
  // A late second click finds nothing kept and creates nothing more.
  await act(() => retry());
  expect(create).toHaveBeenCalledTimes(2);
});

it("does not re-create from an old toast after a later bar saved the draft", async () => {
  const create = vi.fn().mockRejectedValue(new Error("Offline"));
  mocks.context.create = create;
  const { CaptureBar, key } = await page();
  const first = await mount(h(CaptureBar));
  await enter(first.host, "Kept");
  const writing = deferred<StoredNote>();
  create.mockReturnValueOnce(writing.promise);
  await close(first.host);
  await first.unmount();
  await act(() => writing.reject(new Error("Offline")));
  const retry = mocks.toast.error.mock.lastCall?.[1].action.onClick;
  expect(localStorage.getItem(key)).not.toBeNull();
  // A second bar in this tab restores the kept draft and saves it.
  create.mockResolvedValue({} as StoredNote);
  const second = await mount(h(CaptureBar));
  await close(second.host);
  expect(create).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(key)).toBeNull();
  await second.unmount();
  // The first failure's toast must not create the note a second time.
  await act(() => retry());
  expect(create).toHaveBeenCalledTimes(2);
});

it("still retries from the toast when browser storage cannot be read", async () => {
  const create = vi.fn().mockRejectedValue(new Error("Offline"));
  mocks.context.create = create;
  const { CaptureBar } = await page();
  const ui = await mount(h(CaptureBar));
  await enter(ui.host, "Only copy");
  const writing = deferred<StoredNote>();
  create.mockReturnValueOnce(writing.promise);
  await close(ui.host);
  await ui.unmount();
  await act(() => writing.reject(new Error("Offline")));
  const retry = mocks.toast.error.mock.lastCall?.[1].action.onClick;
  create.mockResolvedValue({} as StoredNote);
  const read = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  try {
    await act(() => retry());
  } finally {
    read.mockRestore();
  }
  expect(create).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenLastCalledWith(
    { title: "Only copy", body: "<p>Only copy</p>", labels: [] },
    false,
    "default",
  );
});
