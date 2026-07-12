// @vitest-environment jsdom
// AUTHORED-BY Claude Fable 5
// Regression guard for the interactive-login popup.
//
// The <authorization-code-flow> custom element (the popup driver the
// LoginController mounts) is registered as a SIDE EFFECT of loading
// src/auth/controller.ts. As of @solid/reactive-authentication 0.1.4 the
// library STOPPED defining the element on a bare `import` of the package root
// and moved registration to the explicit `/registerElements` entry — a bare
// `import "@solid/reactive-authentication"` therefore no longer defines the
// element, and interactive login silently breaks (the popup never mounts).
//
// This test loads the real controller module and asserts the element is
// actually defined afterwards, so a future dependency bump that drops the
// `/registerElements` import (or reverts to the bare side-effect import) fails
// the gate here instead of on the live app.
import { describe, expect, it } from "vitest";

describe("auth/controller — custom-element registration", () => {
  it("defines <authorization-code-flow> after the controller module loads", async () => {
    // Loading the controller module runs its top-level
    // `import "@solid/reactive-authentication/registerElements"` side effect.
    await import("../../src/auth/controller.js");
    expect(customElements.get("authorization-code-flow")).toBeTypeOf("function");
  });

  it("buildController mounts an <authorization-code-flow> element into the DOM", async () => {
    const { buildController } = await import("../../src/auth/controller.js");
    buildController();
    const el = document.querySelector("authorization-code-flow");
    expect(el).not.toBeNull();
    // The mounted node is the registered custom element (upgraded), not a
    // bare unknown element — proving registration happened before mount.
    expect(el).toBeInstanceOf(
      customElements.get("authorization-code-flow") as CustomElementConstructor,
    );
  });
});
