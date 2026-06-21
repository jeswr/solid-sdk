// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-shacl-form> (the EDITABLE wrapper) tests. The load-bearing ones MIRROR the
// read view's §9 SSRF tests — the edit form shares the EXACT hardening pipeline
// (`resolveAndHarden`), so it MUST exhibit identical SSRF behaviour:
//   - inline data-shapes/data-values, NO *-url attrs, ALWAYS data-ignore-owl-imports;
//   - the form is EDITABLE (NO data-view attribute) — the one intended difference;
//   - a HOSTILE data graph + an EMPTY shapes graph triggers ZERO unguarded fetches
//     AND fails closed (no <shacl-form> mounted) — the empty-shapes auto-import SSRF;
//   - a HOSTILE data graph + a NON-empty shapes graph triggers ZERO unguarded fetches
//     (fix 1 closer) and the conformsTo→http import vector is stripped (fix 2);
//   - a REMOTE source uses ONLY the guarded fetch, never the app seam;
//   - the optimistic save state (saving → saved / error) + merge-callback delegation.

import "../src/index.js";
import { Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JeswrShaclForm } from "../src/index.js";

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

/** A hostile data graph: a conformsTo + rdf:type pointing at SSRF targets. */
const HOSTILE_DATA = `
@prefix dct: <http://purl.org/dc/terms/> .
@prefix ex: <https://attacker.example/> .
<https://victim.example/x>
  dct:conformsTo <http://169.254.169.254/latest/meta-data/iam/security-credentials/> ;
  a <http://192.168.0.1/internal-shape> ;
  ex:something "ok" .
`;

async function mount(): Promise<JeswrShaclForm> {
  const el = document.createElement("jeswr-shacl-form") as JeswrShaclForm;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

async function waitForForm(el: JeswrShaclForm): Promise<HTMLElement> {
  for (let i = 0; i < 60; i++) {
    await el.updateComplete;
    await Promise.resolve();
    const form = el.querySelector("shacl-form") as HTMLElement | null;
    if (form) return form;
  }
  throw new Error(`inner <shacl-form> never rendered (status: ${el.textContent})`);
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("<jeswr-shacl-form> registration + edit-mode mounting", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("jeswr-shacl-form")).toBeDefined();
  });

  it("renders inner <shacl-form> with INLINE shapes/values, NO -url attrs, EDITABLE (no data-view)", async () => {
    const el = await mount();
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "inline", text: DATA };
    const form = await waitForForm(el);

    expect(form.getAttribute("data-shapes")).toContain("NodeShape");
    expect(form.getAttribute("data-values")).toContain("Alice");
    // owl:imports discipline is ALWAYS on.
    expect(form.hasAttribute("data-ignore-owl-imports")).toBe(true);
    // THE intended difference from the view: NO data-view → shacl-form is EDITABLE.
    expect(form.hasAttribute("data-view")).toBe(false);
    // NO *-url attr / dataset key anywhere (the §9 no-fetch-surface rule).
    for (const attr of Array.from(form.attributes)) {
      expect(attr.name.toLowerCase().endsWith("-url")).toBe(false);
    }
    for (const key of Object.keys(form.dataset)) {
      expect(key.toLowerCase().endsWith("url")).toBe(false);
    }
  });

  it("strips a data-view key that somehow appears (must stay editable)", async () => {
    const el = await mount();
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "inline", text: DATA };
    const form = await waitForForm(el);
    form.dataset.view = ""; // an external script trying to force read-only.
    el.requestUpdate();
    await el.updateComplete;
    expect(form.dataset.view).toBeUndefined();
    expect(form.hasAttribute("data-view")).toBe(false);
  });
});

