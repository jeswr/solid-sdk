// AUTHORED-BY Claude Opus 5.5
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureHar } from "../src/har.js";
import { mapResponse } from "../src/response.js";
import { writeJson } from "../src/run.js";
import { trace } from "./helpers.js";
import { checkReference } from "./reference-check.js";

it("loads generated fixture submissions through the actual Python FinalAgentResponse and NetworkTrace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "webarena-python-contract-"));
  try {
    for (const [index, type] of (["RETRIEVE", "MUTATE", "NAVIGATE"] as const).entries()) {
      const out = join(directory, String(index));
      await mkdir(out);
      const har = captureHar(
        async () =>
          new Response('{"ok":true}', {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": "mage-messages=Added%20item; Path=/",
            },
          }),
      );
      await har.transport("https://shop.test/item/1", { headers: { Accept: "text/html" } });
      await writeJson(join(out, "network.har"), har.har());
      await writeJson(
        join(out, "agent_response.json"),
        mapResponse(type, trace(type === "RETRIEVE" ? '[{"name":"Example","count":1}]' : "Done")),
      );
    }
    expect((await checkReference(directory)).validated_submissions).toBe(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
