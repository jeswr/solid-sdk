// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-message-list> tests: render as:Note fields from a fixture (the shared
// @jeswr/solid-chat-interop typed `parseAs2Message` accessor) — author / content /
// timestamp / inReplyTo — the src→fetch read path, the empty / error states, and
// the content-as-TEXT XSS discipline (a script/markup-bearing message BODY renders
// as inert text, never live markup, and a hostile author IRI never becomes an href).

import "../src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JeswrMessageList } from "../src/index.js";
import { MESSAGES_TTL, mount, parseTurtle, waitFor, XSS_MESSAGE_TTL } from "./fixtures.js";

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

describe("<jeswr-message-list>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("jeswr-message-list")).toBeDefined();
  });

  it("renders every as:Note from a directly-set store, via the typed accessors", async () => {
    const el = await mount<JeswrMessageList>("jeswr-message-list");
    el.store = parseTurtle(MESSAGES_TTL);
    await waitFor(
      el,
      (e) => e.querySelectorAll('[part="message"]').length === 2,
      "two messages render",
    );

    // content (body text) is read through the chat-interop CanonicalMessage accessor.
    const bodies = [...el.querySelectorAll('[part="content"]')].map((n) => n.textContent?.trim());
    expect(bodies).toContain("Hello, world");
    expect(bodies).toContain("Replying to you");

    // author (WebID) is rendered as an http(s) link (the safeHref pattern).
    const authors = [...el.querySelectorAll('a[part="author"]')].map((a) => a.getAttribute("href"));
    expect(authors).toContain("https://alice.example/profile/card#me");
    expect(authors).toContain("https://bob.example/profile/card#me");

    // published timestamp renders (a <time> with a datetime attribute). The
    // chat-interop model normalises `published` to a canonical ISO string
    // (`Date#toISOString` → millisecond-precision, trailing `Z`), so the rendered
    // `datetime` is `2026-06-01T09:00:00.000Z`, not the verbatim fixture literal.
    expect(el.querySelectorAll('[part="time"]').length).toBe(2);
    expect(el.querySelector('[part="time"]')?.getAttribute("datetime")).toBe(
      "2026-06-01T09:00:00.000Z",
    );

    // inReplyTo renders the reply indicator on the second message only.
    expect(el.querySelectorAll('[part="reply"]').length).toBe(1);
  });

  it("reads from `src` through the injected fetch seam", async () => {
    const el = await mount<JeswrMessageList>("jeswr-message-list");
    el.fetch = ttlFetch(MESSAGES_TTL);
    el.src = "https://pod.example/chat/";
    await waitFor(
      el,
      (e) => e.querySelectorAll('[part="message"]').length === 2,
      "messages via fetch",
    );
    expect(el.querySelectorAll('[part="message"]').length).toBe(2);
  });

  it("shows the empty state when the graph holds no messages", async () => {
    const el = await mount<JeswrMessageList>("jeswr-message-list");
    el.store = parseTurtle("@prefix ex: <https://ex.example/> . ex:a ex:b ex:c .");
    await waitFor(el, (e) => !!e.querySelector('[part="empty"]'), "empty state renders");
    expect(el.querySelector('[part="empty"]')?.textContent).toContain("No messages");
  });

  it("classifies a 404 read onto the error state (NotFound message)", async () => {
    const el = await mount<JeswrMessageList>("jeswr-message-list");
    el.fetch = ttlFetch("", 404);
    el.src = "https://pod.example/chat/";
    await waitFor(el, (e) => !!e.querySelector('[part="error"]'), "error state renders");
    expect(el.querySelector('[part="error"]')?.textContent).toContain("not found");
  });

  it("renders an untrusted message body as escaped TEXT — no live markup (stored-XSS guard)", async () => {
    const el = await mount<JeswrMessageList>("jeswr-message-list");
    el.store = parseTurtle(XSS_MESSAGE_TTL);
    await waitFor(el, (e) => !!e.querySelector('[part="content"]'), "hostile message renders");
    const content = el.querySelector('[part="content"]');
    // The body literal must be present as TEXT, escaped — NOT parsed into elements.
    expect(content?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(content?.textContent).toContain("<script>alert(2)</script>");
    // No real <img>/<script> element was created from the body (it stayed text).
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector('[part="content"] script')).toBeNull();
  });

  it("never renders a hostile (non-http(s)) author IRI as a link", async () => {
    const el = await mount<JeswrMessageList>("jeswr-message-list");
    el.store = parseTurtle(XSS_MESSAGE_TTL);
    await waitFor(el, (e) => !!e.querySelector('[part="content"]'), "hostile message renders");
    // parseAs2Message drops the non-http(s) author, so no author element is rendered
    // at all — and certainly no `<a href="javascript:...">`.
    const link = el.querySelector('a[part="author"]');
    expect(link).toBeNull();
    expect(el.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