describe("<jeswr-shacl-form> §9 SSRF discipline (mirrors the read view)", () => {
  it("never calls the app fetch for INLINE sources", async () => {
    const appFetch = vi.fn(async () => new Response("", { status: 500 }));
    const el = await mount();
    el.fetch = appFetch as unknown as typeof fetch;
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
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "remote", url: "https://untrusted.example/data" };
    await waitForForm(el);
    expect(guarded).toHaveBeenCalledTimes(1);
    expect(appFetch).not.toHaveBeenCalled();
  });

  it("a HOSTILE data graph + an EMPTY shapes graph triggers ZERO unguarded fetches + fails closed", async () => {
    const globalSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) =>
        new Response(`<x> <y> "leaked-from ${String(input)}" .`, {
          headers: { "Content-Type": "text/turtle" },
        }),
    );
    try {
      const el = await mount();
      el.shapes = { kind: "inline", text: "" }; // empty → the auto-import precondition.
      el.values = { kind: "inline", text: HOSTILE_DATA };
      for (let i = 0; i < 60; i++) {
        await el.updateComplete;
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(globalSpy).not.toHaveBeenCalled();
      // Fail-closed: empty shapes never mount a form.
      expect(el.querySelector("shacl-form")).toBeNull();
      expect(el.querySelector('[part="error"]')).not.toBeNull();
    } finally {
      globalSpy.mockRestore();
    }
  });

  it("a HOSTILE data graph + a NON-empty shapes graph triggers ZERO unguarded fetches; conformsTo→http stripped, rdf:type kept", async () => {
    const globalSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response("", { headers: { "Content-Type": "text/turtle" } }),
      );
    try {
      const el = await mount();
      el.shapes = { kind: "inline", text: SHAPES };
      el.values = { kind: "inline", text: HOSTILE_DATA };
      const form = await waitForForm(el);
      for (let i = 0; i < 60; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(globalSpy).not.toHaveBeenCalled();
      const values = form.getAttribute("data-values") ?? "";
      // fix (2): the conformsTo→http import vector is dropped …
      expect(values).not.toContain("169.254.169.254");
      expect(values).not.toContain("conformsTo");
      // … but rdf:type is KEPT (load-bearing), and it is safe because fix (1) means a
      // non-empty shapes graph never runs the auto-import.
      expect(values).toContain("192.168.0.1");
    } finally {
      globalSpy.mockRestore();
    }
  });

  it("a trusted+public source FAILS CLOSED (no auth fetch, no global) when publicFetch is omitted", async () => {
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
      el.fetch = authFetch as unknown as typeof fetch; // ONLY the auth fetch.
      el.shapes = { kind: "inline", text: SHAPES };
      el.values = { kind: "trusted", url: "https://public.example/data", seam: "public" };
      for (let i = 0; i < 50; i++) {
        await el.updateComplete;
        await Promise.resolve();
        if (el.querySelector('[part="error"]')) break;
      }
      expect(el.querySelector('[part="error"]')?.textContent).toMatch(
        /publicFetch|credential-free/i,
      );
      expect(authFetch).not.toHaveBeenCalled();
      expect(globalSpy).not.toHaveBeenCalled();
      expect(el.querySelector("shacl-form")).toBeNull();
    } finally {
      globalSpy.mockRestore();
    }
  });

  it("FAILS CLOSED on an empty shapes graph — never mounts <shacl-form>", async () => {
    const el = await mount();
    el.shapes = { kind: "inline", text: "# only a comment\n" };
    el.values = { kind: "inline", text: DATA };
    for (let i = 0; i < 50; i++) {
      await el.updateComplete;
      await Promise.resolve();
      if (el.querySelector('[part="error"]')) break;
    }
    expect(el.querySelector("shacl-form")).toBeNull();
    expect(el.querySelector('[part="error"]')?.textContent ?? "").toMatch(/empty|shapes/i);
  });
});

describe("<jeswr-shacl-form> save flow (optimistic state + merge delegation)", () => {
  it("save() delegates to mergeSave with the form's toRDF graph + reports saved", async () => {
    const el = await mount();
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "inline", text: DATA };
    await waitForForm(el);

    let received: Store | undefined;
    el.mergeSave = async (g: Store) => {
      received = g;
    };
    const saved: unknown[] = [];
    el.addEventListener("jeswr-save", (e) => saved.push((e as CustomEvent).detail));

    const ok = await el.save();
    expect(ok).toBe(true);
    expect(received).toBeInstanceOf(Store);
    expect(saved).toHaveLength(1);
    // The saved status indicator is shown.
    await el.updateComplete;
    expect(el.querySelector('[part="status"][data-state="saved"]')).not.toBeNull();
  });

  it("save() on a mergeSave rejection reports error + fires jeswr-save-error (revert)", async () => {
    const el = await mount();
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "inline", text: DATA };
    await waitForForm(el);

    el.mergeSave = async () => {
      throw new Error("conflict: reload + retry");
    };
    const errors: unknown[] = [];
    el.addEventListener("jeswr-save-error", (e) => errors.push((e as CustomEvent).detail));

    const ok = await el.save();
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
    await el.updateComplete;
    const status = el.querySelector('[part="status"][data-state="error"]');
    expect(status?.textContent).toMatch(/conflict/i);
  });

  it("save() THROWS without a mergeSave callback (refuses a naive write)", async () => {
    const el = await mount();
    el.shapes = { kind: "inline", text: SHAPES };
    el.values = { kind: "inline", text: DATA };
    await waitForForm(el);
    // No mergeSave set.
    await expect(el.save()).rejects.toThrow(/mergeSave|naive write/i);
  });

  it("save() THROWS when the form is not ready (no inner shacl-form)", async () => {
    const el = await mount();
    // No shapes/values → idle, no inner form.
    el.mergeSave = async () => {};
    await expect(el.save()).rejects.toThrow(/not ready|inner <shacl-form>/i);
  });
});
