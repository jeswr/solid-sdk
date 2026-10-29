// AUTHORED-BY Codex GPT-6.1-Sol
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// The root package has no jsonld dependency; inspect the local contexts directly.
it("every static app client-id document uses canonical vocabulary and ACL mode IRIs", () => {
  const apps = fileURLToPath(new URL("../apps/", import.meta.url));
  const documents = readdirSync(apps)
    .map((app) => join(apps, app, "public/clientid.jsonld"))
    .filter(existsSync);
  expect(documents.length).toBeGreaterThan(0);
  for (const path of documents) {
    const document = JSON.parse(readFileSync(path, "utf8"));
    expect(JSON.stringify(document), path).not.toContain("w3id.org/jeswr");
    const contexts = Array.isArray(document["@context"])
      ? document["@context"]
      : [document["@context"]];
    const context = Object.assign(
      {},
      ...contexts.filter((entry) => typeof entry === "object" && entry),
    );
    if (context.fedapp) expect(context.fedapp, path).toBe("https://jeswr.org/ns/fed#");
    const accessKeys = Object.keys(document).filter(
      (key) => key === "fedapp:access" || context[key]?.["@id"] === "fedapp:access",
    );
    for (const key of accessKeys) {
      expect(context["fedapp:access"]?.["@type"], path).toBe("@id");
      expect(context[key]?.["@type"], path).toBe("@id");
      expect(context.acl, path).toBe("http://www.w3.org/ns/auth/acl#");
      const values = Array.isArray(document[key]) ? document[key] : [document[key]];
      for (const value of values) {
        expect(typeof value, path).toBe("string");
        expect(value, path).toMatch(/^acl:/);
      }
    }
  }
});
