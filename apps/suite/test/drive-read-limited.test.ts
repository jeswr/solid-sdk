// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";

const ROOT = "https://pod.example/";
const FILE = `${ROOT}drive/report.pdf`;

function client(response: () => Response) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method !== "GET") return new Response(null, { status: 404 });
    return response();
  });
  return { fetch, client: createSolidDriveClient({ storageUrl: ROOT, fetch }) };
}

function stream(chunks: Uint8Array[], onCancel = vi.fn()) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel: onCancel,
  });
  return { body, onCancel };
}

describe("DriveClient.readLimited", () => {
  it("returns a body within the limit with its content type", async () => {
    const { body } = stream([new Uint8Array([1, 2]), new Uint8Array([3])]);
    const { client: drive } = client(
      () => new Response(body, { headers: { "content-type": "application/pdf" } }),
    );
    const blob = await drive.readLimited(FILE, 3);
    expect(blob?.type).toBe("application/pdf");
    expect([...new Uint8Array(await (blob as Blob).arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("refuses a declared Content-Length over the limit without reading the body", async () => {
    const { body, onCancel } = stream([new Uint8Array(10)]);
    const { client: drive } = client(
      () => new Response(body, { headers: { "content-length": "10" } }),
    );
    expect(await drive.readLimited(FILE, 9)).toBeUndefined();
    expect(onCancel).toHaveBeenCalled();
  });

  it("accepts a declared Content-Length equal to the limit", async () => {
    const { body } = stream([new Uint8Array(9)]);
    const { client: drive } = client(
      () => new Response(body, { headers: { "content-length": "9" } }),
    );
    expect((await drive.readLimited(FILE, 9))?.size).toBe(9);
  });

  it("falls back to the streaming cap when Content-Length is not a number", async () => {
    const chunks = [new Uint8Array(6), new Uint8Array(6), new Uint8Array(6)];
    const { body, onCancel } = stream(chunks);
    const { client: drive } = client(
      () => new Response(body, { headers: { "content-length": "lots" } }),
    );
    expect(await drive.readLimited(FILE, 9)).toBeUndefined();
    expect(onCancel).toHaveBeenCalled();
  });

  it("stops reading a body that exceeds the limit despite a smaller Content-Length", async () => {
    const pull = vi.fn();
    const { body, onCancel } = stream([new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)]);
    const { client: drive } = client(() => {
      const response = new Response(body, { headers: { "content-length": "4" } });
      pull();
      return response;
    });
    expect(await drive.readLimited(FILE, 6)).toBeUndefined();
    expect(onCancel).toHaveBeenCalled();
    expect(pull).toHaveBeenCalledTimes(1);
  });

  it("still refuses when cancelling the body fails", async () => {
    const failing = () => {
      const response = new Response("x".repeat(10), { headers: { "content-length": "10" } });
      vi.spyOn(response.body as ReadableStream, "cancel").mockRejectedValue(new Error("busy"));
      return response;
    };
    expect(await client(failing).client.readLimited(FILE, 5)).toBeUndefined();
    const streamed = () => {
      const response = new Response("x".repeat(10));
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      vi.spyOn(response.body as ReadableStream<Uint8Array>, "getReader").mockReturnValue(reader);
      vi.spyOn(reader, "cancel").mockRejectedValue(new Error("busy"));
      return response;
    };
    expect(await client(streamed).client.readLimited(FILE, 5)).toBeUndefined();
  });

  it("checks the size of a response without a body stream", async () => {
    const bodyless = (size: number) => () => {
      const response = new Response("x".repeat(size), {
        headers: { "content-type": "text/plain" },
      });
      Object.defineProperty(response, "body", { value: null });
      return response;
    };
    expect(await client(bodyless(4)).client.readLimited(FILE, 3)).toBeUndefined();
    expect((await client(bodyless(3)).client.readLimited(FILE, 3))?.size).toBe(3);
  });

  it("rejects a failed read like read()", async () => {
    const { client: drive } = client(() => new Response(null, { status: 403 }));
    await expect(drive.readLimited(FILE, 10)).rejects.toThrow();
  });
});
