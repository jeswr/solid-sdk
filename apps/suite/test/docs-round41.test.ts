// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Editor, getSchema } from "@tiptap/react";
import { expect, it, vi } from "vitest";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { exportMarkdown, importMarkdown } from "../src/apps/docs/lib/convert/markdown";

const extensions = baseExtensions(vi.fn(() => new Promise<Response>(() => {})));
const schema = getSchema(extensions);

it.each([
  " ",
  "\t",
  " \n ",
])("round41 reference labels trim surrounding whitespace in every reference form: %j", (padding) => {
  for (const image of [false, true]) {
    for (const form of ["full", "collapsed", "shortcut"]) {
      for (const paddedDefinition of [false, true]) {
        const label = form === "full" ? "label" : `${padding}Name${padding}`;
        const suffix =
          form === "full" ? `[${padding}Name${padding}]` : form === "collapsed" ? "[]" : "";
        const definition = paddedDefinition ? " Name " : "Name";
        const result = importMarkdown(
          `${image ? "!" : ""}[${label}]${suffix}\n\n[${definition}]: https://example.org/map`,
          "references.md",
        );
        expect(result.skipped).toEqual([]);
        const first = result.json.content?.[0];
        if (image)
          expect(first).toMatchObject({ type: "image", attrs: { src: "https://example.org/map" } });
        else
          expect(first?.content?.[0]?.marks).toMatchObject([
            { type: "link", attrs: { href: "https://example.org/map" } },
          ]);
        expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
      }
    }
  }
});

it.each([
  "*",
  "_",
  "~~",
])("round41 trimmed reference labels share precedence and %s masking", (delimiter) => {
  const result = importMarkdown(
    `${delimiter}[label${delimiter}][ Name ]\n\n[Name]: https://example.org/first\n[ Name ]: https://example.org/second`,
    "mask.md",
  );
  expect(result.json.content?.[0]?.content).toMatchObject([
    { type: "text", text: delimiter },
    {
      type: "text",
      text: `label${delimiter}`,
      marks: [{ type: "link", attrs: { href: "https://example.org/first" } }],
    },
  ]);
});

it.each([
  "",
  " ",
  "  ",
  "   ",
])("round41 interrupting HTML terminates lazy quotations with %j indentation", (indent) => {
  for (const prefix of ["> ", "> > ", "> - ", "- > "]) {
    const outer = prefix === "- > " ? "  " : "";
    for (const html of [
      "<table><tr><td>Outside</td></tr></table>",
      "<TABLE><TR><TD>Outside</TD></TR></TABLE>",
      "<div>Outside</div>",
      "<!-- Outside -->",
      "<?Outside?>",
      "<!DOCTYPE html>",
      "<![CDATA[Outside]]>",
      "<pre>Outside</pre>",
      "<PRE>Outside</PRE>",
    ]) {
      const result = importMarkdown(`${prefix}Quote\n${outer}${indent}${html}`, "quote.md");
      const expected = importMarkdown(`${prefix}Quote\n\n${outer}${html}`, "explicit.md");
      expect(result.json).toEqual(expected.json);
    }
  }
});

it.each([
  "- ",
  "4. ",
  "- [ ] ",
  "> - ",
  "- - ",
  "- > - ",
])("round41 indented prose keeps following lazy continuations inside %s", (prefix) => {
  const continuation = prefix.replace(/\[[ xX]\] /g, "").replace(/[^ >]/g, " ");
  for (const indent of ["    ", "\t", "       "]) {
    const result = importMarkdown(
      `${prefix}Plan\n${continuation}${indent}prose\nContinued`,
      "list.md",
    );
    const expected = importMarkdown(
      `${prefix}Plan\n${continuation}prose\n${continuation}Continued`,
      "explicit.md",
    );
    expect(result.skipped).toEqual([]);
    expect(result.json).toEqual(expected.json);
    expect(schema.nodeFromJSON(result.json).textContent).toBe("Plan\nprose\nContinued");
    expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
  }
});

it.each([
  ["- ", "- ", "bulletList"],
  ["4. ", "5. ", "orderedList"],
  ["- [ ] ", "- [x] ", "taskList"],
])("round41 list boundary recovery retains later sibling items after %s", (first, second, type) => {
  const indent = first === "4. " ? "   " : "  ";
  const source = `${first}Plan\n${indent}    prose\nContinued\n${indent}       more\nStill here\n${second}Next`;
  const result = importMarkdown(source, "siblings.md");
  expect(result.skipped).toEqual([]);
  expect(result.json.content).toHaveLength(1);
  const list = result.json.content?.[0];
  expect(list?.type).toBe(type);
  expect(list?.content).toHaveLength(2);
  expect(schema.nodeFromJSON(list?.content?.[0]).textContent).toBe(
    "Plan\nprose\nContinued\nmore\nStill here",
  );
  expect(schema.nodeFromJSON(list?.content?.[1]).textContent).toBe("Next");
  expect(importMarkdown(exportMarkdown(result.json), "again.md").json).toEqual(result.json);
});

