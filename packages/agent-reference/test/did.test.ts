// AUTHORED-BY Codex GPT-6
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { signCompact } from "../src/mechanisms/jws.js";
import { alternativeWireId, configurationById } from "../src/profile/configurations.js";
import { testKey } from "../src/reference/keys.js";
import { didWebUrl, FictionalDidDirectory } from "../src/standins/did.js";

it("resolves only the fictional web method and refuses changed or expired keys", async () => {
  const key = await testKey("did-actor"),
    owner = await testKey("did-owner");
  let at = "2026-11-13T09:00:00.000Z";
  const directory = new FictionalDidDirectory(
    { identity: "did:web:resolver.example", key: await testKey("did-resolver") },
    { identity: "did:web:register.example", key: await testKey("did-register") },
    [
      {
        actor: "did:web:actor.example:agent",
        party: "did:web:sam.example",
        actorKey: key,
        partyKey: owner,
      },
    ],
    () => at,
    { from: at, until: "2026-12-13T09:00:00.000Z" },
  );
  await directory.setup();
  expect(didWebUrl("did:web:actor.example:agent")).toBe("https://actor.example/agent/did.json");
  expect(didWebUrl("did:web:sam.example")).toBe("https://sam.example/.well-known/did.json");
  expect(() => didWebUrl("did:key:unknown")).toThrow();
  expect(() => didWebUrl("did:web:127.0.0.1")).toThrow();
  expect((await directory.resolveKid(key.kid)).ok).toBe(true);
  const legacy = await signCompact(key, "awp-message+jws", {
    configuration: alternativeWireId("identity-did"),
  });
  expect((await directory.resolve(legacy))?.ok).toBe(true);
  await directory.swap("did:web:actor.example:agent", await testKey("did-attacker"));
  expect(await directory.resolveKid(key.kid)).toEqual({ ok: false, reason: "sender-key-mismatch" });
  expect(await directory.resolve(legacy)).toEqual({ ok: false, reason: "sender-key-mismatch" });
  at = "2027-01-01T00:00:00.000Z";
  expect(await directory.resolveKid(key.kid)).toEqual({ ok: false, reason: "expired" });
  expect(configurationById(alternativeWireId("identity-did"))?.acceptedDidMethods).toEqual(["web"]);
});
it("runs the DID mortgage and refuses a separately signed unlisted method", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const discovery = vi.spyOn(FictionalDidDirectory.prototype, "resolveDeclared");
  const baseline = (await runScenario(profile, { ...scenario, branches: [] }))[0]?.trace;
  const paths = await runScenario(profile, scenario, { configuration: "identity-did" });
  const main = paths.find((p) => p.path === "main"),
    failure = paths.find((p) => p.path === "did-method-not-listed");
  if (!baseline || !main?.trace || !failure?.trace) throw new Error("Missing actual DID run");
  expect(confinementDifferences(baseline, main.trace, "identity")).toEqual([]);
  expect(
    failure.trace.events.some(
      (e) =>
        e.check === "integrity" && e.verdict === "fail" && e.reason === "unsupported-configuration",
    ),
  ).toBe(true);
  const actors = main.trace.events.flatMap((e) => {
    const header = e.packet?.layers.header.raw as { from?: { actor?: string } } | undefined;
    return header?.from?.actor ? [header.from.actor] : [];
  });
  expect(discovery.mock.calls.some(([id]) => id === alternativeWireId("identity-did"))).toBe(true);
  expect(actors.length).toBeGreaterThan(5);
  expect(actors.every((id) => id.startsWith("did:web:"))).toBe(true);
  for (const trace of [main.trace, failure.trace])
    for (const e of trace.events)
      expect(`${e.caption} ${e.rule?.text ?? ""} ${e.chat?.text ?? ""}`).not.toMatch(
        /https?:\/\/|urn:|did:/,
      );
}, 180000);
