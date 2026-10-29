// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { inventorySettings, parseSnapshot } from "../src/index.js";
import { accountDataset, accountTurtle } from "../src/rdf.js";
import { MemoryStorageClient } from "../src/testing.js";

describe("storage fake conditional writes", () => {
  it.each(["create", "replace"])("allows only one concurrent conditional %s", async (operation) => {
    const storage = new MemoryStorageClient();
    const url = "https://pod.example/agent/accounts/fixture.ttl";
    const account = inventorySettings(
      parseSnapshot({ version: 1, accounts: [] }),
      new Uint8Array(32),
    ).connections[0];
    if (!account) throw new Error("Fixture account absent");
    await storage.setAcl(url, {
      owner: "https://owner.example/profile#me",
      public: false,
      modes: ["Read", "Write", "Control"],
    });
    if (operation === "replace")
      await storage.writeRdf(url, accountDataset(account, url), { ifNoneMatch: "*" });
    const initial = await storage.read(url);
    const options = initial ? { ifMatch: initial.etag } : { ifNoneMatch: "*" as const };
    const datasets = ["First writer", "Second writer"].map((organisation) =>
      accountDataset({ ...account, organisation }, url),
    );
    const writesBefore = storage.events.filter((event) => event.operation === "write").length;
    const outcomes = await Promise.allSettled(
      datasets.map((dataset) => storage.writeRdf(url, dataset, options)),
    );
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toEqual([
      { status: "rejected", reason: new Error("Precondition failed") },
    ]);
    const winner = datasets[outcomes.findIndex(({ status }) => status === "fulfilled")];
    if (!winner) throw new Error("Winning write absent");
    const current = await storage.read(url);
    expect(current?.body).toBe(await accountTurtle(winner));
    expect(current?.etag).not.toBe(initial?.etag);
    expect([...(storage.resources.get(url)?.dataset ?? [])]).toEqual([...winner]);
    expect(storage.events.filter((event) => event.operation === "write")).toHaveLength(
      writesBefore + 1,
    );
  });
});
