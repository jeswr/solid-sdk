#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import {
  existsSync,
  lstatSync,
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
];

function isPlaceholder(value) {
  const parameter = /^\$\{[A-Z_][A-Z0-9_]*:?[-=+?]([\s\S]*)\}$/i.exec(value);
  if (parameter) {
    // Shell operators can supply a literal credential even when the variable is unset.
    // Read the complete word, including spaces and nested expansions, before checking it.
    const { value: word, end } = assignmentValue(parameter[1], 0, true);
    return end === parameter[1].length && (word === "" || isPlaceholder(word));
  }
  // Existing recipes use a public localStorage identifier and a generated test password.
  // Exempt these exact examples rather than all storage keys or arbitrary expressions.
  if (value === "solid:recent-accounts" || /^randomUUID\(\);?$/.test(value)) return true;
  // Delimited templates may end a prose sentence. Prefix-style examples retain
  // their descriptive suffixes, but variable references must occupy the whole value.
  return /^(?:\$[A-Z_][A-Z0-9_]*|\$\{[A-Z_][A-Z0-9_]*\}|(?:<[^<>]*>|\{[^{}]*\}|\[[^[\]]*\])[.,]?|\.\.\.|…|(?:your|example|placeholder|redacted|dummy|test)(?:[-_][\s\S]*)?|changeme|xxx)$/i.test(
    value,
  );
}

function delimitedEnd(text, start) {
  const closing = { "(": ")", "[": "]", "{": "}" };
  const stack = [closing[text[start]]];
  let quote;
  for (let cursor = start + 1; cursor < text.length; cursor++) {
    const character = text[cursor];
    if (/[\r\n]/.test(character)) return undefined;
    if (character === "\\") cursor++;
    else if (quote) {
      if (character === quote) quote = undefined;
    } else if (/["'`]/.test(character)) quote = character;
    else if (Object.hasOwn(closing, character)) stack.push(closing[character]);
    else if (/[)\]}]/.test(character)) {
      if (character !== stack.pop()) return undefined;
      if (stack.length === 0) return cursor + 1;
    }
  }
  return undefined;
}

