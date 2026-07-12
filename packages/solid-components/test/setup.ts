// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Test setup. jsdom (selected in vitest.config.ts) provides the custom-element
// registry, the DOM, and TextDecoder/ReadableStream that the element + the RDF
// pre-fetch path use. We only need to ensure `navigator.languages` exists —
// @ulb-darmstadt/shacl-form reads it at construction to pick a label language,
// and some jsdom versions leave it undefined.
if (typeof navigator !== "undefined" && !Array.isArray(navigator.languages)) {
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    value: ["en"],
  });
}

// jsdom does not implement Constructable Stylesheets (`new CSSStyleSheet()` +
// `replaceSync` / adopted stylesheets). @ulb-darmstadt/shacl-form's DefaultTheme
// constructs a CSSStyleSheet and calls `.replaceSync(...)`, and the element adopts
// stylesheets via `shadowRoot.adoptedStyleSheets`. We render shacl-form into the
// LIGHT DOM (no shadow root) so the adopted-stylesheet path is not hit by our
// wrapper, but the theme STILL constructs a CSSStyleSheet at init. Provide a
// minimal in-memory shim so that construction + replaceSync succeed under jsdom.
// (Styling correctness is a browser concern, not a unit-test concern; this only
// keeps the DOM env from throwing on an unimplemented browser API.)
const G = globalThis as unknown as {
  CSSStyleSheet?: { prototype: { replaceSync?: unknown; replace?: unknown; cssRules?: unknown } };
};
if (typeof G.CSSStyleSheet === "undefined") {
  class CSSStyleSheetShim {
    cssRules: unknown[] = [];
    replaceSync(_text: string): void {}
    async replace(_text: string): Promise<void> {}
    insertRule(): number {
      return 0;
    }
    deleteRule(): void {}
  }
  (globalThis as unknown as { CSSStyleSheet: unknown }).CSSStyleSheet = CSSStyleSheetShim;
} else {
  const proto = G.CSSStyleSheet.prototype;
  if (typeof proto.replaceSync !== "function") {
    proto.replaceSync = function replaceSync(): void {};
  }
  if (typeof proto.replace !== "function") {
    proto.replace = async function replace(): Promise<void> {};
  }
  if (proto.cssRules === undefined) {
    Object.defineProperty(proto, "cssRules", { configurable: true, get: () => [] });
  }
}
