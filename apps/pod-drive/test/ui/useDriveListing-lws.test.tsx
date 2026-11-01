// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { assert, expect, it, vi } from "vitest";
import { useDriveListing } from "../../src/ui/useDriveListing.js";

// Exercise the hook through real SDK discovery and LWS listing requests.
vi.unmock("@jeswr/storage-client");

it("preserves LWS identifiers on mount, navigation, refresh, and root changes", async () => {
  const storageRoot = "https://lws-hook.pod-drive.example/";
  const root = `${storageRoot}drive`;
  const folder = `${storageRoot}opaque-folder`;
  const file = `${storageRoot}note.txt`;
  const description = `${storageRoot}storage`;
  const containers = new Map([
    [root, [{ id: folder, type: "Container" }]],
    [folder, [{ id: file, type: "DataResource", format: "text/plain" }]],
    [`${root}/`, []],
  ]);
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    if (url === description)
      return new Response(
        JSON.stringify({
          "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
          id: description,
          type: "Storage",
          service: [{ type: "StorageRoot", serviceEndpoint: storageRoot }],
        }),
        { headers: { "content-type": "application/lws+cid" } },
      );
    const items = containers.get(url);
    if (!items) return new Response(null, { status: 404 });
    return new Response(
      init?.method === "HEAD"
        ? null
        : JSON.stringify({ id: url, type: "Container", totalItems: items.length, items }),
      {
        headers: {
          "content-type": "application/lws+json",
          link: `<${description}>; rel="https://www.w3.org/ns/lws#storage", <https://www.w3.org/ns/lws#Container>; rel="type"`,
          etag: '"container"',
        },
      },
    );
  });
  const { result, rerender } = renderHook(
    ({ rootUrl }: { rootUrl: string }) => useDriveListing(rootUrl, { fetch }),
    { initialProps: { rootUrl: root } },
  );
  await waitFor(() => expect(result.current.listing?.url).toBe(root));
  expect(result.current.currentUrl).toBe(root);
  expect(result.current.error).toBeNull();
  const folderEntry = result.current.listing?.container.entries[0];
  assert(folderEntry);
  expect(folderEntry).toMatchObject({
    url: folder,
    isContainer: true,
  });

  act(() => result.current.navigate(folderEntry.url));
  await waitFor(() => expect(result.current.listing?.url).toBe(folder));
  expect(result.current.currentUrl).toBe(folder);
  expect(result.current.listing?.container.entries.map((entry) => entry.url)).toEqual([file]);
  expect(result.current.error).toBeNull();

  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(
    fetch.mock.calls.filter(([url, init]) => url === folder && init?.method === "GET"),
  ).toHaveLength(2);
  expect(fetch.mock.calls.some(([url]) => url === `${root}/` || url === `${folder}/`)).toBe(false);

  // A trailing slash can identify a different LWS container, including on root changes.
  rerender({ rootUrl: `${root}/` });
  await waitFor(() => expect(result.current.listing?.url).toBe(`${root}/`));
  expect(result.current.currentUrl).toBe(`${root}/`);
  expect(result.current.listing?.container.entries).toEqual([]);
  rerender({ rootUrl: root });
  await waitFor(() => expect(result.current.listing?.url).toBe(root));
  expect(result.current.currentUrl).toBe(root);
  expect(result.current.error).toBeNull();
});
