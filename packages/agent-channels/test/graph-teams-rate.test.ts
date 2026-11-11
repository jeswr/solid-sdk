// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { graphTeamsRest } from "../src/graph-teams/rest.js";
import { RecordingTokenProvider } from "../src/testing.js";
import { fixtureTransport } from "./fixtures/graph.js";
import { account, at } from "./fixtures/signed.js";
import { base, bounds, page, reader } from "./fixtures/teams.js";

const throttled = (value?: string, status = 429) =>
  new Response(null, { status, headers: value === undefined ? {} : { "retry-after": value } });

it("retries 429/503 using Retry-After seconds and HTTP dates with injected time and only read grants", async () => {
  let clock = at;
  const sleep = vi.fn(async (ms: number) => {
    clock += ms;
  });
  const r = reader(
    [throttled("2"), throttled(new Date(at + 5000).toUTCString(), 503), page(), page()],
    { sleep, now: () => clock },
  );
  expect((await r.binding.ingest.list(account, undefined, bounds)).items).toEqual([]);
  expect(sleep.mock.calls).toEqual([[2000], [3000]]);
  expect(r.requests.slice(0, 3).map((request) => request.url.href)).toEqual(
    Array(3).fill(`${base}/me/chats`),
  );
  expect(r.tokens.calls.every((call) => call.access === "read")).toBe(true);
});

it("caps attempts and total waits even when the injected clock does not advance", async () => {
  const sleep = vi.fn(async () => {});
  const r = reader(
    Array.from({ length: 4 }, () => throttled("0")),
    { sleep, now: () => at },
  );
  await expect(r.binding.ingest.list(account, undefined, bounds)).rejects.toThrow("HTTP 429");
  expect(sleep).toHaveBeenCalledTimes(3);
  expect(r.requests).toHaveLength(4);
  const budget = reader([throttled("20"), throttled("20")], { sleep, now: () => at });
  await expect(budget.binding.ingest.list(account, undefined, bounds)).rejects.toThrow("HTTP 429");
  expect(budget.requests).toHaveLength(2);
});

it("refuses excessive, malformed, missing or expired delays and accounts for time spent in requests", async () => {
  const sleep = vi.fn(async () => {});
  for (const retry of [
    undefined,
    "invalid",
    "31",
    "99999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999999",
    new Date(at - 1000).toUTCString(),
  ]) {
    const r = reader([throttled(retry)], { sleep, now: () => at });
    await expect(r.binding.ingest.list(account, undefined, bounds)).rejects.toThrow("HTTP 429");
    expect(r.requests).toHaveLength(1);
  }
  const now = vi
    .fn()
    .mockReturnValueOnce(at)
    .mockReturnValue(at + 30_000);
  await expect(
    reader([throttled("1")], { sleep, now }).binding.ingest.list(account, undefined, bounds),
  ).rejects.toThrow("HTTP 429");
  expect(sleep).not.toHaveBeenCalled();
});

it("uses the default nonblocking sleep and clock for zero-delay retries", async () => {
  const fake = fixtureTransport([
    new Response("private", { status: 429, headers: { "retry-after": "0" } }),
    page(),
  ]);
  expect(
    (
      await graphTeamsRest(fake.options)(
        `${base}/me/chats`,
        account,
        new RecordingTokenProvider(),
        "read",
      )
    ).ok,
  ).toBe(true);
  expect(typeof graphTeamsRest()).toBe("function");
});
