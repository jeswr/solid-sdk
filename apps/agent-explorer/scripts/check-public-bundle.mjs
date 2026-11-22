// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// Fails when any file of a public site build carries any roadmap text of 40 characters or more, or when
// the build holds a symbolic link (an upload would follow it). The roadmap is the team's working
// plan and is never published; checking its text, not a key name, also catches a copy that
// arrived another way (for example inside a spec or under media/). Usage:
// node scripts/check-public-bundle.mjs <site-dir or file>
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!target) throw new Error("usage: check-public-bundle.mjs <site-dir or file>");
const roadmap = JSON.parse(readFileSync(join(root, "data/roadmap.json"), "utf8"));

function* strings(value) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === "string") yield item;
    else if (item && typeof item === "object") {
      for (const child of Object.values(item)) pending.push(child);
    }
  }
}

const probes = [...new Set([...strings(roadmap)].filter((text) => text.length >= 40))];
if (probes.length < 3) throw new Error("the roadmap has too few long texts to check against");
const pattern = (texts) => new RegExp(texts.map(RegExp.escape).join("|"));
const plain = pattern(probes);
const raw = pattern(probes.flatMap((text) => [text, JSON.stringify(text).slice(1, -1)]));

const escapes = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
function unescapeLiterals(text) {
  // JSON-LD and Turtle/TriG share short escapes and \\u escapes. RDF also allows \\U.
  return text.replaceAll(
    /\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|(["'\\/bfnrt]))/g,
    (escapeSequence, short, long, character) => {
      if (character) return escapes[character] ?? character;
      const code = Number.parseInt(short ?? long, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : escapeSequence;
    },
  );
}

function carriesRoadmap(path, text) {
  const extension = extname(path).toLowerCase();
  const json = extension === ".json" || extension === ".jsonld" ? JSON.parse(text) : undefined;
  if (raw.test(text)) return true;
  if (extension === ".ttl" || extension === ".trig") return plain.test(unescapeLiterals(text));
  for (const value of strings(json)) {
    if (value.length < 40) continue;
    if (plain.test(value) || (value.includes("\\") && plain.test(unescapeLiterals(value))))
      return true;
  }
  return false;
}

const problems = [];
let files = 0;
(function scan(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    problems.push(`${path} is a symbolic link`);
  } else if (stat.isDirectory()) {
    for (const name of readdirSync(path)) scan(join(path, name));
  } else if (stat.isFile()) {
    files += 1;
    if (carriesRoadmap(path, readFileSync(path, "utf8")))
      problems.push(`${path} carries roadmap text`);
  } else {
    problems.push(`${path} is not a regular file`);
  }
})(target);
if (problems.length) {
  for (const p of problems) console.error(p);
  console.error("the roadmap must not be published, and the site must hold only regular files");
  process.exit(1);
}
console.log(`${target}: ${files} files, no roadmap text (${probes.length} probes), no links`);
