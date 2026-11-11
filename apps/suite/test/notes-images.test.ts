// AUTHORED-BY Codex GPT-6.1-Sol
import { Editor } from "@tiptap/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readPodImage, uploadPodImage } from "../src/apps/docs/lib/editor/image-upload";
import { notesExtensions } from "../src/apps/notes/editor/extensions";
import { docsToNotes, notesToDocs } from "../src/apps/notes/lib/convert";
import {
  firstNoteImage,
  noteImageSource,
  noteImages,
  notesMediaContainer,
} from "../src/apps/notes/lib/images";
import { planKeepImport } from "../src/apps/notes/lib/keep";
import { createNotesStore, type StoredNote } from "../src/apps/notes/lib/model/store";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { act, click, deferred, h, mount } from "./drive-ui-dom";

const mocks = vi.hoisted(() => ({
  context: {} as Record<string, unknown>,
  editor: undefined as Editor | undefined,
}));
vi.mock("../src/apps/notes/state/notes-context", () => ({ useNotesContext: () => mocks.context }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/notes",
}));
vi.mock("@tiptap/react", async (original) => {
  const actual = await original<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      mocks.editor = editor ?? undefined;
      return editor;
    },
  };
});
const { NoteDialog } = await import("../src/apps/notes/components/note-dialog");
const { NoteCard } = await import("../src/apps/notes/components/note-card");
const { NoteCover } = await import("../src/apps/notes/components/note-cover");
const { KeepImportDialog } = await import("../src/apps/notes/components/keep-import");
const POD = "https://images.example/alice/";
const SRC = `${POD}notes/media/picture.png`;
const png = () => new File(["pixels"], "../../unsafe.png", { type: "image/png" });
const body = (src = SRC, alt = "A bird") => `<p>Body</p><img src="${src}" alt="${alt}">`;

beforeEach(() => {
  Object.defineProperty(window.Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(window.Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(),
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:note-image");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function fixture(html = "<p>Body</p>") {
  const pod = createDemoPod({ root: POD });
  const fetchImpl = vi.fn(pod.fetch);
  const store = createNotesStore({ fetch: fetchImpl, podRoot: POD, webId: `${POD}#me` });
  const note = await store.create({ title: "Birds", body: html });
  const refresh = vi.fn(async () => {});
  mocks.context = {
    labels: [],
    session: { fetch: fetchImpl, storageUrl: POD, webId: `${POD}#me` },
    store,
    refresh,
    prefs: { pinned: [], colours: {} },
    pin: vi.fn(),
    colour: vi.fn(),
    closeNote: vi.fn(),
    opener: { current: null },
    move: vi.fn(),
    openNote: vi.fn(),
    updatePrefs: vi.fn(),
    notes: [note],
    active: { data: [note] },
    archived: { data: [] },
    trashed: { data: [] },
    attempt: (work: () => Promise<unknown>) => work(),
    mutations: {
      save: vi.fn(),
      deleteForever: (saved: StoredNote) => store.deleteForever(saved.url, saved.etag),
    },
  };
  return { pod, fetchImpl, store, note, refresh };
}
function button(label: string) {
  const element = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
  );
  expect(element, label).toBeDefined();
  return element as HTMLButtonElement;
}
async function fillAlt(value: string) {
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Image alt text"] input:not([type="checkbox"])',
  ) as HTMLInputElement;
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function waitForImageDialogClose() {
  // The popover restores focus after unmounting; let that finish before another action.
  await vi.waitFor(async () => {
    await act(() => {});
    expect(document.querySelector('[aria-label="Image alt text"]')).toBeNull();
    expect(document.activeElement).toBe(mocks.editor?.view.dom);
  });
}
async function selectImage(file = png()) {
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Choose note image"]',
  ) as HTMLInputElement;
  const chooser = vi.spyOn(input, "click");
  await click(button("Add image"));
  expect(chooser).toHaveBeenCalledOnce();
  await act(() => {
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("uploads allowlisted images with generated names, create-only writes and refused redirects", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
  for (const [type, extension] of [
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/gif", "gif"],
    ["image/webp", "webp"],
    ["image/svg+xml", "svg"],
  ] as const) {
    const file = new Blob(["pixels"], { type });
    const src = await uploadPodImage(file, notesMediaContainer(POD), fetchImpl);
    expect(src).toMatch(new RegExp(`notes/media/[a-f0-9-]+\\.${extension}$`));
    expect(fetchImpl).toHaveBeenLastCalledWith(src, {
      method: "PUT",
      redirect: "error",
      headers: { "content-type": type, "if-none-match": "*" },
      body: file,
    });
  }
  await expect(
    uploadPodImage(
      new Blob(["<html>"], { type: "text/html" }),
      notesMediaContainer(POD),
      fetchImpl,
    ),
  ).rejects.toThrow("Choose a PNG");
  const large = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: "image/png" });
  await expect(uploadPodImage(large, notesMediaContainer(POD), fetchImpl)).rejects.toThrow(
    "under 20 MB",
  );
  fetchImpl.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(uploadPodImage(png(), notesMediaContainer(POD), fetchImpl)).rejects.toThrow(
    "Upload failed",
  );
  fetchImpl.mockRejectedValueOnce(new Error("redirect refused"));
  await expect(uploadPodImage(png(), notesMediaContainer(POD), fetchImpl)).rejects.toThrow(
    "redirect refused",
  );
});

it("reads authenticated raster bytes, forwards abort and rejects unavailable or active HTML", async () => {
  const signal = new AbortController().signal;
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("pixels", { headers: { "content-type": "image/png" } }));
  expect((await readPodImage(SRC, fetchImpl, signal)).type).toBe("image/png");
  expect(fetchImpl).toHaveBeenCalledWith(SRC, { signal, redirect: "error" });
  fetchImpl.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(readPodImage(SRC, fetchImpl)).rejects.toThrow("Image unavailable");
  fetchImpl.mockResolvedValueOnce(
    new Response("<script>bad()</script>", { headers: { "content-type": "text/html" } }),
  );
  await expect(readPodImage(SRC, fetchImpl)).rejects.toThrow("Image unavailable");
});

