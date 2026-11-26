// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import {
  buildNanopublications,
  createFactAssertion,
  parseNanopublicationsTolerant,
  serializeNanopublications,
} from "../src/index.js";
import * as rdf from "../src/rdf.js";
import { exampleBuildOptions } from "../src/testing.js";

vi.mock("../src/rdf.js", async (original) => ({
  ...(await original<typeof import("../src/rdf.js")>()),
}));
afterEach(() => vi.restoreAllMocks());

it.each([
  Object.assign(new Error("Fictional private diagnostic"), { name: "" }),
  "Fictional private diagnostic",
])("skips validation failures with empty or non-Error names", async (error) => {
  const options = exampleBuildOptions();
  const value = await buildNanopublications(
    {
      batch_id: "errors",
      worker: { agent_id: "https://example.org/client", agent_label: "Fictional" },
      claims: [
        {
          id: "a",
          epistemic: "SelfReportedExplicit",
          assertion: createFactAssertion(options.owner, {
            template: "email",
            value: "avery@example.org",
          }),
        },
      ],
    },
    options,
  );
  const trig = await serializeNanopublications(value);
  vi.spyOn(rdf, "validateTermSafety").mockImplementationOnce(() => {
    throw error;
  });
  const result = await parseNanopublicationsTolerant(trig);
  expect(result.skipped).toEqual([{ id: value.nanopubs[0]?.id, errorClass: "Error" }]);
  expect(result.nanopubs).toEqual([]);
  expect(result.dataset.size).toBe(0);
  expect(JSON.stringify(result)).not.toContain("Fictional");
});
