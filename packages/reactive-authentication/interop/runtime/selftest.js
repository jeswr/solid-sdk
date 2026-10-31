// Harness self-test of the real-browser Solid adapter's cancellation and ownership (no server, no network):
// an in-page operation that reports a created URL and then never settles is aborted; the page must be closed
// before the step settles, ownership must survive, and the next step must run on a fresh page.
//   npm run build && node interop/runtime/selftest.js [--browser chromium|firefox|webkit]
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import * as playwright from "playwright";
import { closeServer, pages, serve } from "../adapters/solidBrowser.js";

const {
  values: { browser: engine },
} = parseArgs({ options: { browser: { type: "string", default: "chromium" } } });
const port = 39395;
const server = await serve(port);
const browser = await playwright[engine].launch();
try {
  const context = await browser.newContext();
  const owned = new Set();
  const query = new URLSearchParams({
    storage: "http://localhost:1/s/",
    webId: "http://localhost:1/s/card#me",
    scratch: "http://localhost:1/s/",
    run: "selftest",
    insecure: "true",
  });
  const harness = pages({
    context,
    url: `http://localhost:${port}/solid.html?${query}`,
    login: () => async () => {},
    owned,
  });

  // Aborted while the page is still opening: settles at once, and leaves no page behind.
  const early = new AbortController();
  const before = context.pages().length;
  const opening = harness.step(early.signal, "fresh");
  early.abort(new Error("scenario timed out"));
  await assert.rejects(opening, /scenario timed out/);
  assert.equal(context.pages().length, before, "a page aborted while opening is closed");

  // Aborted while an in-page operation is pending (after it reported a creation).
  const controller = new AbortController();
  // The abort is synchronized with the fixture's ownership notification (not with startup speed), and bounded:
  // if ownership is never reported, the abort reason differs and the assertion below fails.
  const watch = setInterval(() => {
    if (owned.size > 0) controller.abort(new Error("scenario timed out"));
  }, 20);
  const bound = setTimeout(
    () => controller.abort(new Error("the fixture never reported ownership within 60 s")),
    60_000,
  );
  await assert.rejects(
    harness.step(controller.signal, "own-then-hang", "http://localhost:1/s/owned/"),
    /scenario timed out/,
  );
  clearInterval(watch);
  clearTimeout(bound);
  assert.equal(
    context.pages().length,
    before,
    "the aborted step's page was closed before the step settled",
  );
  assert.deepEqual(
    [...owned],
    ["http://localhost:1/s/owned/"],
    "ownership reported before the abort survives the closed page",
  );

  const next = await harness.step(new AbortController().signal, "fresh");
  assert.equal(
    next.mutations,
    0,
    "the next step runs on a fresh page: nothing from the aborted operation carries over",
  );
  const finished = new AbortController();
  await harness.step(finished.signal, "fresh");
  finished.abort(new Error("scenario finished")); // the runner's normal post-scenario abort
  assert.equal(
    (await harness.step(new AbortController().signal, "fresh")).mutations,
    0,
    "a completed step's page survives the post-scenario abort",
  );
  assert.equal(context.pages().length, before + 1, "the same page was reused");
  await harness.discard();
  console.log(`Solid browser adapter self-test (${engine}): OK`);
} finally {
  await browser.close();
  await closeServer(server);
}
