// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// §9 element tests for <jeswr-shacl-view>:
//   - it renders the inner <shacl-form> with INLINE data-shapes/data-values,
//   - it ALWAYS sets data-view + data-ignore-owl-imports,
//   - it NEVER sets ANY *-url attribute / dataset key on the inner <shacl-form>,
//   - no un-guarded fetch leaves the wrapper for a remote source.

import "../src/index.js"; // registers <jeswr-shacl-view>
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JeswrShaclView } from "../src/index.js";

const SHAPES = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://ex.example/> .
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [ sh:path ex:name ; sh:name "Name" ; sh:datatype <http://www.w3.org/2001/XMLSchema#string> ] .
`;

const DATA = `
@prefix ex: <https://ex.example/> .
ex:alice a ex:Person ; ex:name "Alice" .
`;

/** Mount an element, wait for its update + one microtask flush. */
async function mount(): Promise<JeswrShaclView> {
  const el = document.createElement("jeswr-shacl-view") as JeswrShaclView;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

/** Wait until the inner <shacl-form> exists (the view became "ready"). */
async function waitForForm(el: JeswrShaclView): Promise<HTMLElement> {
  for (let i = 0; i < 50; i++) {
    await el.updateComplete;
    await Promise.resolve();
    const form = el.querySelector("shacl-form") as HTMLElement | null;
    if (form) return form;
  }
  throw new Error(`inner <shacl-form> never rendered (status visible: ${el.textContent})`);
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("<jeswr-shacl-view> §9 SSRF discipline", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("jeswr-shacl-view")).toBeDefined();
  });

  it("renders inner <shacl-form> with INLINE data-shapes/data-values, NO -url attrs", async () => {
    const el = await mount();
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "inline", text: DATA };
    const form = await waitForForm(el);

    // Inline strings are present.
    expect(form.getAttribute("data-shapes")).toContain("NodeShape");
    expect(form.getAttribute("data-values")).toContain("Person");

    // The view/owl-imports discipline attributes are ALWAYS set.
    expect(form.hasAttribute("data-view")).toBe(true);
    expect(form.hasAttribute("data-ignore-owl-imports")).toBe(true);

    // NO *-url attribute anywhere on the inner element.
    for (const attr of Array.from(form.attributes)) {
      expect(attr.name.toLowerCase().endsWith("-url")).toBe(false);
    }
    // NO *url dataset key either (covers data-shapes-url / data-values-url).
    for (const key of Object.keys(form.dataset)) {
      expect(key.toLowerCase().endsWith("url")).toBe(false);
    }
    // Specifically the two SSRF-dangerous keys are absent.
    expect(form.getAttribute("data-shapes-url")).toBeNull();
    expect(form.getAttribute("data-values-url")).toBeNull();
  });

  it("never calls the app fetch for INLINE sources", async () => {
    const appFetch = vi.fn(async () => new Response("", { status: 500 }));
    const el = await mount();
    el.fetch = appFetch as unknown as typeof fetch;
    el.publicFetch = appFetch as unknown as typeof fetch;
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "inline", text: DATA };
    await waitForForm(el);
    expect(appFetch).not.toHaveBeenCalled();
  });

  it("a REMOTE source uses ONLY the guarded fetch, never the app seam", async () => {
    const appFetch = vi.fn(
      async () => new Response(SHAPES, { headers: { "Content-Type": "text/turtle" } }),
    );
    const guarded = vi.fn(
      async () => new Response(DATA, { headers: { "Content-Type": "text/turtle" } }),
    );
    const el = await mount();
    el.fetch = appFetch as unknown as typeof fetch;
    el.publicFetch = appFetch as unknown as typeof fetch;
    el.resolveOptions = {
      loadGuardedFetch: () => Promise.resolve(guarded as unknown as typeof fetch),
    };
    // Shapes inline (no fetch), data from an untrusted remote URL.
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "remote", url: "https://untrusted.example/data" };
    await waitForForm(el);

    expect(guarded).toHaveBeenCalledTimes(1);
    // The app's credential-bearing/public fetch is NEVER used for the untrusted URL.
    expect(appFetch).not.toHaveBeenCalled();
  });

  it("a trusted+public source FAILS CLOSED (no auth fetch, no global) when publicFetch is omitted", async () => {
    // Credential boundary, fail-closed: only `fetch` (authenticated) is set, and a
    // { seam: "public" } trusted source has NO credential-free fetch. The element
    // must NOT use the auth fetch, must NOT fall back to a (possibly auth-patched)
    // global fetch — it errors instead, so the session token can never leak.
    const authFetch = vi.fn(
      async () => new Response(DATA, { headers: { "Content-Type": "text/turtle" } }),
    );
    const globalSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(SHAPES, {
          headers: { "Content-Type": "text/turtle" },
        }) as unknown as Response,
    );
    try {
      const el = await mount();
      el.fetch = authFetch as unknown as typeof fetch; // ONLY the auth fetch is set.
      el.shapes = { kind: "inline", text: SHAPES };
      el.values = { kind: "trusted", url: "https://public.example/data", seam: "public" };
      // Wait for the error state.
      for (let i = 0; i < 50; i++) {
        await el.updateComplete;
        await Promise.resolve();
        if (el.querySelector('[part="error"]')) break;
      }
      const err = el.querySelector('[part="error"]');
      expect(err).not.toBeNull();
      expect(err?.textContent).toMatch(/publicFetch|credential-free/i);
      // NEITHER the auth fetch NOR the global fetch was used for the public source.
      expect(authFetch).not.toHaveBeenCalled();
      expect(globalSpy).not.toHaveBeenCalled();
      // Fail-closed: no <shacl-form> rendered.
      expect(el.querySelector("shacl-form")).toBeNull();
    } finally {
      globalSpy.mockRestore();
    }
  });

  it("removes a *-url dataset key that somehow appears (defence in depth)", async () => {
    const el = await mount();
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "inline", text: DATA };
    const form = await waitForForm(el);
    // Simulate an external script planting a fetch-url key, then a re-render.
    form.dataset.shapesUrl = "http://169.254.169.254/";
    el.requestUpdate();
    await el.updateComplete;
    expect(form.dataset.shapesUrl).toBeUndefined();
    expect(form.getAttribute("data-shapes-url")).toBeNull();
  });

  it("forces VIEW (read-only) mode — data-view is set so shacl-form is not editable", async () => {
    const el = await mount();
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "inline", text: DATA };
    const form = await waitForForm(el);
    // data-view present (non-null) ⇒ shacl-form editMode === false (view mode).
    expect(form.hasAttribute("data-view")).toBe(true);
  });

  it("clearing inputs mid-flight does NOT render stale data (resolve-race regression)", async () => {
    // A trusted source with a fetch we control the timing of, so we can clear the
    // inputs WHILE the resolve is in flight and assert the in-flight resolve cannot
    // win the render (the #renderToken-before-early-return fix).
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slowFetch = vi.fn(async () => {
      await gate; // hold the fetch open until we release it.
      return new Response(SHAPES, { headers: { "Content-Type": "text/turtle" } });
    });

    const el = await mount();
    el.fetch = slowFetch as unknown as typeof fetch;
    el.shapes = { kind: "trusted", url: "https://alice.example/shape", seam: "auth" };
    el.values = { kind: "inline", text: DATA };
    await el.updateComplete; // status === "loading", resolve in flight on the gate.

    // Now clear the inputs while the shape fetch is still pending.
    el.shapes = undefined;
    el.values = undefined;
    await el.updateComplete; // status should be back to "idle".

    // Release the stale in-flight fetch and let everything settle.
    release?.();
    for (let i = 0; i < 20; i++) {
      await el.updateComplete;
      await Promise.resolve();
    }

    // The stale resolve must NOT have rendered a <shacl-form>; we're idle.
    expect(el.querySelector("shacl-form")).toBeNull();
  });

  it("shows an error (escaped text, not innerHTML) when a source fails to parse", async () => {
    const el = await mount();
    el.shapes = { kind: "inline", text: "<<< not rdf" };
    el.values = { kind: "inline", text: DATA };
    // Wait for error state.
    for (let i = 0; i < 50; i++) {
      await el.updateComplete;
      await Promise.resolve();
      if (el.querySelector('[part="error"]')) break;
    }
    const err = el.querySelector('[part="error"]');
    expect(err).not.toBeNull();
    expect(err?.getAttribute("role")).toBe("alert");
    // No inner <shacl-form> rendered on error (fail-closed, no partial graph).
    expect(el.querySelector("shacl-form")).toBeNull();
  });

  it("sets a plain data-shape-subject IRI (a selector, not a fetch URL)", async () => {
    const el = await mount();
    el.shapeSubject = "https://ex.example/PersonShape";
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "inline", text: DATA };
    const form = await waitForForm(el);
    expect(form.dataset.shapeSubject).toBe("https://ex.example/PersonShape");
    // It is NOT a *-url key.
    expect(form.getAttribute("data-shape-subject-url")).toBeNull();
  });
});
