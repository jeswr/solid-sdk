// AUTHORED-BY Codex (GPT-6.1 Sol)
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Markdown } from "../src/apps/journal/components/markdown";

it("renders Markdown formatting while stripping active HTML, external images and links", () => {
  const html = renderToStaticMarkup(
    <Markdown
      text={
        '# A quiet day\n\n**A small win**\n\n![track](https://foreign.example/track.png)\n\n[link](javascript:alert(1))\n\n<script>alert(1)</script><iframe src="https://foreign.example"></iframe><p onclick="alert(1)">Keep these words</p>'
      }
    />,
  );
  expect(html).toContain("<h1>A quiet day</h1>");
  expect(html).toContain("<strong>A small win</strong>");
  expect(html).toContain("Keep these words");
  for (const value of [
    "<script",
    "<iframe",
    "<img",
    "<a ",
    "onclick",
    "javascript:",
    "foreign.example",
  ])
    expect(html).not.toContain(value);
});
