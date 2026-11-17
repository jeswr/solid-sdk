// AUTHORED-BY Codex GPT-6.1-Sol
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { vi } from "vitest";

/** Operation observations for the Solid memory backend; no HTTP emulation. */
export interface StorageCall {
  method: string;
  url: string;
  body?: string;
  headers?: Record<string, string>;
}

export function recordingStorage(
  root = "https://alice.example/",
  onCall?: (call: StorageCall) => void | Promise<void>,
) {
  const storage = createMemoryStorage({ root, protocol: "solid" });
  const calls: StorageCall[] = [];
  const record = async (call: StorageCall) => {
    calls.push(call);
    await onCall?.(call);
  };
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementation(async (url, body, opts) => {
    await record({ url, method: "PUT", body: typeof body === "string" ? body : undefined,
      headers: { "content-type": opts.contentType, "if-match": opts.ifMatch } });
    return write(url, body, opts);
  });
  const create = storage.create.bind(storage);
  vi.spyOn(storage, "create").mockImplementation(async (parent, body, opts) => {
    const result = await create(parent, body, opts);
    await record({ url: result.url, method: "PUT", body: typeof body === "string" ? body : undefined });
    return result;
  });
  const head = storage.head.bind(storage);
  vi.spyOn(storage, "head").mockImplementation(async (url, opts) => {
    await record({ url, method: "HEAD" });
    return head(url, opts);
  });
  const read = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementation(async (url, opts) => {
    await record({ url, method: "GET" });
    return read(url, opts);
  });
  return { storage, calls, puts: () => calls.filter((call) => call.method === "PUT") };
}
