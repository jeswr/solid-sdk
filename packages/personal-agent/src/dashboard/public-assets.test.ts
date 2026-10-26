import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The browser code renders every server value as text. There is no DOM in this test environment,
// so this is a static guard over the shipped assets (the HTTP tests cover the JSON side).
const read = (f: string) => readFileSync(new URL(`./public/${f}`, import.meta.url), "utf8");
const js = read("app.js");
const html = read("index.html");
const css = read("app.css");

describe("dashboard browser assets", () => {
  it("app.js has no HTML-injection or code-evaluation sinks", () => {
    for (const sink of [
      /\.innerHTML\b/,
      /\.outerHTML\b/,
      /insertAdjacentHTML/,
      /document\.write/,
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /setTimeout\s*\(\s*["'`]/,
      /setInterval\s*\(/,
      /createContextualFragment/,
      /DOMParser/,
      /\.srcdoc\b/,
      /javascript:/i,
      /localStorage|sessionStorage|document\.cookie/,
    ])
      expect(js, String(sink)).not.toMatch(sink);
  });

  it("every child is appended through the helper that skips null/undefined/false", () => {
    // Native append() turns null into the text "null"; only the helper's own call may use it.
    const raw = js.match(/\.(append|prepend|after|before|replaceWith)\(/g) ?? [];
    expect(raw).toEqual([".append("]);
    expect(js).toMatch(
      /if \(c === undefined \|\| c === null \|\| c === false\) continue;\s+el\.append\(c instanceof Node/,
    );
    expect(js).not.toMatch(/\.textContent = [^;]*\?\?/);
  });

  it("the element helper refuses event-handler, style and unsafe link attributes", () => {
    expect(js).toMatch(/\/\^on\/i\.test\(k\) \|\| k === "innerHTML" \|\| k === "style"/);
    expect(js).toMatch(/SAFE_HREF = \/\^\(#\|\\\/\(\?!\\\/\)\|https:\\\/\\\/\)\//);
  });

  it("the page has no inline script, inline style, handler attribute or remote resource", () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
    expect(css).not.toMatch(/@import|url\(\s*["']?(https?:)?\/\//);
  });

  it("the page removes the one-time code from the address bar before using it", () => {
    const replace = js.indexOf('history.replaceState(null, "", "/#overview")');
    const exchange = js.indexOf('api("POST", "/session"');
    expect(replace).toBeGreaterThan(0);
    expect(exchange).toBeGreaterThan(replace);
    expect(html).toMatch(/<meta name="referrer" content="no-referrer"/);
  });
});
