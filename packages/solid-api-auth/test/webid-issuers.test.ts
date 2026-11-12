// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test, vi } from "vitest";
import { readWebIdIssuers } from "../src/webid-issuers.js";

const webid = "https://person.example/profile#me";
const issuer = "https://issuer.example/tenant";
const predicate = "http://www.w3.org/ns/solid/terms#oidcIssuer";

test("exact WebID and optional document subjects share one RDF parser", async () => {
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json(
      [
        { "@id": webid, [predicate]: { "@id": issuer } },
        { "@id": webid.split("#")[0], [predicate]: { "@id": "https://document.example" } },
        { "@id": "_:blank", [predicate]: { "@id": "https://blank.example" } },
        { "@id": "https://foreign.example", [predicate]: { "@id": issuer } },
        { "@id": webid, [predicate]: "https://literal.example" },
      ],
      { headers: { "content-type": "application/ld+json" } },
    ),
  );
  expect(await readWebIdIssuers(webid, transport)).toEqual([issuer]);
  expect(await readWebIdIssuers(webid, transport, true)).toEqual([
    issuer,
    "https://document.example",
  ]);
  expect(transport).toHaveBeenCalledWith("https://person.example/profile", expect.anything());
});
