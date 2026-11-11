// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const stylesheet = readFileSync("src/styles.css", "utf8");
let element: HTMLStyleElement | undefined;
afterEach(() => element?.remove());

function rules() {
  element = document.createElement("style");
  element.textContent = stylesheet;
  document.head.appendChild(element);
  return Array.from(element.sheet?.cssRules ?? []);
}

describe("chart accessibility styles", () => {
  it("maps SVG text to CanvasText in forced colours, including labelled annotations", () => {
    const forced = rules().find((rule) =>
      rule.cssText.startsWith("@media (forced-colors: active)"),
    ) as CSSMediaRule;
    const text = Array.from(forced.cssRules).find(
      (rule) => (rule as CSSStyleRule).selectorText === ".sc-chart .sc-svg text",
    ) as CSSStyleRule;
    expect(text.style.getPropertyValue("fill").toLowerCase()).toBe("canvastext");
    // Two classes plus an element outranks the two-class annotation fill rules.
    expect(text.selectorText).toBe(".sc-chart .sc-svg text");
  });
  it("distinguishes active and neutral intervals by border pattern", () => {
    const styles = rules() as CSSStyleRule[];
    const neutral = styles.find((rule) => rule.selectorText === ".sc-tone-neutral .sc-interval");
    const active = styles.find((rule) => rule.selectorText === ".sc-tone-active .sc-interval");
    expect(neutral?.style.getPropertyValue("stroke-dasharray")).toBe("4 3");
    expect(active?.style.getPropertyValue("stroke-dasharray")).toBe("none");
  });
});
