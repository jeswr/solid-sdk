// AUTHORED-BY Codex GPT-6.1-Sol
import { digestOf, recordFromTurtle } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { expect, it } from "vitest";
import { createMemoryPod } from "../src/testing.js";
import { PodWorkspace } from "../src/workspace.js";

const root = "https://pod.example/owner/";
const ownerWebId = `${root}profile#me`;
const privateTypeIndex = `${root}settings/privateTypeIndex.ttl`;
it("registers a private AgentWorkspace, preserves unrelated RDF, uses ETags, and is idempotent", async () => {
  const pod = createMemoryPod();
  pod.resources.set(privateTypeIndex, {
    body: '<urn:fixture:unrelated> <urn:predicate> "preserve" .',
    type: "text/turtle",
    etag: '"initial"',
  });
  const workspace = new PodWorkspace({ io: pod.io, root, ownerWebId, privateTypeIndex });
  await workspace.initialize();
  const index = pod.resources.get(privateTypeIndex)?.body;
  expect(index).toContain("preserve");
  expect(index).toContain("https://jeswr.org/ns/agent#AgentWorkspace");
  expect(index).toContain(`${root}agent/`);
  expect(
    pod.requests
      .find((r) => r.url === privateTypeIndex && r.method === "PUT")
      ?.headers.get("if-match"),
  ).toBe('"initial"');
  await workspace.initialize();
  expect(pod.requests.filter((r) => r.url === privateTypeIndex && r.method === "PUT")).toHaveLength(
    1,
  );
});
it("does not create or replace an unreadable or unvalidated index, and bounds conflicts", async () => {
  for (const status of [403, 200, 412]) {
    const pod = createMemoryPod();
    const io: PodWorkspace["io"] = async (input, init) => {
      if (String(input) === privateTypeIndex) {
        if (status === 412 && init?.method !== "PUT")
          return new Response("", {
            headers: { etag: '"fixture"', "content-type": "text/turtle" },
          });
        return new Response(status === 200 ? "" : null, {
          status,
          headers: { "content-type": "text/turtle" },
        });
      }
      return pod.io(input, init);
    };
    const workspace = new PodWorkspace({ io, root, ownerWebId, privateTypeIndex });
    await expect(workspace.initialize()).rejects.toThrow(
      status === 412 ? "conflict limit" : status === 200 ? "validator" : "read failed",
    );
    expect(
      pod.requests.filter((r) => r.url === privateTypeIndex && r.method === "PUT"),
    ).toHaveLength(0);
  }
});
it("refuses foreign, sibling-prefix, credentialed, query and redirect destinations before writing content", async () => {
  const pod = createMemoryPod();
  for (const index of [
    "https://foreign.example/index",
    "https://pod.example/owner-evil/index",
    `${privateTypeIndex}?secret=fixture`,
    "https://user:fixture@pod.example/owner/index",
  ]) {
    expect(
      () => new PodWorkspace({ io: pod.io, root, ownerWebId, privateTypeIndex: index }),
    ).toThrow();
  }
  const workspace = new PodWorkspace({
    io: async () => new Response(null, { status: 302 }),
    root,
    ownerWebId,
    privateTypeIndex,
  });
  await expect(workspace.initialize()).rejects.toThrow("redirect");
  await expect(workspace.io("https://foreign.example/")).rejects.toThrow("outside");
  expect(pod.requests).toHaveLength(0);
  expect(workspace.within("https://pod.example/owner/agent-evil/approvals/1")).toBe(false);
});
it("stamps local proposal destinations, refuses conflicting rewrites and serializes heartbeat RDF", async () => {
  const pod = createMemoryPod();
  const workspace = new PodWorkspace({ io: pod.io, root, ownerWebId, privateTypeIndex });
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
