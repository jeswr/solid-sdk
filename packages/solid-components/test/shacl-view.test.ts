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
    // The data graph is NEUTRALISED (§9 fix 2) — but NARROWLY: only a
    // `dct:conformsTo` → http(s) quad is dropped. `rdf:type` is KEPT (it is load-
    // bearing for shacl-form's shape-selection; the earlier rdf:type strip blanked
    // benign instances — the HIGH this round fixes). So both the literal data
    // (`ex:name "Alice"`) AND the `a ex:Person` type triple survive here (there is
    // no conformsTo in this graph to strip).
    expect(form.getAttribute("data-values")).toContain("Alice");
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

  // ── §9 auto-import (the SECOND fetch path) regression tests ────────────────
  //
  // @ulb-darmstadt/shacl-form's `loadGraphs()` auto-derives a values subject from
  // the DATA graph (any subject with `dct:conformsTo`) and, when the loaded SHAPES
  // graph is EMPTY, fetches every http(s) IRI that subject points at via
  // `rdf:type` / `dct:conformsTo` with an UNGUARDED `globalThis.fetch`. These two
  // tests prove the wrapper closes that path. They are the assertions whose
  // ABSENCE let the original build pass with the latent HIGH.

  /** A hostile data graph: a conformsTo + rdf:type pointing at SSRF targets. */
  const HostileData = `
@prefix dct: <http://purl.org/dc/terms/> .
@prefix ex: <https://attacker.example/> .
<https://victim.example/x>
  dct:conformsTo <http://169.254.169.254/latest/meta-data/iam/security-credentials/> ;
  a <http://192.168.0.1/internal-shape> ;
  ex:something "ok" .
`;

  /** Same idea but the import target is a PREFIXED IRI (shacl-form expands it). */
  const HostileDataPrefixed = `
@prefix dct: <http://purl.org/dc/terms/> .
@prefix internal: <http://10.0.0.5/> .
<https://victim.example/y> dct:conformsTo internal:shape ; a internal:Type .
`;

  it("a HOSTILE data graph + an EMPTY shapes graph triggers ZERO unguarded fetches (the auto-import SSRF)", async () => {
    // Spy on the global fetch — the bare fetch shacl-form's auto-import uses. ANY
    // call to it (other than ones we deliberately inject — there are none here, all
    // sources are inline) is the SSRF firing.
    const globalSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        new Response(`<x> <y> "leaked-from ${String(input)}" .`, {
          headers: { "Content-Type": "text/turtle" },
        }),
    );
    try {
      const el = await mount();
      // EMPTY shapes graph (the auto-import precondition) + the hostile data graph.
      el.shapes = { kind: "inline", text: "" };
      el.values = { kind: "inline", text: HostileData };
      // Let the element resolve + (try to) render + let any shacl-form async load run.
      for (let i = 0; i < 60; i++) {
        await el.updateComplete;
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
      }
      // ZERO unguarded fetches — to the metadata endpoint, the internal IP, or
      // ANYTHING. (Inline sources fetch nothing at all.)
      expect(globalSpy).not.toHaveBeenCalled();
      // And it failed closed (empty shapes) — no <shacl-form> mounted.
      expect(el.querySelector("shacl-form")).toBeNull();
    } finally {
      globalSpy.mockRestore();
    }
  });

  it("a HOSTILE data graph with a NON-empty shapes graph triggers ZERO unguarded fetches (fix 1 closes it; the conformsTo→http target is also stripped, rdf:type kept)", async () => {
    const globalSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response("", { headers: { "Content-Type": "text/turtle" } }),
      );
    try {
      const el = await mount();
      // A VALID, non-empty shapes graph this time (so it mounts) + hostile data.
      el.shapes = { kind: "inline", text: SHAPES };
      el.values = { kind: "inline", text: HostileData };
      const form = await waitForForm(el);
      for (let i = 0; i < 60; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
      }
      // No unguarded fetch fired — fix (1) is the closer: a NON-empty shapes graph
      // means the upstream auto-import branch's `countQuads(loaded-shapes) === 0`
      // precondition is false, so it never fetches regardless of the data graph.
      expect(globalSpy).not.toHaveBeenCalled();
      const values = form.getAttribute("data-values") ?? "";
      // Fix (2) NARROW: the `dct:conformsTo` → http(s) import vector IS dropped …
      expect(values).not.toContain("169.254.169.254");
      expect(values).not.toContain("conformsTo");
      // … but `rdf:type` is KEPT (load-bearing for shape-selection — the High fix),
      // so the `a <http://192.168.0.1/...>` quad survives. That is SAFE: with a non-
      // empty shapes graph the auto-import never runs (asserted above), so the kept
      // rdf:type→http is never fetched. (Were the shapes graph empty, fix 1 fail-
      // closes — see the empty-shapes test above.)
      expect(values).toContain("192.168.0.1");
      expect(values).toContain("ok"); // the benign literal survives.
    } finally {
      globalSpy.mockRestore();
    }
  });

  it("a HOSTILE data graph using a PREFIXED import IRI is also neutralised (no unguarded fetch)", async () => {
    const globalSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response("", { headers: { "Content-Type": "text/turtle" } }),
      );
    try {
      const el = await mount();
      el.shapes = { kind: "inline", text: "" }; // empty → auto-import precondition.
      el.values = { kind: "inline", text: HostileDataPrefixed };
      for (let i = 0; i < 60; i++) {
        await el.updateComplete;
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(globalSpy).not.toHaveBeenCalled();
      expect(el.querySelector("shacl-form")).toBeNull(); // fail-closed on empty shapes.
    } finally {
      globalSpy.mockRestore();
    }
  });

  it("FAILS CLOSED on an empty shapes graph — never mounts <shacl-form> (fix 1)", async () => {
    const el = await mount();
    el.shapes = { kind: "inline", text: "" };
    el.values = { kind: "inline", text: DATA };
    for (let i = 0; i < 50; i++) {
      await el.updateComplete;
      await Promise.resolve();
      if (el.querySelector('[part="error"]')) break;
    }
    const err = el.querySelector('[part="error"]');
    expect(err).not.toBeNull();
    expect(err?.textContent ?? "").toMatch(/empty|shapes/i);
    // The load-bearing assertion: NO inner <shacl-form> with an empty shapes graph.
    expect(el.querySelector("shacl-form")).toBeNull();
  });

  it("FAILS CLOSED on a comment-/prefix-only shapes graph (zero quads → no <shacl-form>)", async () => {
    const el = await mount();
    // Parses without error but yields ZERO quads — still the auto-import precondition.
    el.shapes = {
      kind: "inline",
      text: "# just a comment\n@prefix ex: <https://ex.example/> .\n",
    };
    el.values = { kind: "inline", text: DATA };
    for (let i = 0; i < 50; i++) {
      await el.updateComplete;
      await Promise.resolve();
      if (el.querySelector('[part="error"]')) break;
    }
    expect(el.querySelector("shacl-form")).toBeNull();
    expect(el.querySelector('[part="error"]')).not.toBeNull();
  });

  // ── REGRESSION GUARD for the HIGH (rdf:type over-strip) ────────────────────
  //
  // The earlier build's neutralisation dropped EVERY `rdf:type` → http(s) quad,
  // which is load-bearing for shacl-form's view-mode shape-selection
  // (`findRootShaclShapeSubject` follows the values subject's `rdf:type` to pick
  // the matching `sh:targetClass` node shape). Stripping it rendered a benign
  // instance BLANK. This test proves the fix: a benign instance whose `rdf:type`
  // is kept RENDERS through <jeswr-shacl-view> (the inner <shacl-form> binds the
  // instance and shows its property value), i.e. the view is NOT blank.
  //
  // The instance declares `dct:conformsTo <urn:…>` (a non-http profile reference,
  // NOT stripped) so shacl-form auto-derives the values subject — the wrapper does
  // not pin one (fix 3) — and the kept `rdf:type` selects the shape. (Without a
  // derived/pinned values subject, shacl-form view mode binds to a fresh blank
  // node and shows nothing — a pre-existing wrapper limitation, not the High.)
  it("RENDERS a benign instance (rdf:type survives → view is NOT blank) — the HIGH regression guard", async () => {
    const PersonShapes = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://ex.example/> .
ex:PersonShape a sh:NodeShape ;
  sh:targetClass ex:Person ;
  sh:property [ sh:path ex:name ; sh:name "Name" ; sh:datatype <http://www.w3.org/2001/XMLSchema#string> ] .
`;
    // Benign data: `a ex:Person` (the type triple that MUST survive) + a non-http
    // conformsTo profile reference (kept, derives the values subject) + a literal.
    const PersonData = `
@prefix dct: <http://purl.org/dc/terms/> .
@prefix ex: <https://ex.example/> .
ex:alice dct:conformsTo <urn:profile:person> ; a ex:Person ; ex:name "Alice" .
`;
    const el = await mount();
    el.shapes = { kind: "inline", text: PersonShapes };
    el.values = { kind: "inline", text: PersonData };
    const form = await waitForForm(el);

    // 1. The rdf:type triple SURVIVES neutralisation in the inlined data-values
    //    (the direct High guard: it is no longer stripped).
    const inlined = form.getAttribute("data-values") ?? "";
    expect(inlined).toContain("https://ex.example/Person");
    expect(inlined).toContain("Alice");

    // 2. The view is NOT blank: shacl-form binds the actual instance subject (a
    //    NamedNode `ex:alice`, not a fresh blank node) and renders its name value.
    //    (Wait for shacl-form's debounced async render into its shadow root.)
    let bound = false;
    for (let i = 0; i < 200; i++) {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 5));
      const root = (form.shadowRoot as unknown as ParentNode | null) ?? form;
      const node = root.querySelector("shacl-node") as HTMLElement | null;
      const renderedAliceValue = Array.from(root.querySelectorAll("[data-value]")).some((e) =>
        (e.getAttribute("data-value") ?? "").includes("Alice"),
      );
      if (node?.getAttribute("data-node-id") === "https://ex.example/alice" && renderedAliceValue) {
        bound = true;
        break;
      }
    }
    expect(bound).toBe(true);
  });

  it("does NOT pin a values-subject sentinel that would blank a normal view (fix 3 rationale)", async () => {
    // We chose NOT to set `data-values-subject` to a foreign sentinel (it would
    // render an empty view). Confirm the attribute is absent so shacl-form renders
    // against all target nodes; auto-derivation is already neutralised by fix (2).
    const el = await mount();
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "inline", text: DATA };
    const form = await waitForForm(el);
    expect(form.hasAttribute("data-values-subject")).toBe(false);
    expect(form.dataset.valuesSubject).toBeUndefined();
  });
});
