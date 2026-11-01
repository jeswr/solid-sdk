// AUTHORED-BY Codex GPT-6.1-Sol
import type { PodAuth } from "@jeswr/pod-auth";
import type { Checkpoints, ProcessLease } from "./types.js";

/** Ephemeral test state; never substitutes for a durable deployment lease. */
export function createMemoryState() {
  const cursors = new Map<string, string>();
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
  return { lease, checkpoints, cursors, held: () => held };
}
/** Conditional in-memory pod transport. No authentication or server is simulated. */
export function createMemoryPod() {
  const resources = new Map<string, { body: string; type: string; etag: string }>();
  const requests: { url: string; method: string; body: string; headers: Headers }[] = [];
  let revision = 0;
  const io: PodAuth["fetch"] = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = String(init?.body ?? "");
    requests.push({ url, method, body, headers });
    const current = resources.get(url);
    if (method === "PUT") {
      if (
        (headers.get("if-none-match") === "*" && current) ||
        (headers.has("if-match") && headers.get("if-match") !== current?.etag)
      )
        return new Response(null, { status: 412 });
      resources.set(url, {
        body,
        type: headers.get("content-type") ?? "text/turtle",
        etag: `"${++revision}"`,
      });
      return new Response(null, { status: current ? 205 : 201 });
    }
    return new Response(method === "HEAD" ? null : (current?.body ?? null), {
      status: current ? 200 : 404,
      headers: current ? { "content-type": current.type, etag: current.etag } : {},
    });
  };
  return { io, requests, resources };
}
