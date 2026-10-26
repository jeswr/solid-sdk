#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import {
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { JSON_SCHEMA, load } from "js-yaml";
import { marked } from "marked";
import characterReferences from "./html-character-references.json" with { type: "json" };

// W9 DESIGN §6 categories. Scan examples too, but allow explicit template values.
const secretPatterns = [
  ["private key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g],
  ["API key", /\bsk-[A-Za-z0-9_-]{16,}\b/g],
  ["GitHub token", /\bghp_[A-Za-z0-9]{20,}\b/g],
  ["AWS key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["JWT", /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g],
  [
    "Authorization header",
    /\bAuthorization["']?\s*:\s*["'`]?(?:(?:Bearer|DPoP|Basic)\s+)?([^\s"'`]+)/gi,
  ],
  [
    "environment secret",
    /^[\t ]*(?:export[\t ]+)?(?=[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY))[A-Z_][A-Z0-9_]*[\t ]*=[\t ]*["']?([^\s"'`#]+)/gm,
  ],
];

function isPlaceholder(value) {
  return /^(?:\$|<|\{|\[|\.\.\.|…|(?:your|example|placeholder|redacted|dummy|test)(?:[-_]|$))/i.test(
    value,
  );
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function decodeCharacterReferences(text) {
  // Decode once: &amp;copy; denotes the literal filename &copy;, not ©.
  return text.replace(
    /&(#(?:[xX][\da-fA-F]{1,6}|\d{1,7})|[a-zA-Z][a-zA-Z\d]*);/g,
    (match, name) => {
      if (!name.startsWith("#"))
        return Object.hasOwn(characterReferences, name) ? characterReferences[name] : match;
      const hex = name[1].toLowerCase() === "x";
      const codePoint = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return (
        characterReferences[`#${codePoint}`] ??
        String.fromCodePoint(
          codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)
            ? 0xfffd
            : codePoint,
        )
      );
    },
  );
}

function htmlLinksIn(html) {
  const links = [];
  // Recognize comments only between tags; attribute values are consumed in full below.
  const tokens = /<!--(?:-?>|[\s\S]*?(?:-->|$))|<\/?[a-zA-Z][^\t\n\f\r />]*/g;
  const whitespace = /[\t\n\f\r ]/;
  for (let token = tokens.exec(html); token; token = tokens.exec(html)) {
    if (token[0].startsWith("<!--")) continue;
    const closing = token[0].startsWith("</");
    let cursor = tokens.lastIndex;
    const attributes = [];
    while (cursor < html.length && html[cursor] !== ">") {
      if (whitespace.test(html[cursor]) || html[cursor] === "/") {
        cursor++;
        continue;
      }
      const nameStart = cursor;
      while (cursor < html.length && !/[\t\n\f\r /=>]/.test(html[cursor])) cursor++;
      const name = html.slice(nameStart, cursor).toLowerCase();
      while (cursor < html.length && whitespace.test(html[cursor])) cursor++;
      if (html[cursor] !== "=") continue;
      cursor++;
      while (cursor < html.length && whitespace.test(html[cursor])) cursor++;
      const quote = html[cursor];
      let value;
      if (quote === '"' || quote === "'") {
        const start = ++cursor;
        while (cursor < html.length && html[cursor] !== quote) cursor++;
        value = html.slice(start, cursor);
        if (cursor < html.length) cursor++;
      } else {
        const start = cursor;
        while (cursor < html.length && !/[\t\n\f\r >]/.test(html[cursor])) cursor++;
        value = html.slice(start, cursor);
      }
      if (!closing && (name === "href" || name === "src")) attributes.push(value);
    }
    // An incomplete tag does not create an element or active URL attributes.
    if (html[cursor] === ">") links.push(...attributes);
    tokens.lastIndex = cursor + 1;
  }
  return links;
}

function linksIn(text) {
  const tokens = marked.lexer(text);
  const links = Object.values(tokens.links).map((link) => link.href);
  marked.walkTokens(tokens, (token) => {
    if (token.type === "link" || token.type === "image") links.push(token.href);
    if (token.type === "html") links.push(...htmlLinksIn(token.text));
  });
  return [...new Set(links.map(decodeCharacterReferences))];
}

function escapeCell(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll("|", "&#124;")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderIndex(skills) {
  const rows = [...skills]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.path.localeCompare(b.path)))
    .map(({ name, description, path }) => {
      const href = relative("skills", path).split("/").map(encodeURIComponent).join("/");
      return `| ${escapeCell(name)} | ${escapeCell(description)} | [${escapeCell(path)}](${href}) |`;
    });
  return [
    "<!-- AUTHORED-BY Codex GPT-6.1-Sol -->",
    "<!-- Generated by scripts/check-skills.mjs --write. Do not edit by hand. -->",
    "",
    "# Skills index",
    "",
    "Includes shared and package skills, including internal repository workflows.",
    "",
    "| Name | Description | Source path |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export function checkSkills(root, { write = false } = {}) {
  root = resolve(root);
  const errors = [];
  const skills = [];
  const names = new Map();
  const files = new Set();
  const report = (path, rule) => errors.push(`${path}: ${rule}`);
  const paths = globSync(["skills/*/SKILL.md", "packages/*/SKILL.md"], { cwd: root }).sort();

  // A shared skill directory must contain its entry point; other files at skills/ are docs.
  for (const dir of globSync("skills/*", { cwd: root, withFileTypes: true })) {
    if (dir.isDirectory() && !existsSync(join(root, "skills", dir.name, "SKILL.md"))) {
      report(`skills/${dir.name}/SKILL.md`, "missing SKILL.md");
    }
  }

  for (const path of paths) {
    files.add(path);
    const skillDir = dirname(path);
    const patterns = path.startsWith("skills/")
      ? [`${skillDir}/**/*`]
      : [`${skillDir}/references/**/*`];
    for (const companion of globSync(patterns, { cwd: root, withFileTypes: true })) {
      if (companion.isFile()) files.add(relative(root, join(companion.parentPath, companion.name)));
    }

    const text = readFileSync(join(root, path), "utf8").replaceAll("\r\n", "\n");
    const frontmatter = /^(?:\uFEFF)?---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
    if (!frontmatter) {
      report(path, "frontmatter must be present and delimited by ---");
      continue;
    }
    const body = text.slice(frontmatter[0].length);
    const lines = body === "" ? 0 : body.replace(/\n$/, "").split("\n").length;
    if (lines > 500) report(path, `body exceeds 500 lines (${lines})`);

    let data;
    try {
      data = load(frontmatter[1], { schema: JSON_SCHEMA });
    } catch {
      // YAML errors include source excerpts, which may contain credentials.
      report(path, "invalid YAML frontmatter");
      continue;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      report(path, "frontmatter must be a mapping");
      continue;
    }
    const { name, description } = data;
    if (typeof name !== "string" || !name || name !== basename(skillDir)) {
      report(path, "name must equal the containing directory name");
    }
    if (typeof name === "string") {
      if (names.has(name)) report(path, `duplicate skill name (also in ${names.get(name)})`);
      else names.set(name, path);
    }
    if (typeof description !== "string" || !description.startsWith("Use when")) {
      report(path, 'description must be a string starting with "Use when"');
    }
    if (typeof description === "string" && [...description].length > 1024) {
      report(path, "description exceeds 1024 characters");
    }
    if (typeof name === "string" && typeof description === "string") {
      skills.push({ name, description, path });
    }
  }

  for (const path of [...files].sort()) {
    const text = readFileSync(join(root, path), "utf8");
    for (const match of text.matchAll(/\/Users\//g)) {
      report(path, `line ${lineNumber(text, match.index)}: absolute user path is forbidden`);
    }
    for (const [category, pattern] of secretPatterns) {
      for (const match of text.matchAll(pattern)) {
        if (match[1] && isPlaceholder(match[1])) continue;
        report(path, `line ${lineNumber(text, match.index)}: possible ${category} (value omitted)`);
      }
    }
    if (!path.endsWith(".md")) continue;
    // Frontmatter is metadata, not Markdown; fenced/inline code is ignored by the lexer.
    const markdown = text.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
    for (const href of linksIn(markdown)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/|#|\?)/i.test(href) || href === "") continue;
      try {
        const target = decodeURIComponent(href.split(/[?#]/, 1)[0]);
        if (!existsSync(resolve(root, dirname(path), target)))
          report(path, "relative link does not resolve (target omitted)");
      } catch {
        report(path, "relative link has invalid URL encoding (target omitted)");
      }
    }
  }

  const indexPath = join(root, "skills", "INDEX.md");
  // Never publish invalid metadata (or a secret) into the generated index.
  if (errors.length === 0) {
    const index = renderIndex(skills);
    if (write) {
      mkdirSync(dirname(indexPath), { recursive: true });
      writeFileSync(indexPath, index);
    } else if (!existsSync(indexPath) || readFileSync(indexPath, "utf8") !== index) {
      report("skills/INDEX.md", "index is missing or stale; run pnpm run check:skills --write");
    }
  }
  return { errors, skills };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: { root: { type: "string" }, write: { type: "boolean" } },
    });
    const { errors, skills } = checkSkills(
      values.root ?? fileURLToPath(new URL("..", import.meta.url)),
      { write: values.write },
    );
    if (errors.length) {
      console.error(errors.join("\n"));
      process.exitCode = 1;
    } else {
      console.log(
        `Skill check passed (${skills.length} skills; index ${values.write ? "generated" : "current"}).`,
      );
    }
  } catch {
    console.error(
      "Skill check failed: cannot read skills or invalid command arguments (details omitted).",
    );
    process.exitCode = 1;
  }
}
