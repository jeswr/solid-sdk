// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import { confinementDifferences } from "../src/engine/confinement.js";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { signCompact, verifyCompact } from "../src/mechanisms/jws.js";
import { testKey } from "../src/reference/keys.js";
import { FictionalWebIdDirectory } from "../src/standins/webid.js";
import { decodeJws } from "../src/wire/inspect.js";

async function fixture() {
  const [provider, register, actor, principal] = await Promise.all([
    testKey("webid-provider"),
    testKey("webid-register"),
    testKey("webid-actor"),
    testKey("webid-principal"),
  ]);
  let clock = "2026-11-14T00:00:00.000Z";
  const directory = new FictionalWebIdDirectory(
    { identity: "https://profile-provider.example/#provider", key: provider },
    { identity: "https://register.example/#register", key: register },
    [
      {
        actor: "https://agent.example/profile#agent",
        party: "https://sam.example/#me",
        actorKey: actor,
        partyKey: principal,
      },
    ],
    () => clock,
    { from: clock, until: "2026-12-14T00:00:00.000Z" },
  );
  await directory.setup();
  return {
    directory,
    actor,
    advance: () => {
      clock = "2027-01-01T00:00:00.000Z";
    },
  };
}
it("fetches the actor and principal Multikey documents; the register carries no key material", async () => {
  const { directory, actor } = await fixture();
  const answer = decodeJws(directory.answer(actor.kid) as string).payload;
  expect(answer?.subject).toBe("https://agent.example/profile#agent");
  expect(JSON.stringify(answer)).not.toMatch(/publicJwk|"kty"|"crv"|"x"/);
  const resolved = await directory.resolveKid(actor.kid);
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) throw new Error("Expected real profile resolution");
  expect(resolved.key.publicJwk).toEqual(actor.publicJwk);
  expect(
    directory.accessLog.filter((row) => row.method === "GET" && row.status === 200).length,
  ).toBeGreaterThanOrEqual(2);
  const signed = await signCompact(actor, "test-webid+jws", { message: "signed independently" });
  const checked = await verifyCompact(signed, {
    typ: "test-webid+jws",
    allowedAlgs: ["EdDSA"],
    limits: DEFAULT_LIMITS,
    resolve: (kid) => (kid === resolved.key.kid ? resolved.key : undefined),
  });
  expect(checked.outcome).toBe("valid");
});
it("refuses profile key takeover, unknown names, expired keys and private or foreign fetches", async () => {
  const { directory, actor, advance } = await fixture();
  expect(await directory.resolveKid("not-registered")).toEqual({
    ok: false,
    reason: "unknown-key",
  });
  for (const url of [
    "https://127.0.0.1/",
    "https://169.254.169.254/",
    "https://elsewhere.example/",
  ])
    await expect(directory.fetch(url)).rejects.toThrow();
  await directory.swapProfile(
    "https://agent.example/profile#agent",
    await testKey("webid-attacker"),
  );
  expect(await directory.resolveKid(actor.kid)).toEqual({
    ok: false,
    reason: "sender-key-mismatch",
  });
  advance();
  expect(await directory.resolveKid(actor.kid)).toEqual({ ok: false, reason: "expired" });
});
it("the mortgage verifies profiles and refuses a swapped lender key at integrity", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const baseline = (await runScenario(profile, scenario))[0]?.trace;
  const paths = await runScenario(profile, scenario, { configuration: "identity-webid" });
  const main = paths.find((path) => path.path === "main"),
    failure = paths.find((path) => path.path === "profile-key-swapped");
  if (!baseline || !main?.trace || !failure?.trace)
    throw new Error("The real mortgage paths must run");
  expect(confinementDifferences(baseline, main.trace, "identity")).toEqual([]);
  expect(failure.disagrees).not.toBe(true);
  expect(
    failure.trace.events.some(
      (event) =>
        event.check === "integrity" &&
        event.reason === "sender-key-mismatch" &&
        event.verdict === "fail",
    ),
  ).toBe(true);
  expect(failure.trace.events.findLast((event) => event.kind === "decision")?.outcome).toBe(
    "refuse",
  );
  for (const trace of [main.trace, failure.trace])
    for (const event of trace.events) {
      expect(event.caption).not.toMatch(/https?:\/\/|urn:/);
      if (event.chat) expect(event.chat.text).not.toMatch(/https?:\/\/|urn:/);
    }
}, 120000);
