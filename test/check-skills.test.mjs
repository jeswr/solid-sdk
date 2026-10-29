// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { spawnSync } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
  return runNode([checker, "--root", root, ...args]);
}

function runNode(args) {
  const output = mkdtempSync(join(tmpdir(), "check-skills-cli-"));
  dirs.push(output);
  const stdoutPath = join(output, "stdout");
  const stderrPath = join(output, "stderr");
  const stdout = openSync(stdoutPath, "w");
  const stderr = openSync(stderrPath, "w");
  let result;
  try {
    // File descriptors also capture CLI output in environments that restrict subprocess pipes.
    result = spawnSync(process.execPath, args, { stdio: ["ignore", stdout, stderr] });
    if (result.error) throw result.error;
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  return {
    ...result,
    stdout: readFileSync(stdoutPath, "utf8"),
    stderr: readFileSync(stderrPath, "utf8"),
  };
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

  it.each([
    "skills/alpha/SKILL.md",
    "packages/widget/SKILL.md",
  ])("rejects an entry point that is a directory: %s", (path) => {
    const root = fixture();
    rmSync(join(root, path));
    mkdirSync(join(root, path));
    expect(checkSkills(root, { write: true }).errors).toEqual([
      `${path}: SKILL.md must be a regular file`,
    ]);
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
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

  it.each(textElements)("preserves inline HTML %s state across tokens", (tag) => {
    const root = fixture();
    const body = `Example: <${tag}><a href="missing.md">literal text</a></${tag}>`;
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ body: `${body} <a href="outside.md">active link</a>` }),
    );
    expect(checkSkills(root).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  it.each(textElements)("preserves HTML %s state across blank lines", (tag) => {
    const root = fixture();
    const body = `<div>\n<${tag}>\n\n<a href="missing.md">literal text</a>\n\n</${tag}>\n</div>`;
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ body: `${body}\n\n<a href="outside.md">active link</a>` }),
    );
    expect(checkSkills(root).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  it("preserves HTML comments across tokens, including a plain text closing delimiter", () => {
    const root = fixture();
    const body = '<div>\n<!-- comment\n\n<a href="missing.md">comment</a>\n\n-->\n</div>';
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ body: `${body}\n\n<a href="outside.md">active link</a>` }),
    );
    expect(checkSkills(root).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
  });

  it("ignores HTML links and text-state delimiters in fenced, indented, and inline code", () => {
    const root = fixture();
    const body = [
      '`<textarea><a href="inline.md">literal</a><!--`',
      '```html\n<style><a href="fenced.md">literal</a><!--\n```',
      '    <title><a href="indented.md">literal</a><!--',
      '<a href="references/guide.md">guide</a>',
    ].join("\n\n");
    put(root, "skills/alpha/SKILL.md", skill({ body }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ body: `${body}\n\n<a href="outside.md">active link</a>` }),
    );
    expect(checkSkills(root).errors).toEqual([
      "skills/alpha/SKILL.md: relative link does not resolve (target omitted)",
    ]);
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
    ["shared hidden file", "skills/alpha/.env", "skills/alpha"],
    ["shared hidden directory", "skills/alpha/.private/guide.md", "skills/alpha"],
    ["package hidden file", "packages/widget/references/.env", "packages/widget"],
    ["package hidden directory", "packages/widget/references/.private/guide.md", "packages/widget"],
  ])("scans secrets and local paths in a %s", (_label, path, skillDir) => {
    const root = fixture();
    const companion = path.slice(skillDir.length + 1);
    put(
      root,
      `${skillDir}/SKILL.md`,
      skill({ name: skillDir.split("/").at(-1), body: `[companion](${companion})` }),
    );
    for (const [value, rule] of [
      ["TOKEN=fixture-credential-value", "possible environment secret (value omitted)"],
      ["/home/someone/private", "absolute user path is forbidden"],
    ]) {
      put(root, path, value);
      const result = cli(root, "--write");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`line 1: ${rule}`);
      expect(result.stderr.includes(value)).toBe(false);
      expect(result.stdout).toBe("");
      expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
    }
  });

  it.each([
    ["shared file", "skills/alpha/.linked.md", "file"],
    ["shared directory", "skills/alpha/.linked", "directory"],
    ["package file", "packages/widget/references/.linked.md", "file"],
    ["package directory", "packages/widget/references/.linked", "directory"],
    ["package references", "packages/widget/references", "directory"],
    ["skill entry point", "skills/alpha/SKILL.md", "file"],
    ["shared skill directory", "skills/alpha", "directory"],
    ["package directory", "packages/widget", "directory"],
    ["shared root", "skills", "directory"],
    ["package root", "packages", "directory"],
    ["dangling companion", "skills/alpha/.linked.md", "missing"],
  ])("refuses a symlink at a %s without reading its target", (_label, path, type) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill());
    const target = join(root, "unscanned", "target");
    if (type === "file") put(root, "unscanned/target", "TOKEN=fixture-credential-value");
    if (type === "directory")
      put(root, "unscanned/target/SKILL.md", "TOKEN=fixture-credential-value");
    rmSync(join(root, path), { recursive: true, force: true });
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(target, join(root, path));
    const result = cli(root, "--write");
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`${path}: symbolic links are forbidden (target omitted)\n`);
    expect(result.stderr.includes(target)).toBe(false);
    expect(result.stdout).toBe("");
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
  });

  it("keeps package source files outside the companion scanning scope", () => {
    const root = fixture();
    put(root, "packages/widget/src/.env", "TOKEN=fixture-credential-value");
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  const localPaths = [
    "/Users/someone/private",
    "/home/someone/private",
    "C:\\Users\\someone\\private",
    "file:///home/alice/x",
    '"/Users/alice/x"',
    "(/home/bob/y)",
    "C:\\Users\\carol",
    "C:/Users/carol",
    "file:///C:/Users/alice/private.txt",
    "file://localhost/C:/Users/alice/private.txt",
    String.raw`FILE://server/C:\Users\alice\private.txt`,
    "file://server/share/home/alice/private.txt",
    "file:/Users/alice/private.txt",
    "file:C:/Users/alice/private.txt",
    "**/home/alice/private.txt**",
    "_/Users/alice/private.txt_",
    "<code>/home/alice/private.txt</code>",
    "~/home/alice/x",
  ];
  it.each(
    [
      "skills/alpha/SKILL.md",
      "skills/alpha/references/guide.md",
      "packages/widget/SKILL.md",
    ].flatMap((path) => localPaths.map((value) => [path, value])),
  )("rejects absolute user paths in %s (%s)", (path, value) => {
    const root = fixture();
    put(root, path, skill({ name: path.includes("widget") ? "widget" : "alpha", body: value }));
    const errors = checkSkills(root).errors.join("\n");
    expect(errors).toContain("absolute user path is forbidden");
    expect(errors).not.toContain(value);
  });

  it.each([
    "https://example.org/home/start",
    "src/home/index.ts",
    "src/Users/index.ts",
    "./home/alice/x",
    "../home/alice/x",
    "a.b/home/x",
    "/var/home/alice/x",
    "//home/alice/x",
    String.raw`src\home/alice/x`,
    "~",
    "~/private",
    "https://example.org/Users/alice/x",
    "ftp://example.org/home/alice/x",
    "custom+scheme://example.org/path:/home/alice/x",
    "https://example.org/?path=/home/alice/x",
    "https://example.org/(/home/alice/x)",
    "https://example.org/C:/Users/carol",
    String.raw`https://example.org/C:\Users\carol`,
    "https://example.org/file:///C:/Users/carol",
    "https://example.org/file:///home/alice/x",
    "file+custom://example.org/home/alice/x",
    "filex://example.org/Users/alice/x",
    "prefixC:\\Users\\carol",
    "/home/",
    "/Users/",
  ])("allows public URLs, relative paths, and home-directory shorthand: %s", (value) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ description: JSON.stringify(`Use when reading ${value}`), body: value }),
    );
    put(root, "skills/alpha/references/guide.md", value);
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each(
    ["", " ", '"', "'", "(", "[", "=", ":", "`", "<", ">", "*", "_", "~", "]", "}", "!"].flatMap(
      (prefix) =>
        ["/home/alice/x", "/Users/alice/x", "C:/Users/alice/x", String.raw`C:\Users\alice\x`].map(
          (path) => [prefix, path],
        ),
    ),
  )("rejects absolute user paths after prefix %j: %s", (prefix, path) => {
    const root = fixture();
    put(root, "skills/alpha/references/guide.md", `${prefix}${path}`);
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/references/guide.md: line 1: absolute user path is forbidden",
    ]);
  });

  it.each(
    ["name", "description"].flatMap((field) => localPaths.map((value) => [field, value])),
  )("rejects YAML-escaped local paths in %s (%s) without publishing them", (field, value) => {
    const root = fixture();
    const indexPath = join(root, "skills/INDEX.md");
    const escaped = [...value]
      .map((character) => `\\x${character.codePointAt(0).toString(16).padStart(2, "0")}`)
      .join("");
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ [field]: `"${field === "description" ? "Use when reading " : ""}${escaped}"` }),
    );
    for (const previousIndex of [undefined, "Previously generated index\n"]) {
      if (previousIndex !== undefined) put(root, "skills/INDEX.md", previousIndex);
      for (const args of [[], ["--write"]]) {
        const result = cli(root, ...args);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
          "decoded metadata: absolute user path is forbidden (value omitted)",
        );
        expect(result.stderr).not.toContain(value);
        expect(result.stderr).not.toContain(escaped);
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
    // Escaped assignments must also be caught inline in the decoded description.
    const text = skill({ description: `"Use when checking metadata. ${escaped}"` });
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

  it.each(
    ["\n", "\r\n"].flatMap((newline) =>
      ["standalone", "inline"].flatMap((kind) =>
        [
          ["API_TOKEN=fixture-credential-value", "possible environment secret (value omitted)"],
          ...localPaths.map((value) => [value, "absolute user path is forbidden"]),
        ].map(([value, rule]) => [newline, kind, value, rule]),
      ),
    ),
  )("scans frontmatter comments (%j, %s, %s) with file line numbers", (newline, kind, value, rule) => {
    const root = fixture();
    const extra = kind === "standalone" ? `# ${value}\n` : `metadata: public-example # ${value}\n`;
    const text = skill({
      description: ">-\n  Use when checking\n  comment line numbers.",
      extra,
    });
    put(root, "skills/alpha/SKILL.md", `\uFEFF${text.replaceAll("\n", newline)}`);
    const result = cli(root, "--write");
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(`skills/alpha/SKILL.md: line 6: ${rule}\n`);
    expect(result.stderr).not.toContain(value);
    expect(result.stdout).toBe("");
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
  });

  const credentialNames = [
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "PASSWD",
    "PASS",
    "PWD",
    "KEY",
    "APIKEY",
    "CREDENTIAL",
    "CREDENTIALS",
    "AWS_SECRET_ACCESS_KEY",
    "OPENAI_API_KEY",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "ACCESS_TOKEN",
    "CLIENT_SECRET",
    "API_KEY",
    "DB_PASSWORD",
    "PRIVATE_KEY",
    "TOKEN_VALUE",
    "TOKEN_EXPIRES_IN_SECRET",
    "TOKEN_MAX_AGE_VALUE",
    "TOKEN_NOTTL",
    "TTL_TOKEN",
  ];
  it.each(credentialNames)("rejects credential assignments named %s", (name) => {
    const root = fixture();
    const assignment = `${name}=fixture-credential-value`;
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ description: JSON.stringify(`Use when setting ${assignment}`), body: assignment }),
    );
    put(root, "skills/alpha/references/guide.md", assignment);
    const { errors } = checkSkills(root, { write: true });
    for (const location of ["decoded metadata", "line 3", "line 5", "line 1"]) {
      expect(
        errors.some((error) => error.includes(`${location}: possible environment secret`)),
      ).toBe(true);
    }
    expect(errors.join("\n")).not.toContain(assignment);
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
  });

  const nonSecretQualifiers = [
    "TTL",
    "EXPIRY",
    "EXPIRES",
    "LIFETIME",
    "LENGTH",
    "LEN",
    "SIZE",
    "LIMIT",
    "COUNT",
    "MAX",
    "MIN",
    "TIMEOUT",
    "URL",
    "URI",
    "ENDPOINT",
    "PATH",
    "FILE",
    "DIR",
    "NAME",
    "ID",
    "TYPE",
    "HEADER",
    "PREFIX",
    "FORMAT",
    "ALG",
    "ALGORITHM",
    "EXPIRES_IN",
    "EXPIRES_AT",
    "MAX_AGE",
    "TTL_SECONDS",
    "TTL_MS",
    "LIFETIME_SECONDS",
    "LIFETIME_MS",
    "TIMEOUT_SECONDS",
    "TIMEOUT_MS",
  ];
  it.each([
    "MAX_TOKENS=4096",
    "TOKEN_TTL=3600",
    "ACCESS_TOKEN_EXPIRES_IN=3600",
    "TOKEN_MAX_AGE=3600",
    "TOKENS=4096",
    "MAX_KEYS=4096",
    "KEYS=4096",
    "KEYBOARD=public-value",
    "SECRETARIAT=public-value",
    "MYTOKEN=public-value",
    ...nonSecretQualifiers.flatMap((qualifier) => [
      `TOKEN_${qualifier}=public-value`,
      `AWS_SECRET_ACCESS_KEY_${qualifier}=public-value`,
    ]),
  ])("allows non-secret configuration assignments: %s", (assignment) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ description: JSON.stringify(`Use when setting ${assignment}`), body: assignment }),
    );
    put(root, "skills/alpha/references/guide.md", assignment);
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each(
    [
      ...secrets.map(([category, value]) => [value, `possible ${category} (value omitted)`]),
      ...localPaths.map((value) => [value, "absolute user path is forbidden (value omitted)"]),
    ].flatMap(([value, rule]) => [
      ["mapping value", value, rule],
      ["mapping key", value, rule],
      ["sequence value", value, rule],
    ]),
  )("scans every decoded frontmatter scalar: %s (%s)", (kind, value, rule) => {
    const root = fixture();
    const escaped = [...value]
      .map((character) => `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`)
      .join("");
    const entry =
      kind === "mapping key"
        ? `    "${escaped}": true`
        : kind === "sequence value"
          ? `    - "${escaped}"`
          : `    note: "${escaped}"`;
    put(root, "skills/alpha/SKILL.md", skill({ extra: `metadata:\n  nested:\n${entry}\n` }));
    expect(checkSkills(root, { write: true }).errors).toEqual([
      `skills/alpha/SKILL.md: decoded metadata: ${rule}`,
    ]);
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
  });

  it("walks shared and cyclic YAML aliases without skipping scalar checks", () => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        extra:
          'metadata: &metadata\n  self: *metadata\n  nested: &nested\n    note: "API_TOKEN=fixture-credential-value"\n  alias: *nested\n',
      }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/SKILL.md: line 7: possible environment secret (value omitted)",
      "skills/alpha/SKILL.md: decoded metadata: possible environment secret (value omitted)",
    ]);
  });

  it.each(["\n", "\r\n"])("preserves body finding lines with newline %j", (newline) => {
    const root = fixture();
    const text = skill({
      description: ">-\n  Use when checking\n  body line numbers.",
      extra: 'metadata:\n  example: "API_TOKEN=\\"<token>\\""\n',
      body: "\nPASSWORD=fixture-credential-value\n/home/someone/private\n",
    });
    put(root, "skills/alpha/SKILL.md", `\uFEFF${text.replaceAll("\n", newline)}`);
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/SKILL.md: line 11: absolute user path is forbidden",
      "skills/alpha/SKILL.md: line 10: possible environment secret (value omitted)",
    ]);
  });

  it("scans companion frontmatter as raw text", () => {
    const root = fixture();
    const path = "skills/alpha/references/guide.md";
    put(root, path, '---\nexample: API_TOKEN="fixture-credential-value"\n---\n');
    expect(checkSkills(root, { write: true }).errors).toEqual([
      `${path}: line 2: possible environment secret (value omitted)`,
    ]);
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

  it.each([
    '"Use when setting TOKEN=<token>\\nTOKEN=your-token"',
    '"Use when setting TOKEN=<token>\\tTOKEN=your-token"',
    '>-\n  Use when setting API_TOKEN="your-token\\" PASSWORD=fixture-credential-value"',
    '\'Use when setting API_TOKEN="your-token\\" PASSWORD=fixture-credential-value"\'',
  ])("preserves YAML placeholder syntax without decoding other raw escapes: %s", (description) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ description }));
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    '"Use when setting API_TOKEN=\\"<token>\\"."',
    '&description "Use when setting API_TOKEN=\\"<token>\\"."',
    '!!str "Use when setting API_TOKEN=\\"<token>\\"."',
    "'Use when setting API_TOKEN=your-token'",
    "'Use when setting API_TOKEN=''your-token'''",
    "&description 'Use when setting API_TOKEN=''your-token'''",
    "!!str 'Use when setting API_TOKEN=''your-token'''",
  ])("checks comments following quoted scalar syntax: %s", (description) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ description: `${description} # PASSWORD=fixture-credential-value` }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/SKILL.md: line 3: possible environment secret (value omitted)",
    ]);
  });

  it.each([
    '"Use when setting API_TOKEN=your-token"',
    "'Use when setting API_TOKEN=your-token'",
    "'Use when setting API_TOKEN=''your-token'''",
    "&description 'Use when setting API_TOKEN=your-token'",
    "!!str 'Use when setting API_TOKEN=your-token'",
  ])("accepts harmless trailing comments after quoted scalars: %s", (description) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({ description: `${description} # no credential value here` }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  const quotedAssignments = [
    ["double-quoted hash", 'PASSWORD="#fixture-credential-value"'],
    ["double-quoted leading space", 'PASSWORD=" fixture-credential-value"'],
    ["single-quoted spaces", "API_TOKEN='a b c'"],
    ["double-quoted placeholder lookalike", 'PASSWORD="changeme fixture-credential-value"'],
    ["single-quoted placeholder lookalike", "PASSWORD='xxx #fixture-credential-value'"],
    [
      "assignment after an escaped backslash",
      String.raw`TOKEN="your-token\\" PASSWORD="#fixture-credential-value"`,
    ],
  ];

  const inlineAssignments = [
    ["prose", "setting PASSWORD=fixture-credential-value for a command."],
    ["inline code", "setting `API_KEY=fixture-credential-value` for a command."],
    ["export", "running export API_TOKEN=fixture-credential-value"],
    ["command prefix", "running FOO_SECRET=fixture-credential-value cmd"],
    ["quoted value", "setting API_TOKEN = 'fixture-credential-value'"],
    ["multiple assignments", "running TOKEN=<token> SECRET=fixture-credential-value cmd"],
    ["changeme lookalike", "setting TOKEN=changeme-credential-value"],
    ["xxx lookalike", "setting SECRET=xxx-credential-value"],
    ["generator lookalike", "setting PASSWORD=randomUUID()credential-value"],
    ...quotedAssignments,
  ];

  it.each(inlineAssignments)("rejects inline credentials in metadata: %s", (_label, text) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ description: JSON.stringify(`Use when ${text}`) }));
    const indexPath = join(root, "skills/INDEX.md");
    for (const previousIndex of [undefined, "Previously generated index\n"]) {
      if (previousIndex !== undefined) put(root, "skills/INDEX.md", previousIndex);
      const result = cli(root, "--write");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "decoded metadata: possible environment secret (value omitted)",
      );
      expect(result.stderr.includes("fixture-credential-value")).toBe(false);
      expect(result.stderr.includes(text)).toBe(false);
      expect(result.stdout).toBe("");
      if (previousIndex === undefined) expect(existsSync(indexPath)).toBe(false);
      else expect(readFileSync(indexPath, "utf8")).toBe(previousIndex);
    }
  });

  it.each(inlineAssignments)("rejects inline credentials in the body: %s", (_label, text) => {
    const root = fixture();
    put(root, "skills/alpha/SKILL.md", skill({ body: `Example: ${text}\n` }));
    const result = cli(root, "--write");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("line 5: possible environment secret (value omitted)");
    expect(result.stderr.includes("fixture-credential-value")).toBe(false);
    expect(result.stderr.includes(text)).toBe(false);
    expect(result.stdout).toBe("");
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
  });

  it.each(
    quotedAssignments,
  )("rejects quoted credentials in a companion file: %s", (_label, text) => {
    const root = fixture();
    put(root, "skills/alpha/references/guide.md", `\n\n${text}\n`);
    const result = cli(root, "--write");
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "skills/alpha/references/guide.md: line 3: possible environment secret (value omitted)\n",
    );
    expect(result.stdout).toBe("");
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(false);
  });

  const shellParameterAssignments = [":-", "-", ":=", "=", ":+", "+", ":?", "?"].flatMap(
    (operator) =>
      [
        ["", 0],
        ["$OTHER_PASSWORD", 0],
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
        ["${OTHER_PASSWORD}", 0],
        ["<password>", 0],
        ["[REDACTED]", 0],
        ["changeme", 0],
        ["your-password", 0],
        ['"<password>"', 0],
        ["'<password>'", 0],
        ["''", 0],
        ["fixture-credential-value", 1],
        ['"fixture-credential-value"', 1],
        ["'fixture credential value'", 1],
        ["example fixture-credential-value", 1],
        ["PASSWORD must be set", 1],
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
        ["${OTHER_PASSWORD:-fixture-credential-value}", 1],
      ].flatMap(([word, count]) => {
        const assignment = `PASSWORD=\${PASSWORD${operator}${word}}`;
        const expected = operator.endsWith("?") ? 0 : count;
        return [
          [`shell parameter ${operator} with word ${word}`, assignment, expected],
          [
            `quoted shell parameter ${operator} with word ${word}`,
            `PASSWORD="${assignment.slice(9)}"`,
            expected,
          ],
        ];
      }),
  );

  const assignmentBoundaries = [
    ...shellParameterAssignments,
    ...[
      "===",
      "==",
      "!==",
      "!=",
      "<=",
      ">=",
      "+=",
      "-=",
      "*=",
      "/=",
      "%=",
      "**=",
      "&&=",
      "||=",
      "??=",
      "<<=",
      ">>=",
      ">>>=",
      "&=",
      "|=",
      "^=",
    ].map((operator) => [
      `non-assignment operator ${operator}`,
      `if (TOKEN ${operator} undefined) return;`,
      0,
    ]),
    ["arrow parameter", "const identity = TOKEN => TOKEN;", 0],
    ["compact equality", "if (TOKEN===undefined) return;", 0],
    ["compact arrow parameter", "const identity=TOKEN=>TOKEN;", 0],
    [
      "assignment following equality",
      "if (TOKEN === undefined) PASSWORD=fixture-credential-value;",
      1,
    ],
    ["environment property", "const API_KEY = process.env.API_KEY;", 0],
    ["environment property in an object", "API_KEY: process.env.API_KEY,", 0],
    ["environment property before a comma", "const API_KEY = process.env.API_KEY, other = 1;", 0],
    ["environment lookup", 'const API_KEY = process.env["API_KEY"];', 0],
    ["Bun environment property", "const API_KEY = Bun.env.API_KEY;", 0],
    ["Vite environment property", "const API_KEY = import.meta.env.VITE_API_KEY;", 0],
    ["transformed environment property", "const API_KEY = process.env.API_KEY.trim();", 0],
    ["awaited function call", "TOKEN = await getToken();", 0],
    ["function call", "TOKEN=getToken();", 0],
    ["function call with arguments", 'TOKEN = await auth.getToken("scope", { refresh: true });', 0],
    ["function call with whitespace", "TOKEN = getToken ();", 0],
    [
      "multiline awaited call with nested brackets and quoted delimiters",
      'const TOKEN = await auth.getToken(\n  "scope)",\n  { scopes: ["read", "write"], refresh: true },\n);',
      0,
    ],
    ["multiline environment lookup", 'const API_KEY = process.env[\n  "API_KEY"\n];', 0],
    [
      "multiline call with a literal fallback on the next line",
      'const TOKEN = getToken(\n  "scope"\n)\n  ?? "fixture-credential-value";',
      1,
    ],
    [
      "multiline call followed by another assignment",
      'const TOKEN = getToken(\n  "scope"\n);\nPASSWORD=fixture-credential-value',
      1,
    ],
    ["unbalanced multiline call", 'const TOKEN = getToken(\n  { scope: "read" ]\n);', 1],
    [
      "shell substitution keeps newline boundaries",
      "TOKEN=$(gh auth token\nPASSWORD=fixture-credential-value\n)",
      2,
    ],
    ["backtick-quoted literal", "const API_KEY = `fixture-credential-value`;", 1],
    ["backtick-quoted spaces", "const API_KEY = `fixture credential value`;", 1],
    ["backtick-quoted placeholder", "const API_KEY = `your-token`;", 0],
    ["backtick-quoted call is literal", "const TOKEN = `auth.getToken()`;", 1],
    ["multiline backtick literal", "const TOKEN = `\nfixture-credential-value\n`;", 1],
    [
      "template environment reference",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
      "const API_KEY = `${process.env.API_KEY}`;",
      0,
    ],
    [
      "template awaited call",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
      "const TOKEN = `${await auth.getToken()}`;",
      0,
    ],
    [
      "multiple template references",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
      "const TOKEN = `${process.env.TOKEN}${auth.getToken()}`;",
      0,
    ],
    [
      "template reference with a literal suffix",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
      "const TOKEN = `${process.env.TOKEN}fixture-credential-value`;",
      1,
    ],
    [
      "template reference with a literal prefix",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
      "const TOKEN = `fixture-credential-value${process.env.TOKEN}`;",
      1,
    ],
    [
      "template reference with a literal fallback",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
      'const TOKEN = `${process.env.TOKEN ?? "fixture-credential-value"}`;',
      1,
    ],
    [
      "template expression followed by a literal fallback",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
      'const TOKEN = `${auth.getToken()}` ?? "fixture-credential-value";',
      1,
    ],
    [
      "escaped template interpolation is literal",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
      "const TOKEN = `\\${process.env.TOKEN}`;",
      1,
    ],
    ["template literal inside inline code", "``const API_KEY = `fixture-credential-value`;``", 1],
    [
      "backtick inside an earlier quoted string",
      'const note = "`", API_KEY = `fixture-credential-value`;',
      1,
    ],
    ["inline placeholder boundary", "`API_KEY=your-token`PASSWORD=fixture-credential-value", 1],
    ["inline empty assignment", "`API_KEY=` followed by `PASSWORD=fixture-credential-value`", 1],
    [
      "inline empty declaration",
      "``const API_KEY =`` followed by `PASSWORD=fixture-credential-value`",
      1,
    ],
    ["unterminated template literal", "const API_KEY = `fixture-credential-value", 1],
    ["quoted environment property", 'API_KEY="process.env.API_KEY"', 1],
    ["quoted function call", 'TOKEN="getToken()"', 1],
    ["quoted awaited function call", "TOKEN='await getToken()'", 1],
    ["function call suffix", "TOKEN=getToken()credential-value", 1],
    ["environment property suffix", "API_KEY=process.env.API_KEY/credential-value", 1],
    [
      "literal environment fallback",
      'API_KEY = process.env.API_KEY ?? "fixture-credential-value";',
      1,
    ],
    ["shell command substitution", "export GITHUB_TOKEN=$(gh auth token)", 0],
    ["quoted shell command substitution", 'PASSWORD="$(openssl rand -hex 16)"', 0],
    ["shell command with nested quotes", 'PASSWORD="$(printf "%s" "$(openssl rand -hex 16)")"', 0],
    ["single-quoted command is literal", "PASSWORD='$(openssl rand -hex 16)'", 1],
    ["shell command substitution suffix", 'PASSWORD="$(openssl rand -hex 16)credential-value"', 1],
    [
      "shell command then a credential",
      "TOKEN=$(gh auth token);PASSWORD=fixture-credential-value",
      1,
    ],
    ["function call then a credential", "TOKEN=getToken();PASSWORD=fixture-credential-value", 1],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
    ["parameter expansion suffix", "PASSWORD=${PASSWORD:-<token>}credential-value", 1],
    [
      "parameter substitution is not a plain reference",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
      "PASSWORD=${PASSWORD/pattern/fixture-credential-value}",
      1,
    ],
    ["semicolon", "API_TOKEN=$API_TOKEN;PASSWORD=fixture-credential-value", 1],
    ["empty single-quoted prefix", "PASSWORD=''fixture-credential-value", 1],
    ["empty double-quoted prefix", 'PASSWORD=""fixture-credential-value', 1],
    ["adjacent quoted segments", "PASSWORD=''\"fixture-credential-value\"", 1],
    ["ampersands", 'export A_TOKEN="x" && B_SECRET=real-looking-value cmd', 2],
    ["pipe", "API_TOKEN=$API_TOKEN|PASSWORD=fixture-credential-value", 1],
    ["closing parenthesis", "API_TOKEN=$API_TOKEN)PASSWORD=fixture-credential-value", 1],
    ["quoted variable", 'PASSWORD="$PASSWORD"', 0],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
    ["braced variable suffix", 'PASSWORD="${SECRET}suffix"', 1],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
    ["braced variable punctuation suffix", 'PASSWORD="${SECRET}."', 1],
    ["variable suffix", 'PASSWORD="$PASSWORD/suffix"', 1],
    ["angle bracket suffix", 'PASSWORD="<token>suffix"', 1],
    ["backslash is literal before an angle bracket", String.raw`PASSWORD="\<token>"`, 1],
    ["escaped double quote", String.raw`PASSWORD="fixture\"credential-value"`, 1],
    ["single quotes preserve backslashes", String.raw`PASSWORD='\$PASSWORD'`, 1],
    ["unterminated double quote", 'PASSWORD="fixture-credential-value', 1],
    ["unterminated single quote", "PASSWORD='fixture-credential-value", 1],
    [
      "unterminated quote stops at the newline",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
      'API_TOKEN="${API_TOKEN}\nPASSWORD=fixture-credential-value',
      1,
    ],
    ["hash inside unquoted value", "PASSWORD=fixture#credential-value", 1],
    ["hash at value start", "PASSWORD=# comment", 1],
    ["hash-prefixed command password", "PASSWORD=#a7z9Qp2M command", 1],
    ["hash after empty quotes", "PASSWORD=''#fixture-credential-value command", 1],
    ["hash after a quoted placeholder", 'PASSWORD="<token>"#credential-value', 1],
    ["hash after a quoted variable", 'PASSWORD="$PASSWORD"#credential-value', 1],
    ["empty before separator", "API_TOKEN=;PASSWORD=fixture-credential-value", 1],
  ];
  it.each(
    ["description", "body", "fence", "companion"].flatMap((surface) =>
      assignmentBoundaries.map(([label, text, count]) => [surface, label, text, count]),
    ),
  )("scans complete assignments in %s: %s", (surface, _label, text, count) => {
    const root = fixture();
    const path =
      surface === "companion" ? "skills/alpha/references/guide.md" : "skills/alpha/SKILL.md";
    put(
      root,
      path,
      surface === "description"
        ? skill({ description: JSON.stringify(`Use when setting ${text}`) })
        : surface === "body"
          ? skill({ body: text })
          : surface === "fence"
            ? skill({ body: `\`\`\`js\n${text}\n\`\`\`` })
            : text,
    );
    const { errors } = checkSkills(root, { write: true });
    expect(errors).toHaveLength(surface === "description" ? count * 2 : count);
    for (const error of errors) {
      expect(error).toMatch(
        new RegExp(
          `^${path.replaceAll(".", "\\.")}: (?:decoded metadata|line \\d+): possible environment secret \\(value omitted\\)$`,
        ),
      );
    }
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(count === 0);
  });

  it.each([
    ["50 lines", `getToken(${"\n".repeat(49)})`, 0],
    ["more than 50 lines", `getToken(${"\n".repeat(50)})`, 1],
    ["4 KiB of brackets and contents", `getToken(${"a".repeat(4094)})`, 0],
    ["more than 4 KiB of brackets and contents", `getToken(${"a".repeat(4095)})`, 1],
    ["CRLF at the line limit", `getToken(${"\r\n".repeat(49)})`, 0],
  ])("bounds computed expression parsing at %s", (_label, expression, count) => {
    const root = fixture();
    const path = "skills/alpha/references/guide.md";
    put(root, path, `const TOKEN = ${expression};`);
    expect(checkSkills(root, { write: true }).errors).toEqual(
      count === 0 ? [] : [`${path}: line 1: possible environment secret (value omitted)`],
    );
  });

  it("preserves YAML source lines when computed values contain escaped newlines", () => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        description: JSON.stringify('Use when TOKEN=getToken(\n  "scope"\n);'),
        extra: 'metadata:\n  note: "PASSWORD=fixture-credential-value"\n',
      }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([
      "skills/alpha/SKILL.md: line 5: possible environment secret (value omitted)",
      "skills/alpha/SKILL.md: decoded metadata: possible environment secret (value omitted)",
    ]);
  });

  it.each([
    "description",
    "body",
    "companion",
  ])("accepts quoted placeholders in %s without treating YAML escapes as shell text", (surface) => {
    const root = fixture();
    const text = 'Use when setting API_TOKEN="<token>".';
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        description: JSON.stringify(surface === "description" ? text : "Use when testing."),
        body: surface === "body" ? text : "",
      }),
    );
    if (surface === "companion") put(root, "skills/alpha/references/guide.md", text);
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
  });

  it.each([
    ["angle brackets", "<token>"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal documentation template
    ["braced variable", "${API_TOKEN}"],
    ["variable", "$API_TOKEN"],
    ["braces", "{token}"],
    ["redaction", "[REDACTED]"],
    ["ellipsis", "..."],
    ["Unicode ellipsis", "…"],
    ["your prefix", "your-api-token"],
    ["example", "example"],
    ["example prefix", "example_token"],
    ["placeholder prefix", "placeholder-token"],
    ["dummy prefix", "dummy-token"],
    ["test prefix", "test-token"],
    ["changeme", "changeme"],
    ["xxx", "xxx"],
    ["public storage identifier", "solid:recent-accounts"],
    ["generated test password", "randomUUID()"],
    ["double-quoted template with whitespace", '" <token> "'],
    ["single-quoted template with whitespace", "' changeme '"],
    ["escaped double quote", String.raw`"your-token\" PASSWORD=fixture-credential-value"`],
    ["empty double quotes", '""'],
    ["empty single quotes", "''"],
    ["empty", ""],
  ])("allows inline placeholder assignments in metadata and body: %s", (_label, value) => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        description: `Use when setting \`API_TOKEN=${value}\` for a command.`,
        body: `Run \`export PASSWORD=${value}\` or \`FOO_SECRET=${value}\` cmd.\n`,
      }),
    );
    expect(checkSkills(root, { write: true }).errors).toEqual([]);
    expect(existsSync(join(root, "skills/INDEX.md"))).toBe(true);
  });

  it("requires an environment variable name boundary and ignores non-secret assignments", () => {
    const root = fixture();
    put(
      root,
      "skills/alpha/SKILL.md",
      skill({
        description: "Use when setting PORT=3000 or ISSUER=https://example.invalid.",
        body: "These are other identifiers: lowerTOKEN=value 1PASSWORD=value.\n",
      }),
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
    const result = runNode([
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(checker)})`,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toBe("");
  });
});
