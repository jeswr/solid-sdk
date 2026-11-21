// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createAgentMemory } from "@jeswr/agent-memory";
import { createMemoryApprovalQueue } from "@jeswr/agent-memory/testing";
import { Cast, craftSigned } from "@jeswr/agent-reference/scenarios/common";
import type { PodAuth } from "@jeswr/pod-auth";
import { type StorageClient, StorageError, type WriteResult } from "@jeswr/storage-client";
import { createAt } from "@jeswr/storage-client/helpers";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createGate, type StoredVerdict } from "./gate.js";
import { denyAllMandate } from "./gate-setup.js";
import { createRuntimeMemory } from "./memory.js";
import { checkedProposalResult, proposalResultKey } from "./proposal-results.js";
import type { Checkpoints, ProcessLease, ProposalResult, ProposalResults } from "./types.js";

/** Synthetic peers and an in-memory reference gate for offline host tests. */
export async function createTestGate(
  now = () => new Date("2026-10-19T08:00:00Z"),
  identity = {
    actor: "https://receiver.example/agent#id",
    party: "https://receiver.example/owner#id",
  },
) {
  const cast = new Cast(now);
  const receiver = await cast.add(
    {
      name: "receiver",
      ...identity,
    },
    denyAllMandate,
    [],
  );
  const peer = await cast.add(
    {
      name: "peer",
      actor: "https://peer.example/agent#id",
      party: "https://peer.example/owner#id",
    },
    denyAllMandate,
    [],
  );
  cast.pin("receiver", "peer");
  async function open() {
    const { runtime, ledger } = await cast.runtime("receiver", []);
    const verdicts = new Map<string, StoredVerdict>();
    const gate = createGate(
      runtime,
      {
        get: async (hex) => verdicts.get(hex),
        put: async (hex, verdict) => void verdicts.set(hex, verdict),
        digests: async () => [...verdicts.keys()],
      },
      ledger,
      [
        { subject: peer.identity.actor, thumbprint: peer.actorKey.kid },
        { subject: peer.identity.party, thumbprint: peer.ownerKey.kid },
      ],
      now,
    );
    return { gate, ledger };
  }
  const sign = async (message: object) => (await craftSigned(peer, message)).jws;
  return { ...(await open()), open, peer, receiver, sign, now };
}

/** An empty runtime memory for offline daemon fixtures without an owner mandate. */
export function createTestMemory() {
  const root = "https://pod.example/";
  const { queueApproval } = createMemoryApprovalQueue();
  const owner = createAgentMemory({
    storage: createMemoryPod(root).storage,
    container: `${root}agent/memory/`,
    ownerWebId: `${root}profile/card#me`,
    agentId: `${root}profile/agent#me`,
    loadMandate: async () => undefined,
    queueApproval,
    webIdKeyResolver: {
      resolveKey: async () => undefined,
      isControlledBy: async () => false,
    },
    shapes: "# This recall-only fixture has no owner write path.",
  });
  return createRuntimeMemory({ facts: () => [], owner, purpose: "urn:test:daemon-memory" });
}

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
  const aclLinks = new Map<string, string | null>();
  const aclLink = (url: string) => {
    const target = aclLinks.get(url);
    return target === undefined ? (url.endsWith("/") ? ".acl" : `${url}.acl`) : target;
  };
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
      const result = await memory.head(url, options);
      const target = aclLink(url);
      if (target === null) return result;
      return {
        ...result,
        links: new Map(result.links).set("acl", [
          { target: new URL(target, url).href, params: {} },
        ]),
      };
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
      const { name, ...rest } = options;
      const url =
        options.exactUrl ??
        `${parent}${encodeURIComponent(name ?? "")}${options.kind === "container" ? "/" : ""}`;
      record(
        url,
        "PUT",
        String(body ?? ""),
        new Headers({
          "content-type": options.contentType ?? "text/turtle",
          "if-none-match": "*",
        }),
      );
      // A Solid named create uses exact PUT, which can also create missing parent containers.
      const result = await memory.create(
        parent,
        body,
        name !== undefined && options.exactUrl === undefined ? { ...rest, exactUrl: url } : options,
      );
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
      const target = aclLink(url);
      return new Response(method === "HEAD" ? null : await current.text(), {
        headers: {
          "content-type": current.contentType ?? "text/turtle",
          etag: current.etag ?? "",
          ...(target === null ? {} : { link: `<${target}>; rel="acl"` }),
        },
      });
    } catch (error) {
      if (!(error instanceof StorageError) || error.status === null) throw error;
      return new Response(null, { status: error.status });
    }
  };
  return { io, storage, requests, resources, aclLinks };
}
