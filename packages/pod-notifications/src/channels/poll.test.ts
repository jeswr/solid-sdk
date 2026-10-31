// AUTHORED-BY Codex GPT-6.1-Sol
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { expect, test } from "vitest";
import { FakeTimers } from "../testing.js";
import { createPollChannel } from "./poll.js";

test("direct polling channel handles an already-aborted signal without scheduling work", () => {
  const storage = createMemoryStorage();
  const timers = new FakeTimers();
  const abort = new AbortController();
  abort.abort();
  const sub = createPollChannel({
    storage,
    topics: [storage.root],
    intervalMs: 10,
    timers,
    now: timers.now,
    signal: abort.signal,
  });
  expect(sub.state).toBe("closed");
  expect(timers.pending).toBe(0);
});
