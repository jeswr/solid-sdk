// AUTHORED-BY Codex GPT-6.1-Sol
import { digestOf, recordFromTurtle } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { StorageError } from "@jeswr/storage-client";
import { LiteralFrom, OptionalAs, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { expect, it, vi } from "vitest";
import { createMemoryPod } from "../src/testing.js";
import { PodWorkspace } from "../src/workspace.js";

const root = "https://pod.example/owner/";
const ownerWebId = `${root}profile#me`;
const privateTypeIndex = `${root}settings/privateTypeIndex.ttl`;
it("registers a private AgentWorkspace, preserves unrelated RDF, uses ETags, and is idempotent", async () => {
  const pod = createMemoryPod(root);
  const dataset = new Store();
  OptionalAs.object(
    new TermWrapper("urn:fixture:unrelated", dataset, DataFactory),
    "urn:predicate",
    "preserve",
    LiteralFrom.string,
  );
  const initial = await pod.storage.write(
    privateTypeIndex,
    await serialize([...dataset], { format: "text/turtle" }),
    { contentType: "text/turtle", ifMatch: "*" },
  );
  pod.requests.length = 0;
  const workspace = new PodWorkspace({
    io: pod.io,
    storage: pod.storage,
    root,
    ownerWebId,
    privateTypeIndex,
  });
  await workspace.initialize();
  const index = pod.resources.get(privateTypeIndex)?.body;
  expect(index).toContain("preserve");
  expect(index).toContain("https://jeswr.org/ns/agent#AgentWorkspace");
  expect(index).toContain(`${root}agent/`);
  expect(
    pod.requests
      .find((r) => r.url === privateTypeIndex && r.method === "PUT")
      ?.headers.get("if-match"),
  ).toBe(initial.etag);
  await workspace.initialize();
  expect(pod.requests.filter((r) => r.url === privateTypeIndex && r.method === "PUT")).toHaveLength(
    1,
  );
});
it("does not create or replace an unreadable or unvalidated index, and bounds conflicts", async () => {
  for (const status of [403, 200, 412]) {
    const pod = createMemoryPod(root);
    if (status !== 403) {
      await pod.storage.write(privateTypeIndex, "", { contentType: "text/turtle", ifMatch: "*" });
    }
    const read = pod.storage.read;
    vi.spyOn(pod.storage, "read").mockImplementation(async (url, opts) => {
      if (url !== privateTypeIndex) return read(url, opts);
      if (status === 403) throw new StorageError("forbidden", { method: "GET", url, status });
      const result = await read(url, opts);
      return status === 200 ? { ...result, etag: null } : result;
    });
    if (status === 412) {
      const write = pod.storage.write;
      vi.spyOn(pod.storage, "write").mockImplementation(async (url, body, opts) => {
        if (url === privateTypeIndex)
          throw new StorageError("precondition-failed", { method: "PUT", url, status });
        return write(url, body, opts);
      });
    }
    pod.requests.length = 0;
    const workspace = new PodWorkspace({
      io: pod.io,
      storage: pod.storage,
      root,
      ownerWebId,
      privateTypeIndex,
    });
    await expect(workspace.initialize()).rejects.toThrow(
      status === 412 ? "conflict limit" : status === 200 ? "validator" : "read failed",
    );
    expect(
      pod.requests.filter((r) => r.url === privateTypeIndex && r.method === "PUT"),
    ).toHaveLength(0);
  }
});
it("refuses foreign, sibling-prefix, credentialed, query and redirect destinations before writing content", async () => {
  const pod = createMemoryPod(root);
  for (const index of [
    "https://foreign.example/index",
    "https://pod.example/owner-evil/index",
    `${privateTypeIndex}?secret=fixture`,
    "https://user:fixture@pod.example/owner/index",
  ]) {
    expect(
      () =>
        new PodWorkspace({
          io: pod.io,
          storage: pod.storage,
          root,
          ownerWebId,
          privateTypeIndex: index,
        }),
    ).toThrow();
  }
  const workspace = new PodWorkspace({
    storage: pod.storage,
    io: async () => new Response(null, { status: 302 }),
    root,
    ownerWebId,
    privateTypeIndex,
  });
  await expect(workspace.io(root)).rejects.toThrow("redirect");
  await expect(workspace.io("https://foreign.example/")).rejects.toThrow("outside");
  expect(pod.requests).toHaveLength(0);
  expect(workspace.within("https://pod.example/owner/agent-evil/approvals/1")).toBe(false);
});
it("stamps local proposal destinations, refuses conflicting rewrites and serializes heartbeat RDF", async () => {
  const pod = createMemoryPod(root);
  const workspace = new PodWorkspace({
    io: pod.io,
    storage: pod.storage,
    root,
    ownerWebId,
    privateTypeIndex,
  });
  await workspace.initialize();
  const original = exampleRecords["action-proposal"];
  const id = workspace.proposalLocation(original.id);
  expect(id).toBe(`${root}agent/proposals/${digestOf(original.id).slice(8)}.ttl`);
  const proposal = { ...original, id };
  await workspace.proposal(proposal);
  await workspace.proposal(proposal);
  expect(await recordFromTurtle(pod.resources.get(id)?.body ?? "", id)).toEqual(proposal);
  await expect(
    workspace.proposal({ ...proposal, renderedPreview: "Changed terms" }),
  ).rejects.toThrow("conflict");
  await expect(workspace.proposal(original)).rejects.toThrow("outside");
  await workspace.heartbeat(new Date("2026-11-01T12:00:00Z"));
  expect(pod.resources.get(`${root}agent/control/heartbeat.ttl`)?.body).toContain(
    "2026-11-01T12:00:00.000Z",
  );
  await expect(workspace.inbox("../escape", "fixture")).rejects.toThrow();
});
it("publishes exactly the agent's introduction at descriptors/agent.ttl and keeps it current", async () => {
  const pod = createMemoryPod(root);
  const workspace = new PodWorkspace({
    io: pod.io,
    storage: pod.storage,
    root,
    ownerWebId,
    privateTypeIndex,
  });
  await workspace.initialize();
  const url = `${root}agent/descriptors/agent.ttl`;
  const triples = async () =>
    [...(await parseRdf(pod.resources.get(url)?.body ?? "", "text/turtle", { baseIRI: url }))]
      .map((q) => [q.subject.value, q.predicate.value, q.object.value])
      .sort();
  await workspace.introduce(`${root}profile/agent#me`);
  expect(await triples()).toEqual([
    [
      url,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      "https://jeswr.org/ns/agent#ImplementationDescription",
    ],
    [url, "https://jeswr.org/ns/agent#describes", `${root}profile/agent#me`],
  ]);
  await workspace.introduce("https://agent.example/card#agent");
  expect(await triples()).toEqual([
    [
      url,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      "https://jeswr.org/ns/agent#ImplementationDescription",
    ],
    [url, "https://jeswr.org/ns/agent#describes", "https://agent.example/card#agent"],
  ]);
  const writes = pod.requests.filter((r) => r.method === "PUT").length;
  for (const unsafe of [
    "urn:agent:me",
    "https://user:secret@agent.example/#me",
    "https://agent.example/?q#me",
  ])
    await expect(workspace.introduce(unsafe)).rejects.toThrow("Unsafe");
  expect(pod.requests.filter((r) => r.method === "PUT")).toHaveLength(writes);
});
