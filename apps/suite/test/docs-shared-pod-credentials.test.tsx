// AUTHORED-BY Claude Opus 5.5
// @vitest-environment jsdom
import { Editor, getSchema } from "@tiptap/react";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  renderHook,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { VersionHistory } from "../src/apps/docs/components/version-history";
import {
  documentCredentialRoots,
  documentScopedFetch,
} from "../src/apps/docs/editor/document-fetch";
import { readExportImage } from "../src/apps/docs/editor/export-document";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import type { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { useDocumentComments } from "../src/apps/docs/hooks/use-document-comments";
import type { PodSession } from "../src/lib/session/pod-session";

// Alice opens Bob's document through "Shared with me": both pods live on one server.
const alice = "https://pods.example/alice/";
const resource = "https://pods.example/bob/docs/x.ttl";
const container = "https://pods.example/bob/docs/x/";
const webId = `${alice}profile/card#me`;
let authenticated: ReturnType<typeof vi.fn<typeof fetch>>;
let anonymous: ReturnType<typeof vi.fn<typeof fetch>>;
let session: PodSession;
let runtime: DocumentPersistence;
let editor: Editor;
const urls = (mock: typeof authenticated) =>
  mock.mock.calls.map(([input]) => (input instanceof Request ? input.url : String(input)));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const empty = () =>
    new Response("", { status: 200, headers: { "content-type": "text/turtle", etag: '"e"' } });
  authenticated = vi.fn<typeof fetch>(async () => empty());
  anonymous = vi.fn<typeof fetch>(async () => empty());
  vi.stubGlobal("fetch", anonymous);
  session = {
    mode: "demo",
    webId,
    displayName: "Alice",
    storageUrl: alice,
    fetch: authenticated,
    subscribe: () => () => {},
    reset: async () => {},
  };
  const doc = prosemirrorJSONToYDoc(getSchema(baseExtensions(globalThis.fetch)), {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Shared" }] }],
  });
  editor = new Editor({ extensions: editorExtensions(doc, globalThis.fetch) });
  runtime = {
    doc,
    stored: { url: resource, data: { instanceId: "x" } },
    readOnly: false,
    online: true,
    session,
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as DocumentPersistence;
});
afterEach(() => {
  cleanup();
  editor.destroy();
  runtime.doc.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("scopes credentials to the user's storage plus the opened document's own container", async () => {
  expect(documentCredentialRoots(alice, resource)).toEqual([alice, container]);
  expect(documentCredentialRoots(alice)).toEqual([alice]);
  expect(documentCredentialRoots(alice, "https://pods.example/bob/not-a-doc")).toEqual([alice]);
  const scoped = documentScopedFetch(session, () => resource);
  for (const url of [
    `${container}comments/`,
    `${container}versions/one.ttl`,
    `${container}updates/`,
    `${container}assets/photo.png`,
    `${alice}docs/mine.ttl`,
  ])
    await scoped(url);
  for (const url of [
    "https://pods.example/bob/private/diary.ttl",
    "https://pods.example/bob/docs/y/assets/photo.png",
    "https://pods.example/bob/docs/x-other/a.png",
    `${container}..%2f..%2fprivate.ttl`,
    "https://elsewhere.example/bob/docs/x/assets/photo.png",
  ])
    await scoped(url);
  expect(urls(authenticated)).toHaveLength(5);
  expect(urls(anonymous)).toEqual([
    "https://pods.example/bob/private/diary.ttl",
    "https://pods.example/bob/docs/y/assets/photo.png",
    "https://pods.example/bob/docs/x-other/a.png",
    `${container}..%2f..%2fprivate.ttl`,
    "https://elsewhere.example/bob/docs/x/assets/photo.png",
  ]);
  for (const [, init] of anonymous.mock.calls) expect(init).toMatchObject({ credentials: "omit" });
});

it("reads comments in a sibling pod's document with credentials", async () => {
  renderHook(() => useDocumentComments(runtime, editor));
  await waitFor(() =>
    expect(urls(authenticated).some((url) => url.startsWith(`${container}comments/`))).toBe(true),
  );
  expect(urls(anonymous).filter((url) => url.startsWith("https://pods.example/"))).toEqual([]);
});

it("lists version history in a sibling pod's document with credentials", async () => {
  render(
    <VersionHistory
      runtime={runtime}
      editor={editor}
      title="X"
      zoom={100}
      open
      close={() => {}}
      naming={false}
      closeNaming={() => {}}
    />,
  );
  await waitFor(() =>
    expect(urls(authenticated).some((url) => url.startsWith(`${container}versions/`))).toBe(true),
  );
  expect(urls(anonymous).filter((url) => url.startsWith("https://pods.example/"))).toEqual([]);
});

it("exports the document's private images with credentials, but not other images in that pod", async () => {
  const image = () =>
    new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
  authenticated.mockImplementation(async () => image());
  anonymous.mockImplementation(async () => image());
  const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 1, height: 1, close() {} })),
  );
  vi.spyOn(document, "createElement").mockReturnValue({
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
    toBlob: (callback: (blob: Blob) => void) => callback(png),
  } as unknown as HTMLElement);
  await readExportImage(session, `${container}assets/photo.png`, resource);
  expect(authenticated).toHaveBeenCalledWith(`${container}assets/photo.png`, {
    redirect: "error",
  });
  await readExportImage(session, "https://pods.example/bob/private/photo.png", resource);
  expect(authenticated).toHaveBeenCalledTimes(1);
  expect(anonymous).toHaveBeenCalledWith(
    "https://pods.example/bob/private/photo.png",
    expect.objectContaining({ credentials: "omit" }),
  );
  // Without the document, Bob's assets are foreign (for example a row export with no resource).
  await readExportImage(session, `${container}assets/photo.png`);
  expect(authenticated).toHaveBeenCalledTimes(1);
});
