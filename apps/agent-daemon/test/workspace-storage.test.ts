// AUTHORED-BY Codex GPT-6.1-Sol
import { digestOf, recordFromTurtle } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { expect, it, vi } from "vitest";
import { createMemoryPod } from "../src/testing.js";
import { PodWorkspace } from "../src/workspace.js";

const root = "https://pod.example/owner/";
const ownerWebId = `${root}profile#me`;
const privateTypeIndex = `${root}settings/privateTypeIndex.ttl`;

it("uses the injected storage for private provisioning, conditional registration and proposal replay", async () => {
  const storage = createMemoryPod(root).storage;
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
  const inbox = await workspace.inbox("email", "fixture");
  expect((await storage.head(inbox)).kind).toBe("container");
  const source = workspace.messageUrl(inbox, "fixture-message");
  const triage = { primary: "personal", urgency: "normal", confidence: 0.9 };
  expect(await workspace.triage(source, triage)).toEqual(triage);
  expect(await (await storage.read(source.replace(/\.ttl$/, ".triage.ttl"))).text()).toContain(
    "TriageAssessment",
  );
  await workspace.introduce(`${root}profile/agent#me`);
  expect(await (await storage.read(workspace.url("descriptors/agent.ttl"))).text()).toContain(
    `${root}profile/agent#me`,
  );
  expect(io).not.toHaveBeenCalled();
});

it("refuses LWS workspaces at construction before any storage or transport call", () => {
  const storage = createMemoryStorage({ protocol: "lws", root });
  const calls = ["head", "read", "write", "create"] as const;
  const spies = calls.map((method) => vi.spyOn(storage, method));
  const io = vi.fn();
  expect(() => new PodWorkspace({ io, storage, root, ownerWebId, privateTypeIndex })).toThrow(
    "Solid",
  );
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  expect(io).not.toHaveBeenCalled();
});

it("the memory fetch adapter distinguishes a taken name (412) from a kind collision (409)", async () => {
  const pod = createMemoryPod(root);
  const url = `${root}note.txt`;
  const create = (target: string, body: string) =>
    pod.io(target, {
      method: "PUT",
      headers: { "if-none-match": "*", "content-type": "text/plain" },
      body,
    });
  expect((await create(url, "original")).status).toBe(201);
  expect((await create(url, "replacement")).status).toBe(412);
  expect((await create(`${url}/`, "")).status).toBe(409);
  expect(await (await pod.storage.read(url)).text()).toBe("original");
});

it.each([
  "x:y.ttl",
  "x%3ay.ttl",
  "snow☃.ttl",
  "nested/proposal.ttl",
])("refuses proposal URL %s before creating a stray resource", async (name) => {
  const storage = createMemoryPod(root).storage;
  const workspace = new PodWorkspace({ io: vi.fn(), storage, root, ownerWebId, privateTypeIndex });
  await workspace.initialize();
  const create = vi.spyOn(storage, "create");
  const id = `${workspace.url("proposals/")}${name}`;
  expect(workspace.proposalLocation(id)).toBe(
    workspace.url(`proposals/${digestOf(id).slice(8)}.ttl`),
  );
  const proposal = { ...exampleRecords["action-proposal"], id };
  await expect(workspace.proposal(proposal)).rejects.toThrow(
    "Proposal outside proposals container",
  );
  expect(create).not.toHaveBeenCalled();
  expect((await storage.list(workspace.url("proposals/"))).items).toEqual([]);
});

it("creates and replays an exactly encoded proposal URL", async () => {
  const storage = createMemoryPod(root).storage;
  const workspace = new PodWorkspace({ io: vi.fn(), storage, root, ownerWebId, privateTypeIndex });
  await workspace.initialize();
  const id = workspace.url("proposals/x%3Ay.ttl");
  const proposal = { ...exampleRecords["action-proposal"], id };
  await workspace.proposal(proposal);
  await workspace.proposal(proposal);
  expect(await recordFromTurtle(await (await storage.read(id)).text(), id)).toEqual(proposal);
});

it.each([
  "x:y.ttl",
  "x%3ay.ttl",
])("the memory fetch adapter refuses exact URL mismatch %s before creation", async (name) => {
  const pod = createMemoryPod(root);
  await expect(
    pod.io(`${root}${name}`, {
      method: "PUT",
      headers: { "if-none-match": "*", "content-type": "text/plain" },
      body: "draft",
    }),
  ).rejects.toMatchObject({ code: "bad-request" });
  expect(pod.requests).toEqual([]);
  expect(pod.resources.size).toBe(0);
});

