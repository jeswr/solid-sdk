// AUTHORED-BY Codex GPT-6
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import { RdfNode, serialize } from "../../src/engine/rdf.js";
import { targetAccessLinks } from "../../src/engine/target-access.js";
import { pods } from "./helpers.js";

it("refuses non-child target inventory entries and keeps external profiles outside the credential fence", async () => {
  const { target } = await pods();
  const dataset = new Store();
  new RdfNode(target.root, dataset, DataFactory).add(
    "http://www.w3.org/ns/ldp#contains",
    `${target.root}nested/non-child`,
  );
  const body = await serialize(dataset);
  target.responses.set(
    `GET ${target.root}`,
    () => new Response(body, { headers: { "content-type": "text/turtle" } }),
  );
  const side = { ...target.side(), ownerWebId: "https://external.example/card#me" };
  await expect(targetAccessLinks(side)).rejects.toThrow("non-child");
  expect(target.requests.every((request) => request.url.startsWith(target.root))).toBe(true);
});

it("bounds target enumeration before inspecting more than 10000 resources", async () => {
  const { target } = await pods();
  const dataset = new Store();
  // Build small typed graphs, then combine them, avoiding quadratic set reads.
  for (let index = 0; index < 10001; index++) {
    const one = new Store();
    new RdfNode(target.root, one, DataFactory).add(
      "http://www.w3.org/ns/ldp#contains",
      `${target.root}file-${index}`,
    );
    for (const quad of one) dataset.add(quad);
  }
  const body = await serialize(dataset);
  target.responses.set(
    `GET ${target.root}`,
    () => new Response(body, { headers: { "content-type": "text/turtle" } }),
  );
  await expect(targetAccessLinks(target.side())).rejects.toThrow("10000");
  expect(target.requests.filter((request) => request.method === "HEAD")).toHaveLength(10000);
}, 15000);
