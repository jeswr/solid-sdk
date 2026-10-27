// AUTHORED-BY Codex GPT-6

import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { MessageChannel, MessagePort } from "node:worker_threads";

export const POD = "https://pod.example/private/note";
export const FOREIGN = "https://foreign.example/steal";

// Load Node's own bundled Undici in a separate VM realm, without adding a dependency.
// Injecting this realm's Request constructor alone would not test a different brand.
const binding = process as typeof process & { binding(name: string): Record<string, string> };
const realm = {
  module: { exports: {} as { Request: typeof Request } },
  require: createRequire(import.meta.url),
  process,
  Buffer,
  URL,
  URLSearchParams,
  AbortController,
  AbortSignal,
  TextEncoder,
  TextDecoder,
  ReadableStream,
  WritableStream,
  TransformStream,
  Blob,
  File,
  performance,
  structuredClone,
  setTimeout,
  clearTimeout,
  setImmediate,
  clearImmediate,
  queueMicrotask,
  console,
  Event,
  EventTarget,
  DOMException,
  MessageChannel,
  MessagePort,
};
runInNewContext("globalThis.global = globalThis", realm);
runInNewContext(binding.binding("natives")["internal/deps/undici/undici"], realm);

export const spoofedRequests = [
  [
    "own url value on Node's native Undici Request",
    () => {
      const request = new Request(FOREIGN);
      Object.defineProperty(request, "url", { value: POD });
      return request;
    },
  ],
  [
    "subclass url override",
    () => {
      class SpoofedRequest extends Request {
        override get url() {
          return POD;
        }
      }
      return new SpoofedRequest(FOREIGN);
    },
  ],
  [
    "url getter changing between reads",
    () => {
      const request = new Request(FOREIGN);
      let reads = 0;
      Object.defineProperty(request, "url", { get: () => (++reads === 1 ? POD : FOREIGN) });
      return request;
    },
  ],
  [
    "plain Request-like object",
    () =>
      ({
        url: POD,
        method: "GET",
        headers: new Headers(),
        toString: () => FOREIGN,
      }) as unknown as Request,
  ],
  [
    "Request from another node:vm realm",
    () => {
      const request = new realm.module.exports.Request(FOREIGN);
      Object.defineProperty(request, "url", { value: POD });
      // Native conversion treats incompatible Requests as string inputs. Supply the
      // foreign URL so the wrappers can exercise their existing public-fetch path.
      Object.defineProperty(request, "toString", { value: () => FOREIGN });
      return request;
    },
  ],
] as const;
