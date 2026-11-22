// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { loadCase } from "../src/engine/load.js";
import { runScenario } from "../src/engine/run.js";
import { testKey } from "../src/reference/keys.js";
import { SolidInboxHost } from "../src/standins/solid-inbox.js";
import { FictionalSolidStorage } from "../src/standins/storage.js";

it("carries opaque JSON-LD bytes with POST, receiver listing, GET and WAC identities", async () => {
  const [provider, sender, receiver] = await Promise.all([
    testKey("inbox-provider"),
    testKey("inbox-sender"),
    testKey("inbox-receiver"),
  ]);
  const storage = new FictionalSolidStorage(
    "https://fictional-inbox.example",
    "https://fictional-inbox.example/#provider",
    provider,
    () => "2026-11-14T00:00:00Z",
  );
  const host = new SolidInboxHost(
    storage,
    new Map([
      ["sender", { actor: "https://sender.example/#agent", key: sender }],
      ["receiver", { actor: "https://receiver.example/#agent", key: receiver }],
    ]),
  );
  await host.setup();
  const message = {
    bytes: new TextEncoder().encode('{"@context":"a pinned offline context","proof":"opaque"}\n'),
    mediaType: "application/ld+json",
  };
  expect(await host.carry(message, "sender", "receiver")).toEqual(message);
  expect(storage.accessLog.map((row) => [row.method, row.actor, row.status])).toEqual([
    ["GET", undefined, 200],
    ["POST", "https://sender.example/#agent", 201],
    ["GET", "https://receiver.example/#agent", 200],
    ["GET", "https://receiver.example/#agent", 200],
  ]);
  expect(
    (
      await storage.client(
        "https://sender.example/#agent",
        sender,
      )(`${storage.origin}/receiver/inbox/item-1`)
    ).status,
  ).toBe(403);
});
it("the real mortgage refuses an inbox signature changed by its storage operator", async () => {
  const { profile, scenario } = loadCase(new URL("..", import.meta.url).pathname, "mortgage-main");
  const paths = await runScenario(profile, scenario, { configuration: "transport-solid-inbox" });
  const main = paths.find((path) => path.path === "main"),
    branch = paths.find((path) => path.path === "inbox-item-changed-at-rest");
  expect(main?.blocked).toBeUndefined();
  expect(branch?.trace).toBeDefined();
  expect(branch?.disagrees).not.toBe(true);
  expect(
    branch?.trace?.events.some(
      (event) =>
        event.check === "integrity" && event.verdict === "fail" && event.reason === "bad-signature",
    ),
  ).toBe(true);
  expect(branch?.trace?.events.findLast((event) => event.kind === "decision")?.outcome).toBe(
    "refuse",
  );
  expect(
    branch?.trace?.events.some(
      (event) => event.kind === "message-in" && event.packet?.carriage.suite === "solid-inbox",
    ),
  ).toBe(true);
  for (const event of main?.trace?.events ?? []) {
    expect(event.caption).not.toMatch(/https?:\/\/|urn:/);
    if (event.chat) expect(event.chat.text).not.toMatch(/https?:\/\/|urn:/);
  }
}, 60000);
