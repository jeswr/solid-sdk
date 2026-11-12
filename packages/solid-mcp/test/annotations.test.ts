// AUTHORED-BY Claude Opus 5.5
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createContextToolRegistry } from "../src/context-tools.js";
import { createSolidMcpServer } from "../src/server.js";
import { createPodToolRegistry } from "../src/tools.js";
import { makeFakePod } from "./fake-pod.js";
import { createWacMemoryPodPort } from "./wac-memory-pod.js";

const POD = "https://example.org/pod/";
const WEB_ID = "https://example.org/profile/card#me";
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

const READ = { readOnlyHint: true, openWorldHint: true };
const AUDITED = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};
/** The advertised contract for every tool (sst-69sz). Adding a tool must extend this table. */
const EXPECTED: Record<string, object> = {
  search: READ,
  fetch: READ,
  pod_list: READ,
  solid_list: READ,
  pod_read: READ,
  solid_read: READ,
  solid_search: READ,
  pod_write: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  solid_write: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  memory_remember: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  memory_recall: AUDITED,
  memory_forget: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  profile_get: READ,
  address_get: AUDITED,
  health_query: AUDITED,
  context_read: READ,
  chat_save: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  chat_list: READ,
  chat_get: READ,
  chat_export: READ,
};

async function listTools() {
  const pod = makeFakePod({});
  const server = createSolidMcpServer({
    podRoot: POD,
    webId: WEB_ID,
    fetch: pod.fetch,
    readOnly: false,
    clientInfo: { clientId: "https://example.org/clients/one", model: "fixture" },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fixture", version: "1" });
  clients.push(client);
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return (await client.listTools()).tools;
}

describe("tool annotations", () => {
  it("advertises exact behaviour hints for every registered tool", async () => {
    const tools = await listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const tool of tools)
      expect([tool.name, tool.annotations]).toEqual([tool.name, EXPECTED[tool.name]]);
  });

  it("never advertises a server-gated write or an audited read as read-only", () => {
    const pod = createWacMemoryPodPort({ root: POD, webId: WEB_ID });
    const registry = [
      ...createPodToolRegistry(pod, false, { clientId: "https://example.org/clients/one" }),
      ...createContextToolRegistry(pod),
    ];
    for (const tool of registry) {
      if (!tool.readOnly) expect(tool.annotations.readOnlyHint, tool.name).toBe(false);
      if (tool.annotations.readOnlyHint)
        expect(Object.keys(tool.annotations).sort(), tool.name).toEqual([
          "openWorldHint",
          "readOnlyHint",
        ]);
      else
        expect(Object.keys(tool.annotations).sort(), tool.name).toEqual([
          "destructiveHint",
          "idempotentHint",
          "openWorldHint",
          "readOnlyHint",
        ]);
    }
  });
});