it("projects only safe account images from inert hostile HTML, preserving alt and source order", () => {
  expect(firstNoteImage(`<script>throw 1</script><img>${body()}`, POD)).toEqual({
    src: SRC,
    alt: "A bird",
  });
  expect(firstNoteImage(`<img src="${SRC}">`, POD)).toEqual({ src: SRC, alt: "" });
  expect(firstNoteImage(`<img src="${SRC}" alt="&lt;bird&gt;">`, POD)?.alt).toBe("<bird>");
  expect(
    noteImages(
      `<img src="${SRC}" onerror="throw 1"><img src="${POD}docs/a/assets/b.jpg" alt="Other">`,
      POD,
    ),
  ).toHaveLength(2);
  expect(firstNoteImage("<p>No images</p>", POD)).toBeUndefined();
  expect(noteImageSource(`${POD}pod-docs/legacy/assets/b.png`, POD)).toBe(
    `${POD}pod-docs/legacy/assets/b.png`,
  );
  for (const source of [
    "javascript:alert(1)",
    "data:image/png,AA",
    "blob:local",
    "https://foreign.example/a.png",
    `${POD}notes/a.png`,
    `${POD}notes/media/`,
    `${SRC}?q=x`,
    `${SRC}#fragment`,
    `${POD}notes/media/a%2fb`,
    `${POD}notes/media/a%5cb`,
    `${POD}notes/media/%252e%252e`,
    `${POD}notes/media/a b`,
    `https://user:pass@images.example/alice/notes/media/a`,
    `${POD}docs/a/elsewhere/b`,
    `${POD}docs/a/assets/sub/b.png`,
    `${POD}docs//assets/b`,
    "not a URL",
    "https:\\evil.example",
    `${POD}notes/media/../private.png`,
  ]) {
    expect(noteImageSource(source, POD), source).toBeNull();
    expect(firstNoteImage(`<img src="${source}">`, POD), source).toBeUndefined();
  }
  const browser = globalThis.window;
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
    expect(noteImages(body(), POD)).toEqual([]);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  }
});

