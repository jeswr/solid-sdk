/**
 * Seed determinism gates: the generated persona is SHACL-valid (generate() runs an
 * independent validator), pins the fixture values, and is byte-stable across runs.
 */
import { expect, test } from "vitest";
import { personaIdentifier, personaName } from "../persona.ts";
import { generateSeedData, layoutFor } from "../seed.config.ts";

test("the persona generates, validates, and pins the fixture values", async () => {
  const result = await generateSeedData();
  expect(result.instances).toHaveLength(1);
  const turtle = result.toTurtle();
  expect(turtle).toContain(personaName);
  expect(turtle).toContain(personaIdentifier);
});

test("same seed, same output (deterministic)", async () => {
  const [first, second] = await Promise.all([generateSeedData(), generateSeedData()]);
  expect(first.toTurtle()).toEqual(second.toTurtle());
});

test("layout paths are pod-root-relative", async () => {
  const layout = layoutFor({
    authFetch: fetch,
    baseUrl: "https://pod.example/",
    webid: "https://pod.example/profile/card#me",
  });
  for (const pod of layout.pods) {
    for (const resource of pod.resources) {
      if (typeof resource === "function") continue;
      expect(resource.path.startsWith("/")).toBe(true);
    }
  }
});
