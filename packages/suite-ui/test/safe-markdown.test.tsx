// AUTHORED-BY Codex (GPT-6.1 Sol)
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SafeMarkdown } from "../src/components/safe-markdown.js";

it("renders formatting with headings below the page heading and no active HTML or remote images", () => {
  const html = renderToStaticMarkup(
    <SafeMarkdown className="prose">
      {
        '# One\n\n## Two\n\n### Three\n\n#### Four\n\n**bold** *soft*\n\n![Photo](https://tracker.example/a.png) ![](https://tracker.example/b.png)\n\n<script>alert(1)</script>\n\n<iframe src="https://tracker.example"></iframe>\n\n<p onclick="alert(1)">Hidden HTML</p>\n\nPlain words'
      }
    </SafeMarkdown>,
  );
  expect(html).toContain('<div class="prose">');
  for (const value of [
    "<h3>One</h3>",
    "<h3>Two</h3>",
    "<h3>Three</h3>",
    "<h4>Four</h4>",
    "<strong>bold</strong>",
    "<em>soft</em>",
    "<span>Photo</span>",
    "<span>Image</span>",
    "Plain words",
  ])
    expect(html).toContain(value);
  for (const value of ["<h1", "<h2", "<script", "<iframe", "<img", "onclick", "tracker.example"])
    expect(html).not.toContain(value);
});

it.each([
  undefined,
  "_self",
  "_blank",
] as const)("honours linkTarget %s without bypassing URL sanitisation", (linkTarget) => {
  const html = renderToStaticMarkup(
    <SafeMarkdown {...(linkTarget ? { linkTarget } : {})}>
      {'[Notes](https://example.org/ "My notes") [Local](/notes) [Unsafe](javascript:alert%281%29)'}
    </SafeMarkdown>,
  );
  expect(html).toContain('href="https://example.org/"');
  expect(html).toContain('href="/notes"');
  expect(html).toContain('title="My notes"');
  if (linkTarget) expect(html).toContain(`target="${linkTarget}"`);
  else expect(html).not.toContain("target=");
  if (linkTarget === "_blank") expect(html).toContain('rel="noopener noreferrer"');
  else expect(html).not.toContain("rel=");
  expect(html).not.toContain("javascript:");
});

it("keeps safe links and removes executable URL schemes", () => {
  const html = renderToStaticMarkup(
    <SafeMarkdown>
      {"[Safe](https://example.org/) [Unsafe](javascript:alert%281%29) [Data](data:text/html,bad)"}
    </SafeMarkdown>,
  );
  expect(html).toContain('href="https://example.org/"');
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("data:text");
});
