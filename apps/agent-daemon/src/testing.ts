// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { PodAuth } from "@jeswr/pod-auth";
import { type StorageClient, StorageError, type WriteResult } from "@jeswr/storage-client";
import { createAt } from "@jeswr/storage-client/helpers";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { checkedProposalResult, proposalResultKey } from "./proposal-results.js";
import type { Checkpoints, ProcessLease, ProposalResult, ProposalResults } from "./types.js";

/** Ephemeral test state; never substitutes for a durable deployment lease. */
export function createMemoryState() {
  const cursors = new Map<string, string>();
  const results = new Map<string, ProposalResult>();
  const proposalResults: ProposalResults = {
    async get(key) {
      proposalResultKey(key);
      const result = results.get(key);
      return result && checkedProposalResult(result);
    },
    async put(key, result) {
      proposalResultKey(key);
      results.set(key, checkedProposalResult(result));
    },
  };
  let held = false;
  const lease: ProcessLease = {
    async acquire() {
      if (held) throw new Error("Lease held");
      held = true;
      return async () => {
        held = false;
      };
    },
  };
  const checkpoints: Checkpoints = {
    get: async (account) => cursors.get(account),
    put: async (account, cursor) => {
      cursors.set(account, cursor);
    },
  };
  return { lease, checkpoints, proposalResults, cursors, held: () => held };
}
/** SDK memory storage plus a fetch adapter for SDKs that still accept a transport. */
export function createMemoryPod(root = "https://pod.example/") {
  const memory = createMemoryStorage({ protocol: "solid", root });
  const resources = new Map<string, { body: string; type: string; etag: string }>();
  const requests: { url: string; method: string; body: string; headers: Headers }[] = [];
  const record = (url: string, method: string, body = "", headers = new Headers()) =>
    requests.push({ url, method, body, headers });
  async function snapshot(url: string) {
    const current = await memory.read(url);
    resources.set(url, {
      body: await current.text(),
      type: current.contentType ?? "text/turtle",
      etag: current.etag ?? "",
    });
  }
  const storage: StorageClient = {
    ...memory,
    async head(url, options) {
      record(url, "HEAD");
      return memory.head(url, options);
    },
    async read(url, options) {
      record(url, "GET");
      return memory.read(url, options);
    },
    async write(url, body, options) {
      const headers = new Headers({ "content-type": options.contentType });
      if (options.ifMatch !== "*") headers.set("if-match", options.ifMatch);
      record(url, "PUT", String(body), headers);
      const result = await memory.write(url, body, options);
      await snapshot(result.url);
      return result;
    },
    async create(parent, body, options = {}) {
      const url = `${parent}${encodeURIComponent(options.name ?? "")}${options.kind === "container" ? "/" : ""}`;
      record(
        url,
        "PUT",
        String(body ?? ""),
        new Headers({
          "content-type": options.contentType ?? "text/turtle",
          "if-none-match": "*",
        }),
      );
      const result = await memory.create(parent, body, options);
      await snapshot(result.url);
      return result;
    },
  };
  const io: PodAuth["fetch"] = async (input, init) => {
    const request = new Request(input, init);
    const url = request.url;
    const method = request.method;
    const headers = request.headers;
    try {
      if (method === "PUT") {
        const body = await request.text();
        let result: WriteResult;
        if (url.endsWith("/") || headers.get("if-none-match") === "*") {
          result = await createAt(storage, url, body, {
            kind: url.endsWith("/") ? "container" : "resource",
            contentType: headers.get("content-type") ?? "text/turtle",
          });
        } else {
          result = await storage.write(url, body, {
            contentType: headers.get("content-type") ?? "text/turtle",
            ifMatch: headers.get("if-match") ?? "*",
          });
        }
        return new Response(null, {
          status: result.created ? 201 : 204,
          headers: { etag: result.etag ?? "" },
        });
      }
      if (method === "DELETE") {
        await memory.delete(url, {
          ifMatch: headers.get("if-match") ?? (await memory.head(url)).etag ?? undefined,
        });
        resources.delete(url);
        return new Response(null, { status: 204 });
      }
      const current = await (method === "HEAD" ? storage.head(url) : storage.read(url));
      return new Response(method === "HEAD" ? null : await current.text(), {
        headers: {
          "content-type": current.contentType ?? "text/turtle",
          etag: current.etag ?? "",
          ...(url.endsWith("/") ? { link: '<.acl>; rel="acl"' } : {}),
        },
      });
    } catch (error) {
      if (!(error instanceof StorageError) || error.status === null) throw error;
      return new Response(null, { status: error.status });
    }
  };
  return { io, storage, requests, resources };
}
