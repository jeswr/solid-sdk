// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-task-list> tests: render wf:Task fields from a fixture (typed accessors),
// the src→fetch read path, the empty / error states, and the XSS-escaping discipline
// (an untrusted title renders as TEXT, never live markup).

import "../src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JeswrTaskList } from "../src/index.js";
import { mount, parseTurtle, TASKS_TTL, waitFor, XSS_TASK_TTL } from "./fixtures.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** A fetch stub returning a Turtle body for any URL. */
function ttlFetch(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "Content-Type": "text/turtle" },
    })) as unknown as typeof fetch;
}

describe("<jeswr-task-list>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("jeswr-task-list")).toBeDefined();
  });

  it("renders every wf:Task from a directly-set store, via the typed accessors", async () => {
    const el = await mount<JeswrTaskList>("jeswr-task-list");
    el.store = parseTurtle(TASKS_TTL);
    await waitFor(el, (e) => e.querySelectorAll('[part="task"]').length === 2, "two tasks render");

    const titles = [...el.querySelectorAll('[part="title"]')].map((n) => n.textContent?.trim());
    expect(titles).toContain("Write the spec");
    expect(titles).toContain("Ship it");

    // open/closed state read from rdf:type wf:Open / wf:Closed.
    const states = [...el.querySelectorAll('[part="state"]')].map((n) => n.textContent?.trim());
    expect(states).toContain("open");
    expect(states).toContain("closed");

    // metadata (assignee / priority / due) is read through the Task wrapper.
    expect(el.textContent).toContain("high");
    expect(el.textContent).toContain("https://alice.example/profile/card#me");
  });

  it("reads from `src` through the injected fetch seam", async () => {
    const el = await mount<JeswrTaskList>("jeswr-task-list");
    el.fetch = ttlFetch(TASKS_TTL);
    el.src = "https://pod.example/tasks/";
    await waitFor(el, (e) => e.querySelectorAll('[part="task"]').length === 2, "tasks via fetch");
    expect(el.querySelectorAll('[part="task"]').length).toBe(2);
  });

  it("shows the empty state when the graph holds no tasks", async () => {
    const el = await mount<JeswrTaskList>("jeswr-task-list");
    el.store = parseTurtle("@prefix ex: <https://ex.example/> . ex:a ex:b ex:c .");
    await waitFor(el, (e) => !!e.querySelector('[part="empty"]'), "empty state renders");
    expect(el.querySelector('[part="empty"]')?.textContent).toContain("No tasks");
  });

  it("classifies a 404 read onto the error state (NotFound message)", async () => {
    const el = await mount<JeswrTaskList>("jeswr-task-list");
    el.fetch = ttlFetch("", 404);
    el.src = "https://pod.example/tasks/";
    await waitFor(el, (e) => !!e.querySelector('[part="error"]'), "error state renders");
    expect(el.querySelector('[part="error"]')?.textContent).toContain("not found");
  });

  it("renders an untrusted title as escaped TEXT (no live markup — XSS guard)", async () => {
    const el = await mount<JeswrTaskList>("jeswr-task-list");
    el.store = parseTurtle(XSS_TASK_TTL);
    await waitFor(el, (e) => !!e.querySelector('[part="title"]'), "hostile task renders");
    const title = el.querySelector('[part="title"]');
    // The literal must be present as TEXT, and must NOT have created a real <img>.
    expect(title?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(el.querySelector("img")).toBeNull();
  });
});
