// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rewriteManifest } from "../../../scripts/mirror-publish.mjs";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const dist = new URL("../dist/", import.meta.url);

describe("interop mirror artifacts", () => {
  it("publishes without a private suite-vocab mirror SHA", () => {
    const sha = "a".repeat(40);
    const mirror = rewriteManifest(
      manifest,
      new Map([
        ["@jeswr/fetch-rdf", sha],
        ["@jeswr/rdf-serialize", sha],
        ["@jeswr/solid-task-model", sha],
      ]),
    );
    expect(mirror.dependencies).not.toHaveProperty("@jeswr/suite-vocab");
    expect(mirror.dependencies["@jeswr/fetch-rdf"]).toBe(`github:jeswr/fetch-rdf#${sha}`);
    expect(mirror.dependencies["@jeswr/rdf-serialize"]).toBe(`github:jeswr/rdf-serialize#${sha}`);
    expect(mirror.dependencies["@jeswr/solid-task-model"]).toBe(
      `github:jeswr/solid-task-model#${sha}`,
    );
  });

  it("emits JavaScript and declarations with no suite-vocab import", () => {
    const files = readdirSync(dist, { recursive: true });
    for (const extension of [".js", ".d.ts"]) {
      const artifacts = files.filter((name) => name.endsWith(extension));
      expect(artifacts.length).toBeGreaterThan(0);
      for (const name of artifacts) {
        expect(readFileSync(new URL(name, dist), "utf8"), name).not.toContain("@jeswr/suite-vocab");
      }
    }
  });

  it("keeps built entry points and legacy vocabulary conversion working", async () => {
    const { PC, PC_CHAT_ROOM, parseAs2, storeToTurtle } = await import("../dist/index.js");
    const { messageShapeTtl } = await import("../dist/shape.js");
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const { Store } = await import("n3");
    expect(PC).toBe("https://jeswr.org/ns/pod-chat#");
    expect(PC_CHAT_ROOM).toBe(`${PC}ChatRoom`);
    expect(messageShapeTtl()).toBe(
      readFileSync(new URL("../shapes/message.shacl.ttl", import.meta.url), "utf8"),
    );
    const url = "https://alice.example/chat/message.ttl";
    const fixture = `@prefix as: <https://www.w3.org/ns/activitystreams#> .
      @prefix pc: <https://w3id.org/jeswr/pod-chat#> .
      <#it> a as:Note ; as:content "Hello" ; as:context <#room> .
      <#room> a pc:ChatRoom ; pc:participant <https://alice.example/profile#me> .`;
    expect(await parseAs2(url, fixture)).toMatchObject({ content: "Hello", room: `${url}#room` });
    const dataset = new Store([...(await parseRdf(fixture, "text/turtle", { baseIRI: url }))]);
    const output = await storeToTurtle(dataset);
    expect(output).toContain("pc:ChatRoom");
    expect(output).toContain("pc:participant");
    expect(output).not.toContain("w3id.org/jeswr");
  });
});
