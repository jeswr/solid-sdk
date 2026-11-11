// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { DataFactory, Store } from "n3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { ChatNode, NS, serializeChat } from "../src/apps/chat/lib/model/rdf";
import { useCommentAuthors } from "../src/apps/docs/hooks/use-comment-authors";
import type { CommentThread } from "../src/apps/docs/lib/model/comments";
import type { SolidPodSession } from "../src/lib/session/types";

const storageUrl = "https://pod.example/alice/";
const webId = `${storageUrl}profile/card#me`;
function churnAuthor(index: number): string {
  return `${storageUrl}profile/author-${index}#me`;
}
function threadsFor(creator = webId): CommentThread[] {
  const root = {
    url: `${storageUrl}docs/plan/comments/one.ttl`,
    etag: null,
    text: "Discuss",
    creator,
    created: "2026-11-10T10:00:00Z",
    target: `${storageUrl}docs/plan.ttl`,
    kind: "root" as const,
    resolved: false,
  };
  return [{ root, replies: [{ ...root, url: "reply", kind: "reply" }] }];
}
function session(fetch: typeof globalThis.fetch, publicFetch = vi.fn()): SolidPodSession {
  return {
    mode: "solid",
    webId,
    storageUrl,
    displayName: "Session alias",
    fetch,
    publicFetch,
    subscribe: () => () => {},
  };
}
async function profile(creator: string, foaf?: string, vcard?: string): Promise<Response> {
  const dataset = new Store();
  const person = new ChatNode(creator, dataset, DataFactory);
  person.setText(`${NS.FOAF}name`, foaf);
  person.setText(`${NS.VCARD}fn`, vcard);
  return new Response(await serializeChat(dataset), { headers: { "content-type": "text/turtle" } });
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([
  ["Alice", "Alice vCard", "Alice"],
  [undefined, "Alice vCard", "Alice vCard"],
  ["   ", " Alice vCard ", "Alice vCard"],
])("resolves foaf:name %s and vcard:fn %s from the author's profile", async (foaf, vcard, expected) => {
  const fetch = vi.fn().mockResolvedValue(await profile(webId, foaf, vcard));
  const pod = session(fetch);
  const threads = threadsFor();
  const { result } = renderHook(() => useCommentAuthors(pod, threads));
  await waitFor(() => expect(result.current(webId)).toBe(expected));
  expect(fetch).toHaveBeenCalledOnce();
  expect(pod.publicFetch).not.toHaveBeenCalled();
});

it("uses the host while loading and caches in-flight and completed lookups across replies and refreshes", async () => {
  const pending = deferred();
  const fetch = vi.fn().mockReturnValue(pending.promise);
  const pod = session(fetch);
  const { result, rerender } = renderHook(({ threads }) => useCommentAuthors(pod, threads), {
    initialProps: { threads: threadsFor() },
  });
  expect(result.current(webId)).toBe("pod.example");
  rerender({ threads: [...threadsFor(), ...threadsFor()] });
  expect(fetch).toHaveBeenCalledOnce();
  await act(async () => pending.resolve(await profile(webId, "Alice")));
  await waitFor(() => expect(result.current(webId)).toBe("Alice"));
  rerender({ threads: [] });
  rerender({ threads: threadsFor() });
  await waitFor(() => expect(result.current(webId)).toBe("Alice"));
  expect(fetch).toHaveBeenCalledOnce();
});

it("bounds cached lookups and drops resolved names as 500 authors cycle through a document", async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const creator = new URL(input instanceof Request ? input.url : input);
    creator.hash = "me";
    return profile(creator.href, creator.pathname);
  });
  const pod = session(fetch);
  const authors = Array.from({ length: 500 }, (_, index) => churnAuthor(index));
  const { result, rerender } = renderHook(({ threads }) => useCommentAuthors(pod, threads), {
    initialProps: { threads: [] as CommentThread[] },
  });
  for (const creator of authors) {
    await act(async () => rerender({ threads: threadsFor(creator) }));
    expect(result.current(creator)).toBe(new URL(creator).pathname);
  }
  rerender({ threads: [] });
  for (const creator of authors) expect(result.current(creator)).toBe("pod.example");
  expect(fetch).toHaveBeenCalledTimes(500);

  // The recent lookup survives a sidebar refresh; the oldest must be fetched again.
  const newest = churnAuthor(499);
  await act(async () => rerender({ threads: threadsFor(newest) }));
  expect(result.current(newest)).toBe(new URL(newest).pathname);
  expect(fetch).toHaveBeenCalledTimes(500);
  const oldest = churnAuthor(0);
  await act(async () => rerender({ threads: threadsFor(oldest) }));
  expect(result.current(oldest)).toBe(new URL(oldest).pathname);
  expect(fetch).toHaveBeenCalledTimes(501);
});