it.each([
  409, 412,
])("re-HEADs after container creation HTTP %i and fails while the container is missing", async (status) => {
  const storage = createMemoryPod(root).storage;
  const head = vi.spyOn(storage, "head");
  vi.spyOn(storage, "create").mockRejectedValue(
    new StorageError("conflict", {
      method: "PUT",
      url: `${root}agent/`,
      status,
    }),
  );
  const write = vi.spyOn(storage, "write");
  const workspace = new PodWorkspace({ io: vi.fn(), storage, root, ownerWebId, privateTypeIndex });
  await expect(workspace.initialize()).rejects.toThrow("Container creation failed");
  expect(head).toHaveBeenCalledTimes(2);
  expect(head).toHaveBeenLastCalledWith(`${root}agent/`);
  expect(write).not.toHaveBeenCalled();
});

it.each([
  409, 412,
])("accepts container creation HTTP %i only after re-HEAD confirms the concurrent creation", async (status) => {
  const storage = createMemoryPod(root).storage;
  const head = vi.spyOn(storage, "head");
  const create = storage.create;
  vi.spyOn(storage, "create").mockImplementation(async (parent, body, options) => {
    const result = await create(parent, body, options);
    if (options?.name === "agent")
      throw new StorageError("conflict", {
        method: "PUT",
        url: result.url,
        status,
      });
    return result;
  });
  const workspace = new PodWorkspace({ io: vi.fn(), storage, root, ownerWebId, privateTypeIndex });
  await workspace.initialize();
  expect(head.mock.calls.filter(([url]) => url === `${root}agent/`)).toHaveLength(2);
});

it.each([
  false,
  true,
])("does not replay a proposal after HTTP 409 (existing=%s)", async (existing) => {
  const storage = createMemoryPod(root).storage;
  const workspace = new PodWorkspace({ io: vi.fn(), storage, root, ownerWebId, privateTypeIndex });
  await workspace.initialize();
  const proposal = {
    ...exampleRecords["action-proposal"],
    id: workspace.url("proposals/fixture.ttl"),
  };
  if (existing) await workspace.proposal(proposal);
  const read = vi.spyOn(storage, "read");
  vi.spyOn(storage, "create").mockRejectedValue(
    new StorageError("conflict", {
      method: "PUT",
      url: proposal.id,
      status: 409,
    }),
  );
  await expect(workspace.proposal(proposal)).rejects.toThrow("Proposal write failed");
  expect(read).not.toHaveBeenCalled();
});

it.each([false, true])("does not retry type index HTTP 409 (existing=%s)", async (existing) => {
  const storage = createMemoryPod(root).storage;
  if (existing)
    await storage.write(privateTypeIndex, "", { contentType: "text/turtle", ifMatch: "*" });
  const failure = new StorageError("conflict", {
    method: "PUT",
    url: privateTypeIndex,
    status: 409,
  });
  const attempts: string[] = [];
  const create = storage.create;
  vi.spyOn(storage, "create").mockImplementation(async (parent, body, options) => {
    if (options?.name === "privateTypeIndex.ttl") {
      attempts.push("create");
      throw failure;
    }
    return create(parent, body, options);
  });
  const write = storage.write;
  vi.spyOn(storage, "write").mockImplementation(async (url, body, options) => {
    if (url === privateTypeIndex) {
      attempts.push("write");
      throw failure;
    }
    return write(url, body, options);
  });
  const read = vi.spyOn(storage, "read");
  const workspace = new PodWorkspace({ io: vi.fn(), storage, root, ownerWebId, privateTypeIndex });
  await expect(workspace.initialize()).rejects.toThrow("Type index registration failed");
  expect(read.mock.calls.filter(([url]) => url === privateTypeIndex)).toHaveLength(1);
  expect(attempts).toEqual([existing ? "write" : "create"]);
});

it("stops before descendant content when the owner ACL cannot be written", async () => {
  const storage = createMemoryPod(root).storage;
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
  const storage = createMemoryPod(root).storage;
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
  const storage = createMemoryPod(root).storage;
  await storage.write(privateTypeIndex, " ".repeat(size), {
    contentType: "text/turtle",
    ifMatch: "*",
  });
  const workspace = new PodWorkspace({ io: vi.fn(), storage, root, ownerWebId, privateTypeIndex });
  if (size === 1024 * 1024) await workspace.initialize();
  else await expect(workspace.initialize()).rejects.toThrow("Pod document exceeds bound");
});

it("re-reads after a named-create race and bounds stale index edits to three attempts", async () => {
  const storage = createMemoryPod(root).storage;
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
