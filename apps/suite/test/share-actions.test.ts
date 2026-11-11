// AUTHORED-BY Codex GPT-6

import { parseRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { ShareBatch } from "@jeswr/suite-native";
import { beforeEach, expect, it, vi } from "vitest";
import { createShareActions } from "../src/apps/drive/state/share-actions";
import { ManualRegistrationError } from "../src/apps/home/components/item/manual-data";
import { BOOKMARK_FIELDS } from "../src/apps/home/lib/forms/edit-map";
import type { PodSession } from "../src/lib/session/pod-session";

const actions = vi.hoisted(() => ({
  create: vi.fn(),
  createManualItem: vi.fn(),
  registerManualType: vi.fn(),
  loadTemplate: vi.fn(),
  readResource: vi.fn(),
}));
vi.mock("../src/apps/notes/lib/model/store", () => ({
  createNotesStore: () => ({ create: actions.create }),
}));
vi.mock("../src/apps/home/lib/templates", () => ({ loadTemplate: actions.loadTemplate }));
vi.mock("../src/apps/home/lib/model/rdf", async (original) => ({
  ...(await original<typeof import("../src/apps/home/lib/model/rdf")>()),
  readResource: actions.readResource,
}));
vi.mock("../src/apps/home/components/item/manual-data", async (original) => ({
  ...(await original<typeof import("../src/apps/home/components/item/manual-data")>()),
  createManualItem: actions.createManualItem,
  registerManualType: actions.registerManualType,
}));
const session: PodSession = {
  mode: "solid",
  storageUrl: "https://pod.example/",
  webId: "https://pod.example/profile#me",
  displayName: "Alice",
  fetch: vi.fn(),
  publicFetch: vi.fn(),
  subscribe: () => () => {},
};
const batch: ShareBatch = { id: "batch-1", receivedAt: "2026-11-10T12:00:00Z", items: [] };
beforeEach(() => {
  vi.resetAllMocks();
  actions.readResource.mockRejectedValue(new RdfFetchError("Not found", { status: 404 }));
});

it("uses the existing note writer with shared text escaped before HTML storage", async () => {
  const saver = createShareActions(session);
  expect(actions.create).not.toHaveBeenCalled();
  await saver.saveText({ kind: "text", text: '<script>alert("x")</script>\r\n& literal text' });
  expect(actions.create).toHaveBeenCalledWith({
    title: '<script>alert("x")</script>',
    body: "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p><p>&amp; literal text</p>",
  });
});

it("saves a URL with Home's bookmark template, fields and authenticated session", async () => {
  const saver = createShareActions(session);
  const template = {};
  actions.loadTemplate.mockResolvedValue(template);
  const item = {
    kind: "url" as const,
    title: "Shared article",
    url: "https://example.org/article",
  };
  await saver.saveLink(item, batch, 0);
  const url = "https://pod.example/bookmarks/shared-article-batch-1-0.ttl";
  expect(actions.loadTemplate).toHaveBeenCalledWith(
    "http://www.w3.org/2002/01/bookmark#Bookmark",
    url,
  );
  expect(actions.createManualItem).toHaveBeenCalledWith(
    session,
    expect.objectContaining({ id: "bookmarks" }),
    url,
    template,
    BOOKMARK_FIELDS,
    {
      "http://purl.org/dc/terms/title": item.title,
      "http://www.w3.org/2002/01/bookmark#recalls": item.url,
    },
  );
});

it("retries bookmark registration without creating the saved bookmark again", async () => {
  const saver = createShareActions(session);
  const item = { kind: "url" as const, url: "https://example.org/article" };
  actions.createManualItem.mockRejectedValueOnce(
    new ManualRegistrationError("saved", new Error("offline")),
  );
  await expect(saver.saveLink(item, batch, 1)).rejects.toBeInstanceOf(ManualRegistrationError);
  actions.readResource.mockResolvedValueOnce({
    dataset: await parseRdf(
      '<#it> a <http://www.w3.org/2002/01/bookmark#Bookmark>; <http://purl.org/dc/terms/title> "https://example.org/article"; <http://www.w3.org/2002/01/bookmark#recalls> <https://example.org/article>.',
      "text/turtle",
      { baseIRI: "https://pod.example/bookmarks/https-example-org-article-batch-1-1.ttl" },
    ),
  });
  await createShareActions(session).saveLink(item, batch, 1);
  expect(actions.createManualItem).toHaveBeenCalledTimes(1);
  expect(actions.registerManualType).toHaveBeenCalledWith(
    session,
    "http://www.w3.org/2002/01/bookmark#Bookmark",
    "https://pod.example/bookmarks/",
  );
});

it("keeps an unreadable or different bookmark pending instead of overwriting it", async () => {
  const saver = createShareActions(session);
  const item = { kind: "url" as const, url: "https://example.org/article" };
  actions.readResource.mockRejectedValueOnce(new RdfFetchError("Forbidden", { status: 403 }));
  await expect(saver.saveLink(item, batch, 1)).rejects.toMatchObject({ status: 403 });
  actions.readResource.mockResolvedValueOnce({ dataset: await parseRdf("", "text/turtle") });
  await expect(saver.saveLink(item, batch, 1)).rejects.toThrow("different bookmark");
  expect(actions.createManualItem).not.toHaveBeenCalled();
  expect(actions.registerManualType).not.toHaveBeenCalled();
});
