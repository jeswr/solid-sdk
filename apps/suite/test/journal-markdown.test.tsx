// AUTHORED-BY Codex (GPT-6.1 Sol)

import { SafeMarkdown } from "@jeswr/suite-ui";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

it("uses the shared safe Markdown with entry headings below the page heading", () => {
  const html = renderToStaticMarkup(
    <SafeMarkdown className="jn-prose">
      {
        '# A quiet day\n\n**A small win**\n\n![track](https://foreign.example/track.png)\n\n[link](javascript:alert(1))\n\n<script>alert(1)</script><iframe src="https://foreign.example"></iframe><p onclick="alert(1)">Hidden HTML</p>\n\nKeep these words'
      }
    </SafeMarkdown>,
  );
  expect(html).toContain("<h3>A quiet day</h3>");
  expect(html).toContain("<strong>A small win</strong>");
  expect(html).toContain("Keep these words");
  for (const value of ["<script", "<iframe", "<img", "onclick", "javascript:", "foreign.example"])
    expect(html).not.toContain(value);
});
