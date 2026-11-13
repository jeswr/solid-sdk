// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { probeValues } from "../src/profile.js";
import { candidateFromScriptCall } from "../src/templates.js";
import type { EndpointCandidate } from "../src/types.js";

function candidate(urlPattern: string): EndpointCandidate {
  return candidateFromScriptCall({
    scriptUrl: "https://shop.test/app.js",
    method: "GET",
    urlPattern,
    headers: {},
    csrf: [],
    bodyKeys: [],
    via: "wrapper:api",
    line: 1,
  }) as EndpointCandidate;
}

it("uses the crawl word only for search parameters, never as a guessed delivery option", () => {
  const search = candidate("https://shop.test/api/search?q={q}&page={page}");
  const checkout = candidate("https://shop.test/api/checkout?delivery={delivery}");
  expect(probeValues(search, "canvas", new Set())).toEqual({ q: "canvas", page: "1" });
  expect(probeValues(checkout, "canvas", new Set())).toBeUndefined();
  const delivery = checkout.params[0];
  if (!delivery) throw new Error("missing delivery parameter");
  delivery.required = false;
  expect(probeValues(checkout, "canvas", new Set())).toEqual({});
  delivery.examples = ["standard"];
  expect(probeValues(checkout, "canvas", new Set())).toEqual({ delivery: "standard" });
});