it("uses the shared node view for Notes without tables or any foreign authenticated request", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("pixels", { headers: { "content-type": "image/png" } }));
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: notesExtensions(fetchImpl, POD),
    content: `${body()}<img src="data:image/png,AA"><img src="https://foreign.example/x.png">`,
  });
  try {
    await vi.waitFor(() =>
      expect(editor.view.dom.querySelector("img")?.getAttribute("src")).toBe("blob:note-image"),
    );
    expect(editor.view.dom.querySelectorAll("img")).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(editor.schema.nodes.table).toBeUndefined();
    expect(editor.getHTML()).toContain(SRC);
    expect(editor.getHTML()).not.toContain("blob:");
    editor.commands.setContent({
      type: "doc",
      content: [{ type: "image", attrs: { src: "data:image/png,AA" } }],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  } finally {
    editor.destroy();
  }
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:note-image");
});

it.each([
  false,
  true,
])("inserts through the note toolbar after alt entry or explicit decoration (%s)", async (decorative) => {
  const s = await fixture();
  const ui = await mount(h(NoteDialog, { note: s.note }));
  await selectImage();
  expect(button("Insert image").disabled).toBe(true);
  if (decorative)
    await click(
      document.querySelector('[aria-label="Image alt text"] input[type="checkbox"]') as Element,
    );
  else {
    await fillAlt("   ");
    expect(button("Insert image").disabled).toBe(true);
    await fillAlt("A bird");
  }
  expect(button("Insert image").disabled).toBe(false);
  await click(button("Insert image"));
  await act(async () => {
    await vi.waitFor(() => expect(mocks.editor?.getHTML()).toContain("/notes/media/"));
  });
  await waitForImageDialogClose();
  const attrs = mocks.editor?.getJSON().content?.find((node) => node.type === "image")?.attrs;
  expect(attrs?.alt).toBe(decorative ? "" : "A bird");
  expect(attrs?.src).toMatch(/\/notes\/media\/[a-f0-9-]+\.png$/);
  const upload = s.fetchImpl.mock.calls.find(
    ([url, init]) => String(url) === attrs?.src && init?.method === "PUT",
  );
  expect(upload?.[1]?.redirect).toBe("manual");
  let imagePosition = 0;
  mocks.editor?.state.doc.descendants((node, position) => {
    if (node.type.name === "image") imagePosition = position;
  });
  await act(() => mocks.editor?.commands.setNodeSelection(imagePosition));
  await click(button("Edit alt text"));
  await fillAlt("Updated bird");
  await click(button("Save alt text"));
  await waitForImageDialogClose();
  expect(mocks.editor?.getHTML()).toContain('alt="Updated bird"');
  await act(() => mocks.editor?.commands.setNodeSelection(imagePosition));

  await act(() =>
    button("More").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  const remove = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
    (item) => item.textContent === "Remove image",
  );
  expect(remove).toBeDefined();
  await click(remove as Element);
  expect(mocks.editor?.getHTML()).not.toContain("<img");
  await ui.unmount();
});

it("pastes and drops images through the same accessible upload dialog", async () => {
  const s = await fixture();
  await mount(h(NoteDialog, { note: s.note }));
  for (const type of ["paste", "drop"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", {
      value: { files: [png()], getData: () => "" },
    });
    if (type === "drop") {
      Object.defineProperty(event, "clientX", { value: 0 });
      Object.defineProperty(event, "clientY", { value: 0 });
      vi.spyOn((mocks.editor as Editor).view, "posAtCoords").mockReturnValue({ pos: 1, inside: 0 });
    }
    await act(() => mocks.editor?.view.dom.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    await fillAlt("Transferred bird");
    await click(button("Insert image"));
    await waitForImageDialogClose();
  }
  expect(mocks.editor?.getJSON().content?.filter((node) => node.type === "image")).toHaveLength(2);
});

it("shows the authenticated first cover above the title with its alt and lazy loading", async () => {
  const s = await fixture(body());
  await s.pod.fetch(SRC, {
    method: "PUT",
    body: "pixels",
    headers: { "content-type": "image/png" },
  });
  const ui = await mount(h(NoteCard, { note: s.note }));
  const image = ui.host.querySelector("img") as HTMLImageElement;
  await act(async () => {
    await vi.waitFor(() => expect(image.getAttribute("src")).toBe("blob:note-image"));
  });
  expect(image.alt).toBe("A bird");
  expect(image.getAttribute("loading")).toBe("lazy");
  expect(image.nextElementSibling?.tagName).toBe("H3");
  expect(s.fetchImpl).toHaveBeenCalledWith(SRC, expect.objectContaining({ redirect: "error" }));
  await ui.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:note-image");
});

