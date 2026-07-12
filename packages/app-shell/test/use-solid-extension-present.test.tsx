// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Unit tests for useSolidExtensionPresent — the presence signal that lets an app hide its own
// <AccountMenu/> when the @jeswr Solid browser extension is installed. Covers the three announce
// channels the extension's inject uses: the sticky <html> marker, the `window.solid` object, and
// the reactive `solid-extension:ready` event.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useSolidExtensionPresent } from "../src/hooks/use-solid-extension-present.js";

function Probe() {
  const present = useSolidExtensionPresent();
  return <div data-testid="present">{present ? "yes" : "no"}</div>;
}

afterEach(() => {
  document.documentElement.removeAttribute("data-solid-extension");
  delete (window as unknown as { solid?: unknown }).solid;
});

describe("useSolidExtensionPresent", () => {
  it("is FALSE with no extension signal (app renders its own AccountMenu)", () => {
    render(<Probe />);
    expect(screen.getByTestId("present")).toHaveTextContent("no");
  });

  it("is TRUE synchronously when the sticky <html data-solid-extension> marker is set", () => {
    document.documentElement.setAttribute("data-solid-extension", "1");
    render(<Probe />);
    // Synchronous on first render → no flash of the app's own menu.
    expect(screen.getByTestId("present")).toHaveTextContent("yes");
  });

  it("is TRUE when window.solid is present (belt-and-braces signal)", () => {
    (window as unknown as { solid: unknown }).solid = { webId: null };
    render(<Probe />);
    expect(screen.getByTestId("present")).toHaveTextContent("yes");
  });

  it("flips to TRUE reactively when the extension announces after mount (marker + event)", () => {
    render(<Probe />);
    expect(screen.getByTestId("present")).toHaveTextContent("no");
    act(() => {
      // Simulate a late inject: set the marker (observed via MutationObserver) + fire the event.
      document.documentElement.setAttribute("data-solid-extension", "1");
      window.dispatchEvent(new window.CustomEvent("solid-extension:ready"));
    });
    expect(screen.getByTestId("present")).toHaveTextContent("yes");
  });
});
