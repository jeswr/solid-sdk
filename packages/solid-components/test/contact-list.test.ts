// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-contact-list> tests: render vcard:Individual fields (name / org / structured
// email & phone / WebID) via the model's typed accessors, the empty state, and the
// untrusted-input DOM-boundary filtering (a `javascript:` email/webId never becomes a
// link; a hostile name renders as escaped text).

import "../src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JeswrContactList } from "../src/index.js";
import { CONTACTS_TTL, HOSTILE_CONTACT_TTL, mount, parseTurtle, waitFor } from "./fixtures.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("<jeswr-contact-list>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("jeswr-contact-list")).toBeDefined();
  });

  it("renders vcard:Individual contacts via the typed Contact accessor", async () => {
    const el = await mount<JeswrContactList>("jeswr-contact-list");
    el.store = parseTurtle(CONTACTS_TTL);
    await waitFor(
      el,
      (e) => e.querySelectorAll('[part="contact"]').length === 2,
      "two contacts render",
    );

    const names = [...el.querySelectorAll('[part="name"]')].map((n) => n.textContent?.trim());
    expect(names).toContain("Alice Smith");
    expect(names).toContain("Bob Jones");

    // The structured email node is read to a canonical mailto: → a real link.
    const email = el.querySelector('[part="emails"] a') as HTMLAnchorElement | null;
    expect(email?.getAttribute("href")).toBe("mailto:alice@example.com");
    expect(email?.textContent?.trim()).toBe("alice@example.com");

    // The structured tel: + the WebID link.
    const phone = el.querySelector('[part="phones"] a') as HTMLAnchorElement | null;
    expect(phone?.getAttribute("href")).toBe("tel:+15550001");
    const webid = el.querySelector('[part="webid"]') as HTMLAnchorElement | null;
    expect(webid?.getAttribute("href")).toBe("https://alice.example/profile/card#me");

    expect(el.textContent).toContain("ACME Corp");
  });

  it("shows the empty state when there are no contacts", async () => {
    const el = await mount<JeswrContactList>("jeswr-contact-list");
    el.store = parseTurtle("@prefix ex: <https://ex.example/> . ex:a ex:b ex:c .");
    await waitFor(el, (e) => !!e.querySelector('[part="empty"]'), "empty state renders");
    expect(el.querySelector('[part="empty"]')?.textContent).toContain("No contacts");
  });

  it("re-reads via publicFetch (not the authed fetch) when public-read is toggled after load", async () => {
    // Two DISTINCT fetch seams. The authed `fetch` carries credentials (it must NOT
    // be used for a public read); `publicFetch` is credential-free. We track which is
    // called so toggling `public-read` after the initial authed load proves the
    // re-read went through the PUBLIC credential path (the Medium reactivity fix:
    // `publicRead` is now a read-trigger input).
    const authedCalls: string[] = [];
    const publicCalls: string[] = [];
    const authedFetch = (async (url: string) => {
      authedCalls.push(String(url));
      return new Response(CONTACTS_TTL, {
        status: 200,
        headers: { "Content-Type": "text/turtle" },
      });
    }) as unknown as typeof fetch;
    const publicFetch = (async (url: string) => {
      publicCalls.push(String(url));
      return new Response(CONTACTS_TTL, {
        status: 200,
        headers: { "Content-Type": "text/turtle" },
      });
    }) as unknown as typeof fetch;

    const el = await mount<JeswrContactList>("jeswr-contact-list");
    el.fetch = authedFetch;
    el.publicFetch = publicFetch;
    el.src = "https://pod.example/contacts/";
    // Initial load (public-read defaults to false) → the AUTHED fetch.
    await waitFor(el, (e) => e.querySelectorAll('[part="contact"]').length === 2, "authed load");
    expect(authedCalls.length).toBe(1);
    expect(publicCalls.length).toBe(0);

    // Toggle public-read AFTER the initial load. Because `publicRead` is in the
    // base read-trigger inputs, this MUST re-read — and through `publicFetch`.
    el.publicRead = true;
    await waitFor(
      el,
      () => publicCalls.length === 1,
      "public-read toggle re-reads via publicFetch",
    );
    expect(publicCalls.length).toBe(1);
    expect(publicCalls[0]).toBe("https://pod.example/contacts/");
    // The authed fetch was NOT used for the public re-read (no credential leak).
    expect(authedCalls.length).toBe(1);
  });

  it("never renders a hostile email/webId as a link, and escapes a hostile name", async () => {
    const el = await mount<JeswrContactList>("jeswr-contact-list");
    el.store = parseTurtle(HOSTILE_CONTACT_TTL);
    await waitFor(el, (e) => !!e.querySelector('[part="contact"]'), "hostile contact renders");

    // The model already DROPS a non-mailto: email / non-http(s) webId on read, so
    // neither a mailto/tel anchor nor a webid link is present.
    expect(el.querySelector('[part="emails"] a[href^="javascript:"]')).toBeNull();
    expect(el.querySelector('[part="webid"]')).toBeNull();
    // The model drops the javascript: email entirely (not a valid mailto:).
    expect(el.querySelector('a[href^="javascript:"]')).toBeNull();
    // The hostile name renders as escaped text (no live <script> element created).
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toContain("<script>alert(1)</script>");
  });
});