it("defers cover fetch until visible, ignores late bytes after unmount and handles unavailable covers quietly", async () => {
  const pending = deferred<Response>();
  const fetchImpl = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
  let visible!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  const original = globalThis.IntersectionObserver;
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: class {
      constructor(callback: IntersectionObserverCallback) {
        visible = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  });
  try {
    const ui = await mount(h(NoteCover, { src: SRC, alt: "Bird", fetchImpl }));
    expect(fetchImpl).not.toHaveBeenCalled();
    await act(() =>
      visible(
        [{ isIntersecting: false }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    await act(() =>
      visible(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    await act(() =>
      visible(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    await ui.unmount();
    await act(() =>
      pending.resolve(new Response("pixels", { headers: { "content-type": "image/png" } })),
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      value: original,
    });
  }
  await mount(
    h(NoteCover, {
      src: SRC,
      alt: "Bird",
      fetchImpl: vi.fn().mockRejectedValue(new Error("Offline")),
    }),
  );
});

it("keeps media through the card's Delete forever action", async () => {
  const s = await fixture(body());
  await s.pod.fetch(SRC, {
    method: "PUT",
    body: "pixels",
    headers: { "content-type": "image/png" },
  });
  const trashed = await s.store.trash(s.note);
  await mount(h(NoteCard, { note: trashed }));
  await click(button("Delete forever"));
  const confirm =
    document.querySelector('[role="alertdialog"]') ?? document.querySelector('[role="dialog"]');
  const action = Array.from(confirm?.querySelectorAll("button") ?? []).find(
    (b) => b.textContent?.trim() === "Delete forever",
  );
  expect(action).toBeDefined();
  await click(action as Element);
  expect(s.pod.has(trashed.url)).toBe(false);
  expect(s.pod.has(SRC)).toBe(true);
});

it("imports available Takeout image bytes, including attachment-only notes, as decorative images", async () => {
  const file = new File(["pixels"], "bird.png", { type: "image/png" });
  Object.defineProperty(file, "webkitRelativePath", { value: "Takeout/Keep/bird.png" });
  const json = new File(
    [
      JSON.stringify({
        title: "Bird",
        attachments: [{ filePath: "bird.png", mimetype: "image/png" }],
      }),
    ],
    "Bird.json",
    { type: "application/json" },
  );
  Object.defineProperty(json, "webkitRelativePath", { value: "Takeout/Keep/Bird.json" });
  const plan = planKeepImport(
    [{ fileName: "Takeout/Keep/Bird.json", json: await json.text() }],
    [],
    new Map([["Takeout/Keep/bird.png", file]]),
  );
  expect(plan.ready[0]?.images).toHaveLength(1);
  expect(plan.attachments).toBe(0);
  const s = await fixture();
  await mount(h(KeepImportDialog, { open: true, close: vi.fn() }));
  await act(() => {
    const input = document.querySelector('[aria-label="Keep folder"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [json, file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click(button("Import 1 note"));
  const imported = (await s.store.list("active")).find((note) => note.title === "Bird");
  expect(imported?.body).toMatch(/<img src="https:.*\/notes\/media\/.*\.png" alt="">/);
  expect(s.refresh).toHaveBeenCalledOnce();
});

it("round-trips image JSON with explicit alt or decoration and rejects active or malformed sources", () => {
  for (const convert of [notesToDocs, docsToNotes]) {
    const attrs = {
      src: SRC,
      alt: "",
      title: null,
      width: 120,
      height: null,
      link: { href: "https://example.com/", title: "Bird" },
    };
    const input = { type: "doc", content: [{ type: "image", attrs }] };
    Object.freeze(attrs);
    expect(convert(input)).toEqual(input);
    const linked = convert(input).content[0];
    expect(linked).not.toBe(input.content[0]);
    expect(
      convert({
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: SRC, alt: "Bird", title: "Caption", width: null, height: 12, link: null },
          },
        ],
      }),
    ).toBeDefined();
    expect(
      convert({ type: "doc", content: [{ type: "image", attrs: { src: SRC, alt: "Bird" } }] }),
    ).toBeDefined();
    for (const src of [
      "javascript:alert(1)",
      "data:image/png,AA",
      "not a URL",
      "https://[",
      "https://user:pass@example.com/x",
      "https://example.com/white space",
    ]) {
      expect(() =>
        convert({ type: "doc", content: [{ type: "image", attrs: { src, alt: "Bird" } }] }),
      ).toThrow();
    }
    for (const attributes of [
      { src: SRC },
      { src: SRC, alt: "Bird", width: 0 },
      { src: SRC, alt: "Bird", height: 1.2 },
    ])
      expect(() =>
        convert({ type: "doc", content: [{ type: "image", attrs: attributes }] }),
      ).toThrow();
    expect(() =>
      convert({
        type: "doc",
        content: [{ type: "image", attrs: { src: SRC, alt: "Bird" }, content: [] }],
      }),
    ).toThrow();
  }
});

it.each([
  "current body",
  "saved revision",
])("deletes only the note and retains media from its %s without scanning references", async (source) => {
  const s = await fixture(body());
  await s.pod.fetch(SRC, { method: "PUT", body: "pixels" });
  const note =
    source === "saved revision"
      ? await s.store.save(s.note, { body: "<p>Image removed</p>" }, s.note.etag)
      : s.note;
  const trashed = await s.store.trash(note);
  s.fetchImpl.mockClear();
  await s.store.deleteForever(trashed.url, trashed.etag);
  expect(s.pod.has(trashed.url)).toBe(false);
  expect(s.pod.has(SRC)).toBe(true);
  expect(s.fetchImpl).toHaveBeenCalledTimes(3);
  expect(s.fetchImpl).toHaveBeenNthCalledWith(
    1,
    trashed.url,
    expect.objectContaining({ method: "HEAD", cache: "no-store" }),
  );
  expect(s.fetchImpl).toHaveBeenNthCalledWith(
    2,
    `${trashed.url}.acl`,
    expect.objectContaining({ cache: "no-store" }),
  );
  expect(s.fetchImpl).toHaveBeenNthCalledWith(
    3,
    trashed.url,
    expect.objectContaining({ method: "DELETE", redirect: "manual" }),
  );
  const headers = new Headers(s.fetchImpl.mock.calls.at(-1)?.[1]?.headers);
  expect(headers.get("if-match")).toBe(trashed.etag);
});

it("resolves selected Takeout paths without reading missing, oversized, active or mismatched attachments", () => {
  const file = (type: string) => new File(["bytes"], "photo", { type });
  const attachments = [
    { filePath: "./photos\\bird.png", mimetype: "image/png" },
    { filePath: "empty.png", mimetype: "image/png" },
    { filePath: "missing.png", mimetype: "image/png" },
    { filePath: "mismatch.png", mimetype: "image/png" },
    { filePath: "active.html", mimetype: "text/html" },
    { filePath: "large.png", mimetype: "image/png" },
  ];
  const plan = planKeepImport(
    [{ fileName: "Keep/Birds.json", json: JSON.stringify({ attachments }) }],
    [],
    new Map([
      ["Keep/photos/bird.png", file("image/png")],
      ["Keep/empty.png", file("")],
      ["Keep/mismatch.png", file("image/jpeg")],
      ["Keep/active.html", file("text/html")],
      [
        "Keep/large.png",
        new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
      ],
    ]),
  );
  expect(plan.ready[0]?.images).toHaveLength(2);
  expect(plan.attachments).toBe(4);
  expect(plan.ready[0]?.input.body).toBe("");
});

it("gives an unnamed attachment-only import a stable filename title", () => {
  const plan = planKeepImport(
    [
      {
        fileName: "Keep/.json",
        json: JSON.stringify({ attachments: [{ filePath: "a.png", mimetype: "image/png" }] }),
      },
    ],
    [],
    new Map([["Keep/a.png", png()]]),
  );
  expect(plan.ready[0]?.input.title).toBe("Image note");
});
