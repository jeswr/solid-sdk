// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";

it("keeps the mailbox cell explicitly not run until control proof and confinement are resolved", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  expect(configurationById(alternativeWireId("identity-email-endpoint"))?.status).toBe(
    "unresolved",
  );
  const paths = await runScenario(profile, scenario, { configuration: "identity-email-endpoint" });
  expect(paths.map((p) => p.path)).toEqual(["main", "mailbox-reply-as-evidence"]);
  for (const p of paths) {
    expect(p.trace).toBeUndefined();
    expect(p.blocked).toContain("mailbox challenge");
    expect(p.blocked).toContain("Brief 31 section 2.4");
  }
});