it.each([
  ["- Plan\n\n      code\nOutside", ["bulletList", "paragraph"]],
  ["- # Heading\nOutside", ["bulletList", "paragraph"]],
  ["- Plan\n      prose\n\nOutside", ["bulletList", "paragraph"]],
  ["- Plan\n      prose\n# Outside", ["bulletList", "heading"]],
  ["- Plan\n      prose\n<table><tr><td>Outside</td></tr></table>", ["bulletList", "table"]],
])("round41 list recovery preserves real block boundaries: %s", (source, types) => {
  const result = importMarkdown(source, "boundary.md");
  expect(result.json.content?.map((node) => node.type)).toEqual(types);
  expect(schema.nodeFromJSON(result.json.content?.at(-1)).textContent).toBe("Outside");
});

it.each([
  "- ",
  "4. ",
  "- [ ] ",
  "> ",
  "> - ",
  "> > - ",
])("round41 boundary probes distinguish lazy underlines from tables inside %s", (prefix) => {
  const result = importMarkdown(`${prefix}Plan\n      prose\nContinued\n--`, "underline.md");
  expect(result.skipped).toEqual([]);
  expect(result.json.content).toHaveLength(1);
  const node = schema.nodeFromJSON(result.json);
  expect(node.textContent).toBe("Plan\nprose\nContinued\n--");
  node.descendants((child) => expect(["heading", "table"]).not.toContain(child.type.name));
});

it("round41 real GFM tables still interrupt an indented list paragraph", () => {
  const result = importMarkdown("- Plan\n      prose\nA|B\n-| -\n1|2", "table.md");
  expect(result.json.content?.map((node) => node.type)).toEqual(["bulletList", "table"]);
});

it.each([
  "<span>Inline</span>",
  "<SPAN>Inline</SPAN>",
  "    <table><tr><td>Indented</td></tr></table>",
])("round41 noninterrupting HTML keeps lazy quotation attribution: %s", (html) => {
  const result = importMarkdown(`> Quote\n ${html}\nContinued`, "inline.md");
  expect(result.json.content).toHaveLength(1);
  expect(result.json.content?.[0]?.type).toBe("blockquote");
  expect(schema.nodeFromJSON(result.json).textContent).toBe(
    `Quote\n${html.includes("Indented") ? "Indented" : "Inline"}\nContinued`,
  );
});

it.each([
  true,
  false,
])("round41 linked images preserve native navigation only in view mode (initial editable %s)", (editable) => {
  const editor = new Editor({
    extensions,
    editable,
    content: '<a href="https://example.org/map"><img src="https://pod.test/map.png" alt="Map"></a>',
  });
  try {
    for (const mode of [editable, !editable, editable]) {
      editor.setEditable(mode, false);
      const anchor = editor.view.dom.querySelector("a") as HTMLAnchorElement;
      expect(anchor.href).toBe("https://example.org/map");
      // Native Enter activation generates a click with detail 0. Observe the
      // default action before cancelling it so jsdom never tries navigation.
      for (const detail of [1, 0]) {
        let cancelled: boolean | undefined;
        editor.view.dom.addEventListener(
          "click",
          (event) => {
            cancelled = event.defaultPrevented;
            event.preventDefault();
          },
          { once: true },
        );
        anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
        expect(cancelled).toBe(mode);
      }
    }
  } finally {
    editor.destroy();
  }
});

it.each([
  true,
  false,
])("round41 checklist controls expose disabled view mode and follow permission changes (initial editable %s)", (editable) => {
  const editor = new Editor({
    extensions,
    editable,
    content:
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Plan</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul></li></ul>',
  });
  try {
    expect(
      [...editor.view.dom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(
        (input) => input.disabled,
      ),
    ).toEqual([!editable, !editable]);
    for (const mode of [editable, !editable, editable]) {
      editor.setEditable(mode, false);
      const checkboxes = [
        ...editor.view.dom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      ];
      expect(checkboxes).toHaveLength(2);
      expect(checkboxes.map((input) => input.disabled)).toEqual([!mode, !mode]);
      expect(checkboxes.map((input) => input.checked)).toEqual([false, true]);
      if (!mode) {
        const before = editor.getJSON();
        for (const input of checkboxes) input.click();
        expect(editor.getJSON()).toEqual(before);
        expect(checkboxes.map((input) => input.checked)).toEqual([false, true]);
      }
    }
    editor.setEditable(false, false);
    editor.commands.setContent(
      '<ul data-type="taskList"><li data-type="taskItem"><p>New task</p></li></ul>',
    );
    expect(
      editor.view.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled,
    ).toBe(true);
  } finally {
    editor.destroy();
  }
});
