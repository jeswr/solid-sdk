// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkSkills, renderIndex } from "../scripts/check-skills.mjs";

const checker = fileURLToPath(new URL("../scripts/check-skills.mjs", import.meta.url));
const fixtures = fileURLToPath(new URL("./fixtures/check-skills/valid", import.meta.url));
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "check-skills-"));
  dirs.push(root);
  cpSync(fixtures, root, { recursive: true });
  return root;
}

function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function skill({
  name = "alpha",
  description = "Use when testing skills.",
  body = "",
  extra = "",
} = {}) {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n${body}`;
}

function cli(root, ...args) {
  return spawnSync(process.execPath, [checker, "--root", root, ...args], { encoding: "utf8" });
}

describe("skill validation", () => {
  it("includes shared, internal, and package skills and accepts YAML folded scalars", () => {
    const result = checkSkills(fixture(), { write: true });
    expect(result.errors).toEqual([]);
    expect(result.skills.map(({ name }) => name)).toEqual(["widget", "alpha"]);
    expect(result.skills.find(({ name }) => name === "alpha").description).toBe(
      "Use when checking fixtures, including folded YAML descriptions.",
    );
  });

  it.each([
    ["absent frontmatter", "# Skill", "frontmatter must be present"],
    ["unclosed frontmatter", "---\nname: alpha\n", "frontmatter must be present"],
    ["bad YAML", "---\nname: [alpha\n---\n", "invalid YAML frontmatter"],
    [
      "duplicate YAML keys",
      `${skill()} `.replace("name: alpha", "name: alpha\nname: alpha"),
      "invalid YAML frontmatter",
    ],
    ["non-mapping YAML", "---\n- alpha\n---\n", "frontmatter must be a mapping"],
    ["null YAML", "---\n# empty\n---\n", "frontmatter must be a mapping"],
    ["wrong name", skill({ name: "other" }), "name must equal"],
    ["non-string name", skill({ name: "123" }), "name must equal"],
    ["missing name", "---\ndescription: Use when testing.\n---\n", "name must equal"],
    ["missing description", "---\nname: alpha\n---\n", "description must be a string"],
    ["non-string description", skill({ description: "42" }), "description must be a string"],
    ["wrong prefix", skill({ description: "use when testing." }), "description must be a string"],
    [
      "long description",
      skill({ description: `Use when ${"a".repeat(1016)}` }),
      "description exceeds 1024",
    ],
    ["long body", skill({ body: `${"line\n".repeat(501)}` }), "body exceeds 500 lines (501)"],
  ])("rejects %s", (_label, text, message) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", text);
    expect(checkSkills(root, { write: true }).errors.join("\n")).toContain(message);
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
  });

  it("accepts exact description/body limits, Unicode characters, CRLF, and BOM", () => {
    const root = fixture();
    const text = skill({
      description: `Use when ${"😀".repeat(1015)}`,
      body: "line\n".repeat(500),
    });
    put(root, "skills/alpha/SKILL.md", `\uFEFF${text.replaceAll("\n", "\r\n")}`);
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it("requires shared skill entry points but ignores package directories without skills", () => {
    const root = fixture();
    mkdirSync(join(root, "skills/empty"));
    mkdirSync(join(root, "packages/no-skill"));
    expect(checkSkills(root).errors).toEqual(["skills/empty/SKILL.md: missing SKILL.md"]);
  });

  it("rejects duplicate names across shared and package skills", () => {
    const root = fixture();
    put(root, "packages/alpha/SKILL.md", skill());
    expect(checkSkills(root).errors.join("\n")).toContain(
      "skills/alpha/SKILL.md: duplicate skill name (also in packages/alpha/SKILL.md)",
    );
  });

  it("applies directory and description checks to package skills", () => {
    const root = fixture();
    put(root, "packages/widget/SKILL.md", skill({ name: "alias", description: "Wrong prefix" }));
    const errors = checkSkills(root).errors.join("\n");
    expect(errors).toContain("packages/widget/SKILL.md: name must equal");
    expect(errors).toContain("packages/widget/SKILL.md: description must be");
  });

  it.each([
    "[inline](missing.md)",
    "![image](missing.png)",
    "[reference][doc]\n\n[doc]: missing.md",
    "[unused]: missing.md",
    '<a href="missing.md">HTML link</a>',
    '<img src="missing.png">',
    "[encoded](references/miss&#105;ng.md)",
    "[reference][doc]\n\n[doc]: references/miss&#x69;ng.md",
    '<a href="missing&copy;.md">encoded HTML link</a>',
    "[nested](references/missing(file).md)",
    "[invalid](bad%ZZ.md)",
  ])("rejects unresolved relative links: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root).errors.join("\n")).toContain("relative link");
  });

  it("resolves encoded paths, queries and fragments; ignores links in code and external URLs", () => {
    const root = fixture();
    put(root, "skills/alpha/references/space (name).md", "# Guide\n");
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        body: [
          "[guide](<references/space (name).md>)",
          "![encoded](references/space%20%28name%29.md?raw=1#section)",
          "[query](?view=1) [anchor](#section) [root](/docs)",
          "[external](https://example.invalid/missing) [mail](mailto:example@example.invalid)",
          "[protocol relative](//example.invalid/missing)",
          "`[code](missing.md)`",
          "```md\n[fenced](missing.md)\n```",
          "    [indented](missing.md)",
          "<!-- [comment](missing.md) -->",
        ].join("\n\n"),
      }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    ["[decimal](references/gu&#105;de.md)", "guide.md"],
    ["[hexadecimal](references/gu&#x69;de.md)", "guide.md"],
    ["[uppercase hexadecimal](references/gu&#X69;de.md)", "guide.md"],
    ["![image](references/gu&#105;de.md)", "guide.md"],
    ["[reference][doc]\n\n[doc]: references/gu&#105;de.md", "guide.md"],
    ['<a href="references/gu&#105;de.md">guide</a>', "guide.md"],
    ["<img src='references/gu&#x69;de.md'>", "guide.md"],
    ["[named](references/a&amp;b.md)", "a&b.md"],
    ["[named Unicode](references/&copy;.md)", "©.md"],
    ["[multiple code points](references/&NotEqualTilde;.md)", "≂̸.md"],
    ["[query](references/guide.md&#63;raw=1&#35;section)", "guide.md"],
    ["[named query](references/guide.md&quest;raw=1&num;section)", "guide.md"],
    ["[URI encoding](references/space&#37;20name.md)", "space name.md"],
    ["[literal hash](references/hash%23name.md)", "hash#name.md"],
    ["[single pass](references/&amp;copy;.md)", "&copy;.md"],
    ["[unknown reference](references/&unknown;.md)", "&unknown;.md"],
    ["[unknown prototype name](references/&toString;.md)", "&toString;.md"],
    ["[invalid code point](references/&#x110000;.md)", "�.md"],
    ["[surrogate](references/&#xD800;.md)", "�.md"],
    ["[null](references/&#0;.md)", "�.md"],
    ["[C1 decimal](references/&#128;.md)", "€.md"],
    ["[C1 hexadecimal](references/&#x80;.md)", "€.md"],
  ])("resolves character references in link destinations: %s", (body, filename) => {
    const root = fixture();
    put(root, `skills/alpha/references/${filename}`, "# Guide\n");
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it("decodes character references before classifying external and fragment links", () => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        body: [
          "[external](https&colon;//example.invalid/missing.md)",
          "[anchor](&num;section) [query](&quest;view=1) [root](&sol;docs)",
          '<a href="https&#58;//example.invalid/missing.md">external</a>',
        ].join("\n\n"),
      }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    ['<a href="references/gu&#105de.md">guide</a>', "guide.md"],
    ["<img src='references/gu&#x69g.md'>", "guig.md"],
    ["<a href=references/gu&#105de.md>guide</a>", "guide.md"],
    ['<a href="references/gu&#000000000000105;de.md">guide</a>', "guide.md"],
    ['<a href="references/gu&#x000000000000069;de.md">guide</a>', "guide.md"],
    ['<a href="references/&#128.md">guide</a>', "€.md"],
    ['<a href="references/&#x80.md">guide</a>', "€.md"],
    ['<a href="references/&#x110000.md">guide</a>', "�.md"],
    ['<a href="references/&#55296.md">guide</a>', "�.md"],
    ['<a href="references/&#0.md">guide</a>', "�.md"],
    ['<a href="references/&#9999999999999999999999999.md">guide</a>', "�.md"],
    ['<a href="references/&copy.md">guide</a>', "©.md"],
    ['<a href="references/a&amp!b.md">guide</a>', "a&!b.md"],
    ['<a href="references/&AMP.md">guide</a>', "&.md"],
    ['<a href="references/&not.md">guide</a>', "¬.md"],
    ['<a href="references/&copy=.md">guide</a>', "&copy=.md"],
    ['<a href="references/&copycat.md">guide</a>', "&copycat.md"],
    ['<a href="references/&notin.md">guide</a>', "&notin.md"],
    ['<a href="references/&apos.md">guide</a>', "&apos.md"],
    ['<a href="references/&unknown.md">guide</a>', "&unknown.md"],
    ['<a href="references/&toString.md">guide</a>', "&toString.md"],
    ['<a href="references/guide.md&#63raw=1">guide</a>', "guide.md"],
    ['<a href="references/&amp;copy.md">guide</a>', "&copy.md"],
  ])("uses HTML attribute character-reference rules: %s", (body, filename) => {
    const root = fixture();
    put(root, `skills/alpha/references/${filename}`, "# Guide\n");
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    '<a href="&#32https&#58//example.invalid/missing.md&#9">external</a>',
    '<img src="&#x20https&#X3A//example.invalid/missing.png&#10">',
    '<a href="&#32references/gu&#105de.md&#13">guide</a>',
    "[doc]: &#32https&#58//example.invalid/missing.md&#9;",
  ])("normalizes semicolonless references before URL classification: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    '<!-- <a href="old-guide.md">old guide</a> -->',
    '<!--\n<a href="old-guide.md">old guide</a>\n<img src="old-image.png">\n-->',
    'See <!-- <img src="old-image.png"> --> the [guide](references/guide.md).',
    '<div>\n<!-- <a href="old-guide.md">old guide</a> -->\n<a href="references/guide.md">guide</a>\n</div>',
    '<!-- <a href="old-guide.md">unclosed comment',
  ])("ignores HTML links in comments: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    '<svg><![CDATA[<a href="missing.md">literal</a>]]></svg>',
    '<SVG><g><![CDATA[<image href="missing.png"/>]]></g></SVG>',
    '<svg>\n<![CDATA[\n<a href="missing.md">literal</a>\n\n<img src="missing.png">\n]]>\n</svg>',
    '<svg><![CDATA[</svg><a href="missing.md">literal</a>]]></svg>',
    '<svg>\n<![CDATA[<a href="missing.md">literal to EOF</a>',
    '<svg><![CDATA[<a href="missing.md">literal</a>]]><![CDATA[<a href="other.md">literal</a>]]></svg>',
    '<math><mtext><![CDATA[<a href="missing.md">literal</a>]]></mtext></math>',
    '<svg><foreignObject><![CDATA[<a href="missing.md">literal</a>]]></foreignObject></svg>',
    '<svg><title><![CDATA[<a href="missing.md">literal</a>]]></title></svg>',
    'Example: <svg><![CDATA[<a href="missing.md">literal</a>]]></svg>',
    "<svg>\n<![CDATA[\n\n[unused]: missing.md\n\n]]>\n</svg>",
  ])("ignores apparent links inside foreign CDATA: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    `<!DOCTYPE html PUBLIC '<a href="missing.md">literal</a>'>`,
    `<!doctype html SYSTEM '<img src="missing.png">'>`,
    '<div>\n<!CUSTOM <a href="missing.md">literal</a>>\n</div>',
    '<div>\n<![CDATA[<a href="missing.md">literal</a>]]>\n</div>',
    '<div>\n<svg><![cdata[<a href="missing.md">literal</a>]]></svg>\n</div>',
  ])("consumes markup declarations without extracting apparent links: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    '<svg><![CDATA[<a href="ignored.md">literal</a>]]><a href="missing.md">broken</a></svg>',
    '<svg><![CDATA[<a href="ignored.md">literal</a>]]]><a href="missing.md">broken</a></svg>',
    '<svg><![CDATA[</svg><textarea>]]><a href="missing.md">broken</a></svg>',
    '<div>\n<!DOCTYPE html><a href="missing.md">broken</a>\n</div>',
    '<div>\n<!CUSTOM <a href="ignored.md">literal</a>><a href="missing.md">broken</a>\n</div>',
    '<div>\n<![CDATA[<a href="ignored.md">literal</a><a href="missing.md">broken</a>]]>\n</div>',
    '<svg><foreignObject><div><![CDATA[<a href="ignored.md">literal</a><a href="missing.md">broken</a>]]></div></foreignObject></svg>',
    '<div>\n<svg><![cdata[<a href="ignored.md">literal</a><a href="missing.md">broken</a>]]></svg>\n</div>',
    '<svg>&lt;![CDATA[<a href="missing.md">broken</a>]]></svg>',
    "<svg><![CDATA[\n[ignored]: ignored.md\n]]></svg>\n\n[active]: missing.md",
  ])("checks active links after CDATA and declaration boundaries: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  it("still checks active HTML links beside comments", () => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        body: '<div>\n<!-- <a href="old-guide.md">old guide</a> -->\n<a href="missing.md">active link</a>\n<!-- <img src="old-image.png"> -->\n</div>',
      }),
    );
    expect(checkSkills(root).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  it.each([
    '<a href="references/guide.md" title="Set href=guide.md">guide</a>',
    "<a title='Set src=missing.png and href=missing.md' href='references/guide.md'>guide</a>",
    '<img alt="Set href=missing.md > src=missing.png" src="references/guide.md">',
    '<a data-href="missing.md" href=references/guide.md>guide</a>',
    '<div>Text href=missing.md and src=missing.png <a href="references/guide.md">guide</a></div>',
    '<a title="<!-- href=missing.md -->" href="references/guide.md">guide</a>',
  ])("checks only actual HTML URL attributes: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    '<a title="<!--" href="missing.md">broken</a>',
    "<img alt='<!--' src='missing.png'>",
    '<div>\n<a title="<!-- >" HREF = missing.md>broken</a>\n<!-- actual comment -->\n</div>',
    '<a title="<!--" href="missing.md">broken</a><!-- -->',
    '<a title="<!-- -->" href="missing.md">broken</a>',
    '<a title="Set href=references/guide.md" href="missing.md">broken</a>',
  ])("checks active HTML URLs after quoted attribute contents: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  const textElements = [
    "textarea",
    "title",
    "script",
    "style",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
  ];

  it.each(textElements)("preserves HTML %s text state across inline Markdown tokens", (tag) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        body: `Example: <${tag}><a href="missing.md">literal text</a><img src="missing.png"></${tag}-extra><a href="also-missing.md">still text</a></${tag}> <a href="references/guide.md">guide</a>`,
      }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each(textElements)("preserves HTML %s text state across blank lines", (tag) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        body: `<div>\n<${tag}>\n\n<a href="missing.md">literal text</a>\n\n![literal image](missing.png)\n\n</${tag}>\n<a href="references/guide.md">guide</a>\n</div>`,
      }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each(textElements)("checks links after HTML %s closes in a later token", (tag) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        body: `Example: <${tag}><a href="ignored.md">literal text</a></${tag}> <a href="missing.md">broken</a>`,
      }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  it.each(textElements)("keeps unclosed HTML %s text state across tokens to the end", (tag) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ body: `Example: <${tag}>literal\n\n<a href="missing.md">still text</a>` }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each(textElements)("checks active links after the end of HTML %s content", (tag) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        body: `<div>\n<${tag}><a title="</${tag}>\n<a href="missing.md">broken</a>\n</div>`,
      }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  it.each(textElements)("ignores apparent tags inside HTML %s content", (tag) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        body: `<div>\n<${tag}><a href="missing.md"><img src="missing.png"></${tag}-extra><a href="also-missing.md"></${tag}>\n<a href="references/guide.md">guide</a>\n</div>`,
      }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each(textElements)("treats unclosed HTML %s content as text to the end", (tag) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ body: `<div>\n<${tag}><a href="missing.md"><img src="missing.png">\n</div>` }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    '<div>\n<TEXTAREA><a title="</TeXtArEa >\n<a href="missing.md">broken</a>\n</div>',
    '<div>\n<textarea/><a title="</textarea>\n<a href="missing.md">broken</a>\n</div>',
    '<div>\n<textarea><!-- </textarea>\n<a href="missing.md">broken</a>\n</div>',
    '<div>\n<style>&lt;/style><a title="</style\n>\n<a href="missing.md">broken</a>\n</div>',
    '<div>\n<script src="missing.js"><a href="ignored.md"></script>\n</div>',
  ])("respects HTML text boundaries and opening URL attributes: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  it.each([
    "<svg><title /></svg>\n\n[broken](missing.md)",
    "<svg><title/></svg>\n\n![broken](missing.png)",
    '<SVG><TITLE /></SVG>\n\n<a href="missing.md">broken</a>',
    "<svg><g><title /></g></svg>\n\n[broken](missing.md)",
    "<svg><style /></svg>\n\n[broken](missing.md)",
    "<svg><script /></svg>\n\n[broken](missing.md)",
    "<svg><title>caption</title></svg>\n\n[broken](missing.md)",
    '<svg><title><a href="missing.md">broken</a></title></svg>',
    '<svg><foreignObject><textarea>literal</textarea><a href="missing.md">broken</a></foreignObject></svg>',
    "<svg><foreignObject /><title /></svg>\n\n[broken](missing.md)",
    '<svg><desc><svg><title /></svg><a href="missing.md">broken</a></desc></svg>',
    '<svg><div><title>caption</title><a href="missing.md">broken</a></div>',
    "<math><title /></math>\n\n[broken](missing.md)",
    '<math><mtext><svg><title /></svg><a href="missing.md">broken</a></mtext></math>',
    '<math><annotation-xml encoding="text/html"><textarea>literal</textarea><a href="missing.md">broken</a></annotation-xml></math>',
  ])("checks links across foreign element boundaries: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  it.each([
    "<title />\n\n[ignored](missing.md)",
    "<svg /><title />\n\n[ignored](missing.md)",
    "<svg><foreignObject><textarea/>\n\n[ignored](missing.md)\n\n</textarea></foreignObject></svg>",
    "<svg><desc><title/>\n\n[ignored](missing.md)\n\n</title></desc></svg>",
    "<svg><div><textarea/>\n\n[ignored](missing.md)\n\n</textarea></div>",
    "<math><mtext><textarea/>\n\n[ignored](missing.md)\n\n</textarea></mtext></math>",
    '<math><annotation-xml encoding="TEXT&#47;HTML"><textarea/>\n\n[ignored](missing.md)\n\n</textarea></annotation-xml></math>',
  ])("preserves HTML text state at foreign integration points: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    ...textElements.map((tag) => `Example: <${tag}>\n\n[unused]: missing.md\n\n</${tag}>`),
    "Example: <textarea>\n\n[unused]: missing.md\n\n</textarea>\n\n[guide]: references/guide.md",
    "```md\n[unused]: missing.md\n```",
  ])("ignores inactive reference definitions in their HTML or code context: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    ...textElements.map(
      (tag) =>
        `Example: <${tag}>\n\n[ignored]: references/guide.md\n\n</${tag}>\n\n[broken]: missing.md`,
    ),
    "Example: <textarea>\n\n[broken]: missing.md\n\n</textarea>\n\n[active][broken]",
    "Example: <!--\n\n[ignored]: missing.md\n\n-->\n\n[active]: missing.md",
    "<svg><title /></svg>\n\n[broken]: missing.md",
    "[unused]: &#32;missing.md&#9;",
  ])("checks active reference definitions and uses after HTML content: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  it.each([
    "[doc]: &#32;https://example.invalid/guide.md",
    "[doc]: &#32;https://example.invalid/guide.md\n\n[doc]",
    "[doc]: &#9;references/guide.md&#32;",
    "[doc]: &#9;references/guide.md&#32;\n\n[doc]",
    "[doc]: &#32;//example.invalid/guide.md&#10;",
    "[doc]: &#32;#section&#32;",
    "[doc]: &#32;?view=1&#32;",
    "[doc]: &#32;/docs&#32;",
    "[doc]: &#32;&#9;",
  ])("normalizes decoded reference destinations consistently: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    '<a href=" references/guide.md ">guide</a>',
    "<img src=' \t\nreferences/guide.md\r\f '>",
    '<a href=" https://example.invalid/missing.md ">external</a>',
    "<img src=' \t//example.invalid/missing.png\n '>",
    '<a href=" &#32;references/gu&#105;de.md&#9; ">guide</a>',
    '<a href="&#10;https&#58;//example.invalid/missing.md&#13;">external</a>',
    '<a href=" #section ">anchor</a>',
    '<a href=" ?view=1 ">query</a>',
    '<a href=" /docs ">root</a>',
    '<a href=" \t\n ">empty</a>',
  ])("normalizes surrounding whitespace in HTML URLs: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it("preserves internal and percent-encoded spaces in HTML filenames", () => {
    const root = fixture();
    put(root, "skills/alpha/references/space name.md", "# Guide\n");
    put(root, "skills/alpha/references/ guide .md", "# Guide\n");
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        body: '<a href=" references/space name.md ">guide</a> <img src=" references/%20guide%20.md ">',
      }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    '<a href=" missing.md ">broken</a>',
    "<img src='&#32;missing.png&#32;'>",
  ])("still rejects unresolved HTML URLs after trimming: %s", (body) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  it.each([
    "skills/alpha/references/guide.md",
    "packages/widget/references/nested/guide.md",
  ])("checks links in companion Markdown %s", (path) => {
    const root = fixture();
    put(root, path, "[broken](missing.md)");
    expect(checkSkills(root).errors.join("\n")).toContain(`${path}: relative link`);
  });

  it("scans shared scripts and assets without parsing code as Markdown links", () => {
    const root = fixture();
    put(root, "skills/alpha/scripts/example.js", "// [example](not-a-markdown-link.md)\n");
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
    put(root, "skills/alpha/assets/example.txt", "TOKEN=synthetic-asset-value\n");
    expect(checkSkills(root).errors.join("\n")).toContain(
      "assets/example.txt: line 1: possible environment secret",
    );
  });

  it.each([
    "skills/alpha/.env",
    "skills/alpha/.private/credentials.txt",
    "skills/alpha/scripts/.config",
    "skills/alpha/assets/.private/nested/config.txt",
    "packages/widget/references/.env",
    "packages/widget/references/.private/nested/config.txt",
  ])("scans hidden companions for secrets and forbidden paths: %s", (path) => {
    const root = fixture();
    const index = "Previously generated index\n";
    put(root, "skills/INDEX.md", index);
    put(root, path, "TOKEN=fixture-credential-value\n/Users/someone/private\n");
    expect(checkSkills(root, { write: true }).errors).toEqual([
      `${path}: line 2: absolute user path is forbidden`,
      `${path}: line 1: possible environment secret (value omitted)`,
    ]);
    expect(readFileSync(join(root, "skills/INDEX.md"), "utf8")).toBe(index);
  });

  it.each([
    "skills/alpha/.private/guide.md",
    "packages/widget/references/.guide.md",
  ])("checks relative links in hidden Markdown companions: %s", (path) => {
    const root = fixture();
    put(root, path, "[broken](missing.md)");
    expect(checkSkills(root, { write: true }).errors).toEqual([
      `${path}: relative link does not resolve (target omitted)`,
    ]);
  });

  it("keeps hidden-file discovery within the companion scope", () => {
    const root = fixture();
    for (const path of [
      "skills/.config",
      "packages/widget/.env",
      "packages/widget/scripts/.private/config.txt",
      "packages/no-skill/references/.env",
    ]) {
      put(root, path, "TOKEN=fixture-credential-value\n/Users/someone/private\n");
    }
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    "skills/alpha/SKILL.md",
    "skills/alpha/references/guide.md",
    "packages/widget/SKILL.md",
  ])("rejects absolute user paths in %s", (path) => {
    const root = fixture();
    put(
      root,
      path,
      skill({ name: path.includes("widget") ? "widget" : "alpha", body: "/Users/someone/private" }),
    );
    expect(checkSkills(root).errors.join("\n")).toContain("absolute user path is forbidden");
  });

  it.each([
    ["description", '"Use when checking \\u002fUsers/private-fixture/path."'],
    ["description", '"Use when checking /Us\\x65rs/private-fixture/path."'],
    ["description", '"Use when checking /Us\\\n  ers/private-fixture/path."'],
    ["name", '"\\u002fUsers/private-fixture/path"'],
  ])("rejects forbidden paths in decoded %s: %s", (field, encoded) => {
    const root = fixture();
    const indexPath = join(root, "skills/INDEX.md");
    put(root, "skills/alpha/SKILL.md", skill({ [field]: encoded }));
    for (const previousIndex of [undefined, "Previously generated index\n"]) {
      if (previousIndex !== undefined) put(root, "skills/INDEX.md", previousIndex);
      for (const args of [[], ["--write"]]) {
        const result = cli(root, ...args);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("decoded metadata: absolute user path is forbidden");
        expect(result.stderr).not.toContain("private-fixture");
        expect(result.stdout).toBe("");
        if (previousIndex === undefined) expect(existsSync(indexPath)).toBe(false);
        else expect(readFileSync(indexPath, "utf8")).toBe(previousIndex);
      }
    }
  });

  // Synthetic examples only; construct credential-shaped strings so the test source contains no keys.
  const secrets = [
    ["private key", `-----BEGIN ${"RSA PRIVATE KEY"}-----`],
    ["API key", `sk-${"a".repeat(24)}`],
    ["GitHub token", `ghp_${"a".repeat(36)}`],
    ["AWS key", `AKIA${"A".repeat(16)}`],
    ["AWS key", `ASIA${"A".repeat(16)}`],
    ["JWT", ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJmaXh0dXJlIn0", "signature"].join(".")],
    ["Authorization header", "Authorization: Bearer fixture-credential-value"],
    ["Authorization header", "Authorization: DPoP fixture-credential-value"],
    ["Authorization header", "Authorization: Basic fixture-credential-value"],
    ["Authorization header", '"Authorization": "Bearer fixture-credential-value"'],
    ["Authorization header", "'authorization': 'DPoP fixture-credential-value'"],
    ["environment secret", "TOKEN=fixture-credential-value"],
    ["environment secret", 'export AWS_SECRET_ACCESS_KEY="fixture-credential-value"'],
  ];
  it.each(secrets)("rejects %s without echoing it", (category, value) => {
    const root = fixture();
    put(root, "skills/alpha/references/guide.md", `\n\n${value}\n`);
    const result = cli(root, "--write");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`line 3: possible ${category} (value omitted)`);
    expect(result.stderr).not.toContain(value);
    expect(result.stdout).toBe("");
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
  });

  it.each(
    secrets,
  )("rejects YAML-escaped %s before creating or replacing the index", (category, value) => {
    const root = fixture();
    const indexPath = join(root, "skills/INDEX.md");
    const escaped = [...value]
      .map((character) => `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`)
      .join("");
    // A decoded newline also exercises line-anchored environment-secret detection.
    const text = skill({ description: `"Use when checking metadata.\\n${escaped}"` });
    put(root, "skills/alpha/SKILL.md", text);
    for (const previousIndex of [undefined, "Previously generated index\n"]) {
      if (previousIndex !== undefined) put(root, "skills/INDEX.md", previousIndex);
      for (const args of [[], ["--write"]]) {
        const result = cli(root, ...args);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`decoded metadata: possible ${category} (value omitted)`);
        expect(result.stderr).not.toContain(value);
        expect(result.stderr).not.toContain(escaped);
        expect(result.stdout).toBe("");
        if (previousIndex === undefined) expect(existsSync(indexPath)).toBe(false);
        else expect(readFileSync(indexPath, "utf8")).toBe(previousIndex);
      }
    }
  });

  it("scans YAML-folded descriptions after decoding", () => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ description: ">-\n  Use when Authorization:\n  Bearer fixture-credential-value" }),
    );
    expect(checkSkills(root, { write: true }).errors).toContain(
      "skills/alpha/SKILL.md: decoded metadata: possible Authorization header (value omitted)",
    );
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
  });

  it("scans decoded names without exposing their values", () => {
    const root = fixture();
    const value = `sk-${"a".repeat(24)}`;
    put(root, "skills/alpha/SKILL.md", skill({ name: `"\\x73k-${"a".repeat(24)}"` }));
    const result = cli(root, "--write");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("decoded metadata: possible API key (value omitted)");
    expect(result.stderr).not.toContain(value);
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
  });

  it("allows decoded metadata containing explicit credential templates", () => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ description: '"Use when Authorization: Bearer <token>\\nTOKEN=your-token"' }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it("does not echo malformed frontmatter or link targets", () => {
    const root = fixture();
    const value = "private-fixture-value";
    put(root, "skills/alpha/SKILL.md", `---\nname: [${value}\n---\n[missing](${value}.md)`);
    const result = cli(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("invalid YAML frontmatter");
    expect(result.stderr).toContain("relative link");
    expect(result.stderr).not.toContain(value);
  });

  it("allows explicit credential templates and non-secret environment configuration", () => {
    const root = fixture();
    put(
      root,
      "skills/alpha/references/guide.md",
      [
        "Authorization: Bearer <token>",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
        "Authorization: DPoP ${accessToken}",
        "API_KEY=your-api-key",
        'TOKEN="[REDACTED]"',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
        "PASSWORD=${PASSWORD}",
        "PORT=3000",
        "ISSUER=https://example.invalid",
      ].join("\n"),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });
});

