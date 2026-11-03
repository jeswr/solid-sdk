// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { DocumentBrowser } from "./DocumentBrowser.js";

vi.unmock("@jeswr/storage-client");

it.each([
  false,
  true,
])("restores an assigned LWS collection after remount (first document fails: %s)", async (failDocument) => {
  const podRoot = `https://docs-remount-${failDocument}.example/`;
  const webId = `${podRoot}card#me`;
  const collection = `${podRoot}assigned-collection`;
  const document = `${podRoot}unrelated-document`;
  const description = `${podRoot}storage`;
  let collectionExists = false;
  let body: BodyInit | null | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const links = `<${description}>; rel="https://www.w3.org/ns/lws#storage"`;
    if (url === description)
      return new Response(
        JSON.stringify({
          "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
          id: description,
          type: "Storage",
          service: [{ type: "StorageRoot", serviceEndpoint: podRoot }],
        }),
        { headers: { "content-type": "application/lws+cid" } },
      );
    if (method === "POST") {
      if (url === podRoot) {
        collectionExists = true;
        return new Response(null, { status: 201, headers: { location: collection, etag: '"c"' } });
      }
      expect(url).toBe(collection);
      if (failDocument) return new Response(null, { status: 500 });
      body = init?.body;
      return new Response(null, { status: 201, headers: { location: document, etag: '"d"' } });
    }
    if (url === document && body)
      return new Response(method === "HEAD" ? null : body, {
        headers: {
          "content-type": "text/turtle",
          etag: '"d"',
          link: `${links}, <${collection}>; rel="up"`,
        },
      });
    if (url === podRoot || (url === collection && collectionExists))
      return new Response(
        method === "HEAD"
          ? null
          : JSON.stringify({
              type: "Container",
              items: body ? [{ id: document, type: "DataResource" }] : [],
            }),
        {
          headers: {
            "content-type": "application/lws+json",
            link: `${links}, <https://www.w3.org/ns/lws#Container>; rel="type"`,
            etag: '"c"',
          },
        },
      );
    return new Response(null, { status: 404 });
  });
  const saved = new Map<string, string>();
  const onContainerChange = vi.fn(
    (selection: { podRoot: string; webId: string; container: string }) => {
      saved.set(JSON.stringify([selection.webId, selection.podRoot]), selection.container);
    },
  );
  function Host() {
    const [container, setContainer] = useState(saved.get(JSON.stringify([webId, podRoot])));
    return (
      <DocumentBrowser
        podRoot={podRoot}
        webId={webId}
        fetch={fetch}
        container={container}
        onContainerChange={(selection) => {
          onContainerChange(selection);
          setContainer(selection.container);
        }}
      />
    );
  }
  const first = render(<Host />);
  await screen.findByText(/no documents yet/i);
  fireEvent.click(screen.getByRole("button", { name: /new document/i }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Remembered note" } });
  fireEvent.click(screen.getByRole("button", { name: /create document/i }));
  if (failDocument) await screen.findByRole("alert");
  else {
    await screen.findByText(/^Saved$/);
    expect(screen.getByRole("heading", { name: "Remembered note" })).toBeInTheDocument();
  }
  expect(onContainerChange).toHaveBeenCalledExactlyOnceWith({
    podRoot,
    webId,
    container: collection,
  });
  first.unmount();

  fetch.mockClear();
  render(<Host />);
  if (failDocument) await screen.findByText(/no documents yet/i);
  else expect(await screen.findByRole("button", { name: /Remembered note/i })).toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => String(url) === `${podRoot}pod-docs/`)).toBe(false);
  expect(
    fetch.mock.calls.some(([url, init]) => String(url) === collection && init?.method === "GET"),
  ).toBe(true);
});
