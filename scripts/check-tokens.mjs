#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Blank comments while retaining offsets/lines and colour literals inside strings. */
export function withoutComments(source, extension = ".ts") {
  const lineComments = /^\.[cm]?[jt]sx?$/.test(extension);
  let result = "";
  let quote = "";
  for (let i = 0; i < source.length; ) {
    const char = source[i];
    if (quote) {
      result += char;
      i++;
      if (char === "\\" && i < source.length) result += source[i++];
      else if (char === quote) quote = "";
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
      result += char;
      i++;
    } else {
      const end = source.startsWith("/*", i)
        ? "*/"
        : source.startsWith("<!--", i)
          ? "-->"
          : lineComments && source.startsWith("//", i)
            ? "\n"
            : null;
      if (!end) {
        result += char;
        i++;
        continue;
      }
      const stop = source.indexOf(end, i + 2);
      const next = stop < 0 ? source.length : stop + (end === "\n" ? 0 : end.length);
      result += source.slice(i, next).replace(/[^\n]/g, " ");
      i = next;
    }
  }
  return result;
}
export function scanColours(source, extension = ".ts") {
  const stripped = withoutComments(source, extension);
  return [
    ...stripped.matchAll(
      /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|\b(?:oklch|rgba?|hsla?)\s*\(/gi,
    ),
  ].map((match) => ({
    literal: match[0],
    line: stripped.slice(0, match.index).split("\n").length,
  }));
}
export function scanDirectory(directory) {
  const failures = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist", "artifacts", "coverage"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) failures.push(...scanDirectory(path));
    else if (
      entry.isFile() &&
      /\.(?:[cm]?[jt]sx?|css|scss|html|svg|json|mdx)$/.test(extname(path))
    ) {
      failures.push(
        ...scanColours(readFileSync(path, "utf8"), extname(path)).map((issue) => ({
          path,
          ...issue,
        })),
      );
    }
  }
  return failures;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL("../apps/suite/", import.meta.url));
  const failures = scanDirectory(directory);
  for (const issue of failures)
    console.error(`${issue.path}:${issue.line}: raw colour ${issue.literal}`);
  console.log(`Suite token gate: ${failures.length} raw colour literal(s).`);
  process.exitCode = failures.length ? 1 : 0;
}