describe("generated skill index", () => {
  it("checks missing/stale indexes without writing and offers an explicit generation mode", () => {
    const root = fixture();
    expect(cli(root).status).toBe(1);
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
    expect(cli(root, "--write").status).toBe(0);
    const path = join(root, "skills/INDEX.md");
    const index = readFileSync(path, "utf8");
    expect(index).toContain(
      "| alpha | Use when checking fixtures, including folded YAML descriptions.",
    );
    expect(index).toContain("[skills/alpha/SKILL.md](alpha/SKILL.md)");
    expect(index).toContain("[packages/widget/SKILL.md](../packages/widget/SKILL.md)");
    expect(index.indexOf("| alpha |")).toBeLessThan(index.indexOf("| widget |"));
    expect(cli(root).status).toBe(0);
    expect(cli(root, "--write").status).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(index);
    put(
      root,
      "packages/widget/SKILL.md",
      skill({ name: "widget", description: "Use when changed." }),
    );
    expect(cli(root).stderr).toContain("index is missing or stale");
    expect(readFileSync(path, "utf8")).toBe(index);
    expect(cli(root, "--write").status).toBe(0);
    expect(readFileSync(path, "utf8")).toContain("Use when changed.");
    rmSync(join(root, "packages/widget"), { recursive: true });
    put(root, "skills/alpha/SKILL.md", skill());
    expect(cli(root).stderr).toContain("index is missing or stale");
    expect(cli(root, "--write").status).toBe(0);
    expect(readFileSync(path, "utf8")).not.toContain("| widget |");
    put(root, "skills/new-skill/SKILL.md", skill({ name: "new-skill" }));
    expect(cli(root).stderr).toContain("index is missing or stale");
    expect(cli(root, "--write").status).toBe(0);
    expect(readFileSync(path, "utf8")).toContain("| new-skill |");
  });

  it("renders one-line descriptions and escapes Markdown table and HTML characters", () => {
    const index = renderIndex([
      { name: "alpha", description: "Use when A | B\n<test>&", path: "skills/alpha/SKILL.md" },
    ]);
    expect(index).toContain("Use when A &#124; B &lt;test>&amp;");
  });

  it("imports without executing the CLI", () => {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `await import(${JSON.stringify(checker)})`],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toBe("");
  });
});
