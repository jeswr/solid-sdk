// AUTHORED-BY Codex GPT-6.1-Sol
import { recordFromTurtle } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { expect, it, vi } from "vitest";
import { PodWorkspace } from "../src/workspace.js";

const root = "https://pod.example/owner/";
const ownerWebId = `${root}profile#me`;
const privateTypeIndex = `${root}settings/privateTypeIndex.ttl`;

it("uses the injected storage for private provisioning, conditional registration and proposal replay", async () => {
  const storage = createMemoryStorage({ protocol: "solid", root });
  await storage.create(root, null, { name: "settings", kind: "container" });
  const io = vi.fn(async () => {
    throw new Error("Workspace bypassed StorageClient");
  });
  const workspace = new PodWorkspace({ io, storage, root, ownerWebId, privateTypeIndex });
  await workspace.initialize();
  const current = await storage.read(privateTypeIndex);
  expect(await current.text()).toContain("AgentWorkspace");
  await workspace.initialize();
  expect((await storage.head(privateTypeIndex)).etag).toBe(current.etag);
  const original = exampleRecords["action-proposal"];
  const proposal = { ...original, id: workspace.proposalLocation(original.id) };
  await workspace.proposal(proposal);
  await workspace.proposal(proposal);
  expect(
    await recordFromTurtle(await (await storage.read(proposal.id)).text(), proposal.id),
  ).toEqual(proposal);
  await expect(workspace.proposal({ ...proposal, renderedPreview: "Changed" })).rejects.toThrow(
    "Proposal conflict",
  );
  await workspace.heartbeat(new Date("2026-11-01T12:00:00Z"));
  expect(await (await storage.read(workspace.url("control/heartbeat.ttl"))).text()).toContain(
    "2026-11-01T12:00:00.000Z",
  );
  expect(io).not.toHaveBeenCalled();
});

it("stops before descendant content when the owner ACL cannot be written", async () => {
  const storage = createMemoryStorage({ protocol: "solid", root });
  const create = vi.spyOn(storage, "create");
  vi.spyOn(storage, "write").mockRejectedValue(
    new StorageError("forbidden", {
      method: "PUT",
      url: `${root}agent/.acl`,
      status: 403,
    }),
  );
  const workspace = new PodWorkspace({ io: vi.fn(), storage, root, ownerWebId, privateTypeIndex });
  await expect(workspace.initialize()).rejects.toThrow("Pod write failed");
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]?.[2]).toMatchObject({ name: "agent", kind: "container" });
});

it("retains the redirect refusal message from storage errors", async () => {
  const storage = createMemoryStorage({ protocol: "solid", root });
  vi.spyOn(storage, "head").mockRejectedValue(
    new StorageError("invalid-response", {
      method: "HEAD",
      url: `${root}agent/`,
      status: 302,
    }),
  );
  const workspace = new PodWorkspace({ io: vi.fn(), storage, root, ownerWebId, privateTypeIndex });
  await expect(workspace.initialize()).rejects.toThrow("Pod redirect refused");
});

it.each([
  1024 * 1024,
  1024 * 1024 + 1,
])("preserves the streamed document bound at %i bytes", async (size) => {
  const storage = createMemoryStorage({ protocol: "solid", root });
  await storage.write(privateTypeIndex, " ".repeat(size), {
    contentType: "text/turtle",
    ifMatch: "*",
  });
  const workspace = new PodWorkspace({ io: vi.fn(), storage, root, ownerWebId, privateTypeIndex });
  if (size === 1024 * 1024) await workspace.initialize();
  else await expect(workspace.initialize()).rejects.toThrow("Pod document exceeds bound");
});

it("re-reads after a named-create race and bounds stale index edits to three attempts", async () => {
  const storage = createMemoryStorage({ protocol: "solid", root });
  const create = storage.create;
  let raced = false;
  vi.spyOn(storage, "create").mockImplementation(async (parent, body, options) => {
    if (options?.name === "privateTypeIndex.ttl" && !raced) {
      raced = true;
      await storage.write(privateTypeIndex, "", { contentType: "text/turtle", ifMatch: "*" });
    }
    return create(parent, body, options);
  });
  const workspace = new PodWorkspace({ io: vi.fn(), storage, root, ownerWebId, privateTypeIndex });
  await workspace.initialize();
  expect(raced).toBe(true);
  expect(await (await storage.read(privateTypeIndex)).text()).toContain("AgentWorkspace");

  await storage.write(privateTypeIndex, "", { contentType: "text/turtle", ifMatch: "*" });
  const write = storage.write;
  const attempts: string[] = [];
  vi.spyOn(storage, "write").mockImplementation(async (url, body, options) => {
    if (url === privateTypeIndex) {
      attempts.push(options.ifMatch);
      // A concurrent edit makes the observed validator stale on each attempt.
      await write(url, "", { contentType: "text/turtle", ifMatch: "*" });
    }
    return write(url, body, options);
  });
  await expect(workspace.initialize()).rejects.toThrow("Type index conflict limit");
  expect(attempts).toHaveLength(3);
  expect(new Set(attempts).size).toBe(3);
});
