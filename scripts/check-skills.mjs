#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import {
  existsSync,
  globSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { JSON_SCHEMA, load } from "js-yaml";
import { Marked } from "marked";
import characterReferences from "./html-character-references.json" with { type: "json" };

const legacyCharacterReferences = new Set(characterReferences.$legacy);

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

function scanSecrets(text, report) {
  for (const [category, pattern] of secretPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1] && isPlaceholder(match[1])) continue;
      report(category, match.index);
    }
  }
}

function decodeCharacterReferences(text) {
  // Decode once: &amp;copy; denotes the literal filename &copy;, not ©.
  return text.replace(
    /&(#(?:[xX][\da-fA-F]+|\d+)|[a-zA-Z][a-zA-Z\d]*);?/g,
    (match, name, offset) => {
      if (!name.startsWith("#")) {
        // In attributes, legacy names without ';' cannot precede '=' or an
        // alphanumeric character (the name pattern consumes the latter in full).
        if (
          !match.endsWith(";") &&
          (!legacyCharacterReferences.has(name) || text[offset + match.length] === "=")
        ) {
          return match;
        }
        return Object.hasOwn(characterReferences, name) ? characterReferences[name] : match;
      }
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

function srcsetLinksIn(input) {
  const links = [];
  let cursor = 0;
  while (cursor < input.length) {
    while (cursor < input.length && /[\t\n\f\r ,]/.test(input[cursor])) cursor++;
    const start = cursor;
    while (cursor < input.length && !/[\t\n\f\r ]/.test(input[cursor])) cursor++;
    let url = input.slice(start, cursor);
    const descriptors = [];
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      // Srcset URLs may contain commas (including data URLs). A comma ends a
      // candidate only after its URL, outside a parenthesized descriptor.
      let descriptor = "";
      let inParens = false;
      while (cursor < input.length) {
        const char = input[cursor++];
        if (inParens) {
          descriptor += char;
          if (char === ")") inParens = false;
        } else if (char === ",") {
          break;
        } else if (/[\t\n\f\r ]/.test(char)) {
          if (descriptor) descriptors.push(descriptor);
          descriptor = "";
        } else {
          descriptor += char;
          if (char === "(") inParens = true;
        }
      }
      if (descriptor) descriptors.push(descriptor);
    }
    // Discard candidates that the HTML srcset descriptor parser rejects.
    let valid = url !== "";
    let width = false;
    let density = false;
    let height = false;
    for (const descriptor of descriptors) {
      const number = Number(descriptor.slice(0, -1));
      if (/^\d+w$/.test(descriptor) && number > 0 && !width && !density) {
        width = true;
      } else if (
        /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?x$/.test(descriptor) &&
        number >= 0 &&
        !width &&
        !density &&
        !height
      ) {
        density = true;
      } else if (/^\d+h$/.test(descriptor) && number > 0 && !height && !density) {
        height = true;
      } else {
        valid = false;
      }
    }
    if (valid && (!height || width)) links.push(url);
  }
  return links;
}

function htmlLinksIn(html, definitions, definitionMarker) {
  const links = [];
  const elements = [];
  // Recognize comments/declarations only between tags; consume attribute values below.
  const tokens = new RegExp(
    `<!--(?:-?>|[\\s\\S]*?(?:--!?>|$))|<!|<\\/?[a-zA-Z][^\\t\\n\\f\\r />]*|${definitionMarker}(\\d+)\0`,
    "g",
  );
  const whitespace = /[\t\n\f\r ]/;
  for (let token = tokens.exec(html); token; token = tokens.exec(html)) {
    if (token[0].startsWith("<!--")) continue;
    if (token[0] === "<!") {
      // CDATA is text through ']]>' only in foreign content. HTML CDATA,
      // DOCTYPEs, and bogus declarations end at the next '>' (or EOF).
      const terminator =
        html.startsWith("[CDATA[", tokens.lastIndex) &&
        (elements.at(-1)?.namespace ?? "html") !== "html"
          ? "]]>"
          : ">";
      const end = html.indexOf(terminator, tokens.lastIndex);
      tokens.lastIndex = end === -1 ? html.length : end + terminator.length;
      continue;
    }
    if (token[1] !== undefined) {
      links.push(decodeCharacterReferences(definitions[Number(token[1])]));
      continue;
    }
    const closing = token[0].startsWith("</");
    const tag = token[0].slice(closing ? 2 : 1).toLowerCase();
    let cursor = tokens.lastIndex;
    let selfClosing = false;
    const attributes = [];
    const elementAttributes = new Map();
    while (cursor < html.length && html[cursor] !== ">") {
      if (html[cursor] === "/" && html[cursor + 1] === ">") selfClosing = true;
      if (whitespace.test(html[cursor]) || html[cursor] === "/") {
        cursor++;
        continue;
      }
      const nameStart = cursor;
      while (cursor < html.length && !/[\t\n\f\r /=>]/.test(html[cursor])) cursor++;
      const name = html.slice(nameStart, cursor).toLowerCase();
      const firstAttribute = !elementAttributes.has(name);
      if (!elementAttributes.has(name)) elementAttributes.set(name, "");
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
      if (firstAttribute) elementAttributes.set(name, value);
      if (!closing && /^(?:href|src|srcset|xlink:href)$/.test(name)) attributes.push([name, value]);
    }
    // An incomplete tag does not create an element or active URL attributes.
    tokens.lastIndex = cursor + 1;
    if (html[cursor] !== ">") continue;
    if (closing) {
      const index = elements.findLastIndex((element) => element.tag === tag);
      if (index !== -1) elements.length = index;
      continue;
    }

    const parent = elements.at(-1);
    let namespace = parent?.namespace ?? "html";
    if (
      parent?.htmlChildren ||
      (parent?.mathText && !/^(?:mglyph|malignmark)$/.test(tag)) ||
      (namespace === "math" && parent?.tag === "annotation-xml" && tag === "svg")
    ) {
      namespace = "html";
    }
    // These HTML tags exit foreign content even without an explicit closing tag.
    if (
      namespace !== "html" &&
      (/^(?:b|big|blockquote|body|br|center|code|dd|div|dl|dt|em|embed|h[1-6]|head|hr|i|img|li|listing|menu|meta|nobr|ol|p|pre|ruby|s|small|span|strong|strike|sub|sup|table|tt|u|ul|var)$/.test(
        tag,
      ) ||
        (tag === "font" && ["color", "face", "size"].some((name) => elementAttributes.has(name))))
    ) {
      while (
        elements.length &&
        elements.at(-1).namespace !== "html" &&
        !elements.at(-1).htmlChildren &&
        !elements.at(-1).mathText
      ) {
        elements.pop();
      }
      namespace = "html";
    }
    if (namespace === "html" && (tag === "svg" || tag === "math")) namespace = tag;
    for (const [name, value] of attributes) {
      if (name === "srcset") {
        if (namespace === "html" && /^(?:img|source)$/.test(tag)) {
          // Decode before splitting: character references can introduce delimiters.
          links.push(...srcsetLinksIn(decodeCharacterReferences(value)));
        }
        continue;
      }
      // XLink href is a URL only when adjusted as a foreign-content attribute.
      if (name !== "xlink:href" || namespace !== "html")
        links.push(decodeCharacterReferences(value));
    }
    // A slash closes foreign elements; HTML text elements ignore it.
    if (
      (namespace !== "html" && selfClosing) ||
      (namespace === "html" &&
        /^(?:area|base|basefont|bgsound|br|col|embed|hr|img|input|keygen|link|meta|param|source|track|wbr)$/.test(
          tag,
        ))
    ) {
      continue;
    }
    elements.push({
      tag,
      namespace,
      htmlChildren:
        (namespace === "svg" && /^(?:foreignobject|desc|title)$/.test(tag)) ||
        (namespace === "math" &&
          tag === "annotation-xml" &&
          /^(?:text\/html|application\/xhtml\+xml)$/i.test(
            decodeCharacterReferences(elementAttributes.get("encoding") ?? ""),
          )),
      mathText: namespace === "math" && /^(?:mi|mo|mn|ms|mtext)$/.test(tag),
    });
    if (
      namespace === "html" &&
      /^(?:textarea|title|script|style|xmp|iframe|noembed|noframes)$/.test(tag)
    ) {
      // Raw-text/RCDATA contents cannot start tags or comments. Only a matching
      // end tag returns to markup, even inside apparent quoted attributes.
      const endTag = new RegExp(`</${tag}(?=[\\t\\n\\f\\r />])`, "gi");
      endTag.lastIndex = tokens.lastIndex;
      tokens.lastIndex = endTag.exec(html)?.index ?? html.length;
    }
  }
  return links;
}

function linksIn(text) {
  const definitions = [];
  let definitionMarker = "\0check-skills-definition:";
  while (text.includes(definitionMarker)) definitionMarker += ":";
  const markdown = new Marked({
    renderer: {
      def({ href }) {
        // Inert placeholders retain definition order without introducing HTML syntax.
        return `${definitionMarker}${definitions.push(href) - 1}\0`;
      },
    },
  });
  // Render once so HTML text-element state spans inline tokens and blank-line block splits.
  // The scanner consumes placeholders only in markup context, outside comments/attributes/text.
  const html = markdown.parser(markdown.lexer(text));
  const links = [];
  for (const href of htmlLinksIn(html, definitions, definitionMarker)) {
    // HTML URL attributes allow surrounding ASCII whitespace, including encoded whitespace.
    // URL parsing also removes embedded tabs/newlines; percent escapes stay intact.
    links.push(href.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "").replace(/[\t\n\r]/g, ""));
  }
  return [...new Set(links)];
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
    const companionDir = path.startsWith("skills/") ? skillDir : join(skillDir, "references");
    if (existsSync(join(root, companionDir))) {
      // Directory enumeration includes dotfiles and dot-directories within this scope.
      for (const companion of readdirSync(join(root, companionDir), {
        recursive: true,
        withFileTypes: true,
      })) {
        if (companion.isFile())
          files.add(relative(root, join(companion.parentPath, companion.name)));
      }
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
    // These fields enter the index; YAML escapes/folding can hide secrets and local paths.
    for (const value of [name, description]) {
      if (typeof value !== "string") continue;
      if (value.includes("/Users/")) {
        report(path, "decoded metadata: absolute user path is forbidden");
      }
      scanSecrets(value, (category) => {
        report(path, `decoded metadata: possible ${category} (value omitted)`);
      });
    }
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
    scanSecrets(text, (category, offset) => {
      report(path, `line ${lineNumber(text, offset)}: possible ${category} (value omitted)`);
    });
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