it("evicts the least recently used author rather than a recently reused lookup", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("Offline"));
  const pod = session(fetch);
  const authors = Array.from({ length: 129 }, (_, index) => churnAuthor(index));
  const { rerender } = renderHook(({ threads }) => useCommentAuthors(pod, threads), {
    initialProps: { threads: [] as CommentThread[] },
  });
  for (const creator of authors.slice(0, 128)) {
    await act(async () => rerender({ threads: threadsFor(creator) }));
  }
  await act(async () => rerender({ threads: threadsFor(churnAuthor(0)) }));
  await act(async () => rerender({ threads: threadsFor(churnAuthor(128)) }));
  await act(async () => rerender({ threads: threadsFor(churnAuthor(0)) }));
  expect(fetch).toHaveBeenCalledTimes(129);
  await act(async () => rerender({ threads: threadsFor(churnAuthor(1)) }));
  expect(fetch).toHaveBeenCalledTimes(130);
});

it("does not restore a removed author's name when their pending lookup finishes", async () => {
  const pending = deferred();
  const fetch = vi.fn().mockReturnValue(pending.promise);
  const pod = session(fetch);
  const { result, rerender } = renderHook(({ threads }) => useCommentAuthors(pod, threads), {
    initialProps: { threads: threadsFor() },
  });
  rerender({ threads: [] });
  await act(async () => pending.resolve(await profile(webId, "Alice")));
  expect(result.current(webId)).toBe("pod.example");
  await act(async () => rerender({ threads: threadsFor() }));
  expect(result.current(webId)).toBe("Alice");
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([
  "no name",
  "blank name",
  "HTTP error",
  "network error",
  "redirect",
])("keeps a readable host when the profile has %s", async (failure) => {
  const response =
    failure === "HTTP error"
      ? new Response(null, { status: 404 })
      : failure === "redirect"
        ? new Response(null, { status: 302, headers: { location: "https://foreign.example/" } })
        : await profile(webId, failure === "blank name" ? " " : undefined);
  const fetch = vi.fn().mockImplementation(async () => {
    if (failure === "network error") throw new Error("Offline");
    return response;
  });
  const pod = session(fetch);
  const { result, rerender } = renderHook(({ threads }) => useCommentAuthors(pod, threads), {
    initialProps: { threads: threadsFor() },
  });
  await act(async () => {});
  expect(result.current(webId)).toBe("pod.example");
  rerender({ threads: threadsFor() });
  await act(async () => {});
  expect(fetch).toHaveBeenCalledOnce();
  expect(result.current("invalid")).toBe("Unknown author");
});

it.each([
  "https://bob.example/profile/card#me",
  "https://pod.example/bob/profile/card#me",
])("uses only credential-free public fetch outside the pod scope: %s", async (creator) => {
  const fetch = vi.fn();
  const publicFetch = vi.fn().mockResolvedValue(await profile(creator, undefined, "Bob"));
  const pod = session(fetch, publicFetch);
  const threads = threadsFor(creator);
  const { result } = renderHook(() => useCommentAuthors(pod, threads));
  await waitFor(() => expect(result.current(creator)).toBe("Bob"));
  expect(fetch).not.toHaveBeenCalled();
  expect(publicFetch).toHaveBeenCalledOnce();
  const [, init] = publicFetch.mock.calls[0] as unknown as Parameters<typeof globalThis.fetch>;
  expect(init?.credentials).toBe("omit");
  expect(init?.redirect).toBe("manual");
  const headers = new Headers(init?.headers);
  for (const header of ["authorization", "cookie", "dpop"]) expect(headers.has(header)).toBe(false);
});

it("resolves authors independently and ignores pending results from a replaced session or unmounted hook", async () => {
  const old = deferred();
  const current = deferred();
  const bob = "https://bob.example/profile/card#me";
  const threads = [...threadsFor(), ...threadsFor(bob)];
  const oldPod = session(
    vi.fn().mockReturnValue(old.promise),
    vi.fn().mockReturnValue(old.promise),
  );
  const newPod = session(
    vi.fn().mockReturnValue(current.promise),
    vi.fn().mockReturnValue(old.promise),
  );
  const { result, rerender, unmount } = renderHook(({ pod }) => useCommentAuthors(pod, threads), {
    initialProps: { pod: oldPod },
  });
  rerender({ pod: newPod });
  await act(async () => current.resolve(await profile(webId, "Alice new")));
  await waitFor(() => expect(result.current(webId)).toBe("Alice new"));
  expect(result.current(bob)).toBe("bob.example");
  await act(async () => old.resolve(await profile(webId, "Alice old")));
  expect(result.current(webId)).toBe("Alice new");
  const last = deferred();
  rerender({ pod: session(vi.fn().mockReturnValue(last.promise)) });
  expect(result.current(webId)).toBe("pod.example");
  unmount();
  await act(async () => last.resolve(await profile(webId, "Unmounted")));
});
