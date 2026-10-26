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
