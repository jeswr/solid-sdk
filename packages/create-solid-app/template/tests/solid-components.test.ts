// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Pins the @jeswr/solid-components adoption baked into every create-solid-app
// scaffold: the declarative, data-bound read elements register as a side effect
// of importing the package, and the default <solid-view> composer drives reads
// through the INJECTED `.fetch` seam (the app's authenticated fetch) — never a
// bare global. This is the adoption-mechanics test for THIS app; the components'
// deeper read/parse behaviour is tested in @jeswr/solid-components itself.
//
// Runs under jsdom (file-local docblock) so the Lit elements can upgrade.
import "@jeswr/solid-components";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// jsdom ships no matchMedia; some suite Web Components read it on upgrade, so stub
// it (default: motion allowed) before any element upgrades.
beforeAll(() => {
  if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("@jeswr/solid-components (create-solid-app baked adoption)", () => {
  it("registers the data-bound read elements on import", async () => {
    // Every element the template's JSX typing (types/solid-components.d.ts) declares
    // must be a real, registered custom element — so the scaffolded app's JSX is wired
    // to actual elements, not phantom tags.
    const tags = [
      "solid-view",
      "jeswr-task-list",
      "jeswr-contact-list",
      "jeswr-profile-card",
      "jeswr-bookmark-list",
      "jeswr-collection",
      "jeswr-shacl-view",
    ] as const;
    for (const tag of tags) {
      await customElements.whenDefined(tag);
      expect(customElements.get(tag), `${tag} not registered`).toBeTruthy();
    }
  });

  it("drives <solid-view> reads through the INJECTED .fetch seam (the auth seam, not a global)", async () => {
    // The template (components/solid/PodDataView.tsx) sets `.fetch` to the app's
    // authenticated fetch. Prove the element actually USES the injected seam to read
    // its `src` — so the user's DPoP-authed reads flow through, never a bare global.
    // Capture every URL the element requests through the INJECTED fetch, so we can
    // assert on it WITHOUT indexing the spy's `mock.calls` tuple (which a zero-arg
    // spy types as empty under strict tuple checking).
    const requested: string[] = [];
    const injected: typeof fetch = async (input: RequestInfo | URL) => {
      requested.push(typeof input === "string" ? input : input.toString());
      // An empty container body — valid Turtle, so the read succeeds with no children.
      return new Response("", {
        status: 200,
        headers: { "content-type": "text/turtle", etag: '"v1"' },
      });
    };
    const spy = vi.fn(injected);
    const el = document.createElement("solid-view") as HTMLElement & {
      fetch?: typeof fetch;
      src?: string;
      updateComplete?: Promise<unknown>;
    };
    el.fetch = spy as unknown as typeof fetch;
    el.src = "https://alice.example/c/";
    document.body.appendChild(el);
    await customElements.whenDefined("solid-view");
    // Let the element's read lifecycle settle (it reads on `src` set).
    await el.updateComplete;
    // Microtask drain for the async read inside the controller.
    await new Promise((r) => setTimeout(r, 0));
    // The element read its `src` through the INJECTED fetch — not a bare global.
    expect(spy).toHaveBeenCalled();
    expect(requested.some((u) => u.includes("https://alice.example/c/"))).toBe(true);
    el.remove();
  });
});