function computedExpressionEnd(text, start) {
  const source = text.slice(start);
  const environment =
    /^(?:(?:process|Bun)\.env|import\.meta\.env)(?:\.[A-Z_$][\w$]*|\[[\t ]*(?:"[^"\r\n]+"|'[^'\r\n]+')[\t ]*\])/i.exec(
      source,
    );
  const call = /^(?:await[\t ]+)?[A-Z_$][\w$]*(?:\??\.[A-Z_$][\w$]*)*[\t ]*(?=\()/i.exec(source);
  const end = call
    ? delimitedEnd(text, start + call[0].length)
    : environment
      ? start + environment[0].length
      : undefined;
  if (end === undefined) return undefined;
  // Accept complete expressions, never a prefix of a literal or a literal fallback.
  if (end < text.length && !/[\s;,`)\]}]/.test(text[end])) return undefined;
  if (/^[\t ]*(?:\?\?|\|\||&&|[+*/%?.-])/.test(text.slice(end))) return undefined;
  return end;
}

function assignmentValue(text, start, parameterWord = false) {
  if (!parameterWord) {
    const end = computedExpressionEnd(text, start);
    if (end !== undefined) return { value: "", end };
  }
  let value = "";
  let cursor = start;
  const terminator = parameterWord ? /[\r\n]/ : /[\s;&|`)]/;
  function takeExpansion() {
    if (text[cursor] !== "$" || !/[{(]/.test(text[cursor + 1] ?? "")) return false;
    const end = delimitedEnd(text, cursor + 1);
    if (end === undefined) return false;
    value += text.slice(cursor, end);
    cursor = end;
    return true;
  }
  // A hash is literal inside an assignment word, including immediately after =.
  while (cursor < text.length && !terminator.test(text[cursor])) {
    if (takeExpansion()) continue;
    const quote = text[cursor];
    if (quote === '"' || quote === "'") {
      cursor++;
      while (cursor < text.length && !/[\r\n]/.test(text[cursor])) {
        if (text[cursor] === quote) {
          cursor++;
          break;
        }
        if (quote === '"' && takeExpansion()) continue;
        if (
          quote === '"' &&
          text[cursor] === "\\" &&
          cursor + 1 < text.length &&
          /[$`"\\]/.test(text[cursor + 1])
        ) {
          cursor++;
        }
        value += text[cursor++];
      }
    } else value += text[cursor++];
  }
  const raw = text.slice(start, cursor);
  const command = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1).trim() : raw;
  if (!parameterWord && command.startsWith("$(") && delimitedEnd(command, 1) === command.length) {
    return { value: "", end: cursor };
  }
  return { value: value.trim(), end: cursor };
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

const nonSecretSuffixes = [
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
].map((suffix) => suffix.split("_"));

function isCredentialName(name) {
  const segments = name.split("_");
  return (
    !nonSecretSuffixes.some((suffix) =>
      suffix.every((segment, index) => segment === segments.at(index - suffix.length)),
    ) &&
    segments.some((segment) =>
      /^(?:TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|KEY|APIKEY|CREDENTIALS?)$/.test(segment),
    )
  );
}

function scanSecrets(text, report) {
  for (const [category, pattern] of secretPatterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match
        .slice(1)
        .find((part) => part !== undefined)
        ?.trim();
      if (value !== undefined && (value === "" || isPlaceholder(value))) continue;
      report(category, match.index);
    }
  }
  const assignments = /\b([A-Z_][A-Z0-9_]*)[\t ]*=[\t ]*/g;
  while (assignments.lastIndex < text.length) {
    const match = assignments.exec(text);
    if (!match) break;
    // Only a standalone = starts an assignment, never an equality or arrow operator.
    const equals = match.index + match[0].lastIndexOf("=");
    if (/[!<>=+*/%&|^?-]/.test(text[equals - 1] ?? "") || /[=>]/.test(text[equals + 1] ?? ""))
      continue;
    if (!isCredentialName(match[1])) continue;
    const { value, end } = assignmentValue(text, assignments.lastIndex);
    if (value !== "" && !isPlaceholder(value)) report("environment secret", match.index);
    assignments.lastIndex = end;
  }
}

function* metadataScalars(value, seen = new Set()) {
  if (typeof value === "string") yield value;
  else if (value && typeof value === "object" && !seen.has(value)) {
    // YAML aliases may share nodes or form cycles. Scan mapping keys as well as
    // values, including strings nested inside sequences and arbitrary metadata.
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (!Array.isArray(value)) yield key;
      yield* metadataScalars(child, seen);
    }
  }
}

function* rawMetadataSegments(text, quotedScalars) {
  let cursor = 0;
  for (const [start, end] of [...quotedScalars].sort(([a], [b]) => a - b)) {
    yield { text: text.slice(cursor, start), lineOffset: lineNumber(text, cursor) };
    let segmentStart = start + 1;
    // Other YAML escapes are syntax boundaries, not literal assignment suffixes.
    // The decoded scan handles their contents; retain actual source newlines here.
    const escapes = /\\(["\\]|x[\da-fA-F]{2}|u[\da-fA-F]{4}|U[\da-fA-F]{8}|[\s\S])/g;
    const scalar = text.slice(start + 1, end - 1);
    for (const escaped of scalar.matchAll(escapes)) {
      if (escaped[1] === '"' || escaped[1] === "\\") continue;
      const escapeStart = start + 1 + escaped.index;
      yield {
        text: text.slice(segmentStart, escapeStart).replace(/\\(["\\])/g, "$1"),
        lineOffset: lineNumber(text, segmentStart),
      };
      segmentStart = escapeStart + escaped[0].length;
    }
    yield {
      text: text.slice(segmentStart, end - 1).replace(/\\(["\\])/g, "$1"),
      lineOffset: lineNumber(text, segmentStart),
    };
    cursor = end;
  }
  yield { text: text.slice(cursor), lineOffset: lineNumber(text, cursor) };
}

function scanLocalPaths(text, report) {
  // File URLs can omit the authority entirely. Other schemes need :// here.
  const urls = [...text.matchAll(/\b(?:(file):|([a-z][a-z\d+.-]*):\/\/)[^\s"'`<>]*/gi)];
  const paths = /(?:\/(?:Users|home)\/|[a-zA-Z]:[\\/]Users[\\/])(?=[^\s/\\"'`<>()[\]])/g;
  for (const match of text.matchAll(paths)) {
    const url = urls.find(
      (url) => match.index >= url.index && match.index < url.index + url[0].length,
    );
    if (url) {
      // Check the whole file URL, including its authority and drive letters.
      if ((url[1] ?? url[2]).toLowerCase() !== "file") continue;
    } else if (match.index > 0 && /[a-zA-Z0-9.\-/\\]/.test(text[match.index - 1])) continue;
    report(match.index);
  }
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

function htmlLinksIn(html, state) {
  const links = [];
  // Recognize comments only between tags; attribute values are consumed in full below.
  const tokens = /<!--(?:-?>|[\s\S]*?(?:-->|$))|<\/?[a-zA-Z][^\t\n\f\r />]*/g;
  const whitespace = /[\t\n\f\r ]/;
  while (tokens.lastIndex < html.length) {
    if (state.comment) {
      const end = html.indexOf("-->", tokens.lastIndex);
      if (end === -1) break;
      state.comment = false;
      tokens.lastIndex = end + 3;
    }
    if (state.textTag) {
      // Raw-text/RCDATA contents cannot start tags or comments. Only a matching
      // end tag returns to markup, even inside apparent quoted attributes.
      const endTag = new RegExp(`</${state.textTag}(?=[\\t\\n\\f\\r />])`, "gi");
      endTag.lastIndex = tokens.lastIndex;
      const end = endTag.exec(html);
      if (!end) break;
      state.textTag = undefined;
      tokens.lastIndex = end.index;
    }
    const token = tokens.exec(html);
    if (!token) break;
    if (token[0].startsWith("<!--")) {
      state.comment = !/^(?:<!-->|<!--->)$/.test(token[0]) && !token[0].endsWith("-->");
      continue;
    }
    const closing = token[0].startsWith("</");
    const tag = token[0].slice(closing ? 2 : 1).toLowerCase();
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
    if (
      !closing &&
      html[cursor] === ">" &&
      /^(?:textarea|title|script|style|xmp|iframe|noembed|noframes)$/.test(tag)
    ) {
      state.textTag = tag;
    }
  }
  return links;
}

function linksIn(text) {
  const tokens = marked.lexer(text);
  const links = Object.values(tokens.links).map((link) => decodeCharacterReferences(link.href));
  // Marked splits inline HTML and blank-line-separated blocks into multiple tokens.
  const htmlState = { comment: false, textTag: undefined };
  marked.walkTokens(tokens, (token) => {
    if (
      !htmlState.comment &&
      !htmlState.textTag &&
      (token.type === "link" || token.type === "image")
    )
      links.push(decodeCharacterReferences(token.href));
    if (
      token.type === "html" ||
      // A split comment's closing delimiter can be a plain text leaf token.
      (htmlState.comment && token.type === "text" && !token.tokens)
    ) {
      for (const href of htmlLinksIn(token.text, htmlState)) {
        // HTML URL attributes allow surrounding ASCII whitespace, including encoded whitespace.
        links.push(decodeCharacterReferences(href).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ""));
      }
    }
  });
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
  const bodies = new Map();
  const report = (path, rule) => errors.push(`${path}: ${rule}`);
  const paths = [];

  function inspect(path) {
    const entry = lstatSync(join(root, path), { throwIfNoEntry: false });
    if (entry?.isSymbolicLink()) report(path, "symbolic links are forbidden (target omitted)");
    return entry;
  }

  function children(path) {
    if (!inspect(path)?.isDirectory()) return [];
    return readdirSync(join(root, path))
      .sort()
      .map((name) => join(path, name));
  }

  function collectFiles(path) {
    const entry = inspect(path);
    if (entry?.isFile()) files.add(path);
    else if (entry?.isDirectory()) {
      for (const name of readdirSync(join(root, path)).sort()) collectFiles(join(path, name));
    }
  }

  // Walk explicitly: glob defaults omit hidden companions. lstat refuses symlinks
  // at every level, including entry points and the roots of the scanned directories.
  for (const scope of ["packages", "skills"]) {
    for (const skillDir of children(scope)) {
      if (!inspect(skillDir)?.isDirectory()) continue;
      const path = join(skillDir, "SKILL.md");
      const entry = inspect(path);
      // Other files at skills/ are docs; each shared directory needs an entry point.
      if (!entry && scope === "skills") report(path, "missing SKILL.md");
      if (entry && !entry.isFile() && !entry.isSymbolicLink())
        report(path, "SKILL.md must be a regular file");
      if (!entry?.isFile()) continue;
      paths.push(path);
      files.add(path);
      collectFiles(scope === "skills" ? skillDir : join(skillDir, "references"));
    }
  }

  for (const path of paths.sort()) {
    const skillDir = dirname(path);
    const text = readFileSync(join(root, path), "utf8").replaceAll("\r\n", "\n");
    const frontmatter = /^(?:\uFEFF)?---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
    if (!frontmatter) {
      report(path, "frontmatter must be present and delimited by ---");
      continue;
    }
    const body = text.slice(frontmatter[0].length);
    bodies.set(path, { text: body, lineOffset: lineNumber(text, frontmatter[0].length) - 1 });
    const lines = body === "" ? 0 : body.replace(/\n$/, "").split("\n").length;
    if (lines > 500) report(path, `body exceeds 500 lines (${lines})`);

    let data;
    const quotedScalars = new Map();
    const nodeStarts = [];
    try {
      data = load(frontmatter[1], {
        schema: JSON_SCHEMA,
        listener(event, state) {
          if (event === "open") nodeStarts.push(state.position);
          else {
            const start = nodeStarts.pop();
            if (state.kind !== "scalar") return;
            // A node may start before whitespace, comments, tags, or an anchor.
            const prefix = /^(?:\s|#[^\n]*(?:\n|$)|[!&][^\s]+)*/.exec(
              frontmatter[1].slice(start, state.position),
            )[0];
            const scalarStart = start + prefix.length;
            if (frontmatter[1][scalarStart] === '"') quotedScalars.set(scalarStart, state.position);
          }
        },
      });
    } catch {
      // YAML errors include source excerpts, which may contain credentials.
      report(path, "invalid YAML frontmatter");
      continue;
    }
    // Scan raw syntax too: decoded YAML discards standalone and inline comments.
    for (const { text: rawMetadata, lineOffset } of rawMetadataSegments(
      frontmatter[1],
      quotedScalars,
    )) {
      scanSecrets(rawMetadata, (category, offset) => {
        report(
          path,
          `line ${lineOffset + lineNumber(rawMetadata, offset)}: possible ${category} (value omitted)`,
        );
      });
      scanLocalPaths(rawMetadata, (offset) => {
        report(
          path,
          `line ${lineOffset + lineNumber(rawMetadata, offset)}: absolute user path is forbidden`,
        );
      });
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      report(path, "frontmatter must be a mapping");
      continue;
    }
    const { name, description } = data;
    // Decoding also exposes escaped and folded secrets hidden from the raw scan.
    for (const value of metadataScalars(data)) {
      scanSecrets(value, (category) => {
        report(path, `decoded metadata: possible ${category} (value omitted)`);
      });
      scanLocalPaths(value, () => {
        report(path, "decoded metadata: absolute user path is forbidden (value omitted)");
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
    const { text, lineOffset } = bodies.get(path) ?? {
      text: readFileSync(join(root, path), "utf8"),
      lineOffset: 0,
    };
    scanLocalPaths(text, (offset) => {
      report(
        path,
        `line ${lineOffset + lineNumber(text, offset)}: absolute user path is forbidden`,
      );
    });
    scanSecrets(text, (category, offset) => {
      report(
        path,
        `line ${lineOffset + lineNumber(text, offset)}: possible ${category} (value omitted)`,
      );
    });
    if (!path.endsWith(".md")) continue;
    // Frontmatter is metadata, not Markdown; fenced/inline code is ignored by the lexer.
    const markdown = bodies.has(path)
      ? text
      : text.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
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
