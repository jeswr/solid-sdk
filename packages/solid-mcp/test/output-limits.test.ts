// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_CONTENT_BYTES } from "../src/content.js";
import { fetchDocument } from "../src/fetch.js";
import { listContainer, readRdf, readResource } from "../src/pod.js";
import { POD_READ_TIMEOUT_MS } from "../src/pod-operation.js";
import { createFetchPodPort, type PodPort } from "../src/pod-port.js";
import { containerTurtle } from "./fake-pod.js";

const ROOT = "https://pod.example.org/data/";
const CHILD = `${ROOT}child`;
const CHUNK_BYTES = 64 * 1024;
const operations = { fetchDocument, readResource, readRdf, listContainer };

afterEach(() => vi.useRealTimers());

function fixture(
  kind: "huge" | "body stalls" | "headers stall",
  decorated: boolean,
  delay = 0,
  contentType = "text/turtle",
) {
  const cancel = vi.fn();
  let downloaded = 0;
  let signal: AbortSignal | null | undefined;
  let rootReads = 0;
  const fetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === ROOT) {
      const initial = rootReads++ === 0;
      if (initial && delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return new Response(
        initial && contentType !== "text/turtle"
          ? `Raw listing: ${CHILD}`
          : containerTurtle(ROOT, [{ name: "child" }]),
        {
          headers: { "content-type": initial ? contentType : "text/turtle" },
        },
      );
    }
    expect(url).toBe(CHILD);
    signal = init?.signal;
    if (kind === "headers stall") return new Promise<Response>(() => {});
    return new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (kind === "body stalls") return new Promise<void>(() => {});
            downloaded += CHUNK_BYTES;
            controller.enqueue(new Uint8Array(CHUNK_BYTES));
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
      { headers: { "content-type": "application/octet-stream" } },
    );
  });
  const pod = createFetchPodPort({ fetch, podRoot: ROOT });
  if (decorated) {
    const read = pod.read;
    pod.read = vi.fn(async (url, options) => {
      const result = await read(url, options);
      // Unknown decorators may authorize using the complete body. Truncated
      // bodies must never reach them and accidentally authorize the child.
      if (url === CHILD) throw new Error("purpose denied");
      return result;
    });
  }
  return { pod, fetch, cancel, downloaded: () => downloaded, signal: () => signal };
}

describe.each(["text/turtle", "text/plain", "text/html"])("%s", (contentType) => {
  describe.each(
    Object.entries(operations),
  )("bounded container projection: %s", (_name, operation) => {
    it.each([
      "huge",
      "body stalls",
    ] as const)("discards an unused native child body (%s)", async (kind) => {
      const f = fixture(kind, false, 0, contentType);
      const result = await operation(f.pod, ROOT);
      expect(JSON.stringify(result)).toContain(CHILD);
      expect(f.downloaded()).toBe(0);
      expect(f.cancel).toHaveBeenCalledOnce();
    });

    it("bounds a huge decorated child read and omits its membership and descriptions", async () => {
      const f = fixture("huge", true, 0, contentType);
      const result = await operation(f.pod, ROOT);
      expect(JSON.stringify(result)).not.toContain(CHILD);
      expect(f.downloaded()).toBeLessThanOrEqual(MAX_CONTENT_BYTES + CHUNK_BYTES);
      expect(f.cancel).toHaveBeenCalledOnce();
    });

    it.each([
      "body stalls",
      "headers stall",
    ] as const)("shares the initial read's deadline when child %s", async (kind) => {
      vi.useFakeTimers();
      const f = fixture(kind, true, 2000, contentType);
      const pending = operation(f.pod, ROOT);
      const settled = pending.then(
        () => "completed",
        (error: Error) => error.message,
      );
      await vi.advanceTimersByTimeAsync(POD_READ_TIMEOUT_MS - 1);
      expect(f.signal()).toBeDefined();
      expect(f.signal()?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await settled).toBe("Pod read deadline reached.");
      expect(f.signal()?.aborted).toBe(true);
      expect(f.downloaded()).toBe(0);
      if (kind === "body stalls") expect(f.cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("bounds pending authorization by an injected portable port too", async () => {
      vi.useFakeTimers();
      const pod: PodPort = {
        root: ROOT,
        webId: "",
        async read(url) {
          if (url === CHILD) return new Promise(() => {});
          return {
            body: new TextEncoder().encode(containerTurtle(ROOT, [{ name: "child" }])),
            contentType: "text/turtle",
          };
        },
        async list() {
          return [{ url: CHILD, isContainer: false }];
        },
        async write() {
          throw new Error("read-only");
        },
        async delete() {
          throw new Error("read-only");
        },
      };
      const settled = operation(pod, ROOT).catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(POD_READ_TIMEOUT_MS);
      expect(await settled).toBe("Pod read deadline reached.");
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
