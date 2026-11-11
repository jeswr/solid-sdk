#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";
import {
  isRecord,
  parseSource,
  readBaseline,
  sourceFiles,
  sourceTokens,
  writeBaseline,
} from "./code-quality.mjs";

const baselineName = "app-duplication-baseline.json";
const hint = "move shared logic into a packages/* library (AGENTS.md)";
const digest = (text) => createHash("sha256").update(text).digest("hex");

// Erased declarations are barriers: windows never join unrelated code across one.
export function tokenSegments(source) {
  const segments = [];
  let codes = [];
  let lines = [];
  function flush() {
    if (codes.length)
      segments.push({ codes: Uint16Array.from(codes), lines: Uint32Array.from(lines) });
    codes = [];
    lines = [];
  }
  for (const { kind: scannedKind, start, end } of sourceTokens(source, {
    skipDeclarations: true,
  })) {
    if (scannedKind === undefined) {
      flush();
      continue;
    }
    if (
      scannedKind >= ts.SyntaxKind.FirstTriviaToken &&
      scannedKind <= ts.SyntaxKind.LastTriviaToken
    )
      continue;
    let kind = scannedKind;
    if (kind === ts.SyntaxKind.Identifier || kind === ts.SyntaxKind.PrivateIdentifier) {
      kind = ts.SyntaxKind.Identifier;
    } else if (
      kind === ts.SyntaxKind.TrueKeyword ||
      kind === ts.SyntaxKind.FalseKeyword ||
      kind === ts.SyntaxKind.NullKeyword
    ) {
      kind = ts.SyntaxKind.StringLiteral;
    }
    codes.push(kind);
    // End line matters for multiline literals; no source text is stored in baselines.
    lines.push(
      source.getLineAndCharacterOfPosition(start).line + 1,
      source.getLineAndCharacterOfPosition(end - 1).line + 1,
    );
  }
  flush();
  return segments;
}

function windowSize(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 2) throw new Error("--window must be an integer >= 2");
  return size;
}

export function scanAppDuplication(root, window = 120) {
  window = windowSize(window);
  const files = sourceFiles(root, true);
  const segments = [];
  let nextPosition = 0;
  for (const file of files) {
    for (const segment of tokenSegments(parseSource(root, file.path))) {
      if (segment.codes.length < window) continue;
      segments.push({ ...file, ...segment, base: nextPosition });
      // Leave a gap so a predecessor can never cross a segment boundary.
      nextPosition += segment.codes.length + 1;
    }
  }
  function locate(position) {
    let low = 0;
    let high = segments.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (segments[middle].base <= position) low = middle;
      else high = middle;
    }
    const segment = segments[low];
    return { segment, start: position - segment.base };
  }
  // Two rolling 32-bit hashes packed into an exact 53-bit numeric map key.
  // Candidate matches are verified using the complete token sequence below.
  const base1 = 16777619;
  const base2 = 65599;
  let power1 = 1;
  let power2 = 1;
  for (let i = 1; i < window; i++) {
    power1 = Math.imul(power1, base1);
    power2 = Math.imul(power2, base2);
  }
  const hashes = new Map();
  for (const segment of segments) {
    const { codes } = segment;
    let hash1 = 0;
    let hash2 = 0;
    for (let i = 0; i < codes.length; i++) {
      if (i >= window) {
        hash1 = (hash1 - Math.imul(codes[i - window] + 1, power1)) | 0;
        hash2 = (hash2 - Math.imul(codes[i - window] + 1, power2)) | 0;
      }
      hash1 = (Math.imul(hash1, base1) + codes[i] + 1) | 0;
      hash2 = (Math.imul(hash2, base2) + codes[i] + 1) | 0;
      if (i + 1 < window) continue;
      const key = (hash1 >>> 0) * 0x200000 + (hash2 & 0x1fffff);
      const position = segment.base + i + 1 - window;
      const previous = hashes.get(key);
      if (previous === undefined) hashes.set(key, position);
      else if (typeof previous === "number") hashes.set(key, [previous, position]);
      else previous.push(position);
    }
  }
  const groups = [];
  const byPosition = new Map();
  for (const occurrences of hashes.values()) {
    if (typeof occurrences === "number") continue;
    const projects = new Set(occurrences.map((position) => locate(position).segment.project));
    if (projects.size < 2 || ![...projects].some((project) => project.startsWith("apps/")))
      continue;
    const exact = new Map();
    for (const position of occurrences) {
      const { segment, start } = locate(position);
      const signature = segment.codes.subarray(start, start + window).join(",");
      if (!exact.has(signature)) exact.set(signature, []);
      exact.get(signature).push(position);
    }
    for (const [signature, positions] of exact) {
      const matchedProjects = new Set(
        positions.map((position) => locate(position).segment.project),
      );
      if (
        matchedProjects.size < 2 ||
        ![...matchedProjects].some((project) => project.startsWith("apps/"))
      )
        continue;
      const id = groups.length;
      groups.push({ signature, positions, parent: id });
      for (const position of positions) byPosition.set(position, id);
    }
  }
  hashes.clear();
  function find(id) {
    while (groups[id].parent !== id) {
      groups[id].parent = groups[groups[id].parent].parent;
      id = groups[id].parent;
    }
    return id;
  }
  // Coalesce overlapping windows that advance together at every occurrence.
  // Requiring the same occurrences prevents transitive chains of unrelated
  // fragments from turning entire applications into a single giant clone.
  for (let id = 0; id < groups.length; id++) {
    const { positions } = groups[id];
    const previous = byPosition.get(positions[0] - 1);
    if (
      previous === undefined ||
      previous === id ||
      groups[previous].positions.length !== positions.length
    )
      continue;
    if (positions.every((position) => byPosition.get(position - 1) === previous)) {
      groups[find(id)].parent = find(previous);
    }
  }
  const components = new Map();
  for (let id = 0; id < groups.length; id++) {
    const parent = find(id);
    if (!components.has(parent)) components.set(parent, []);
    components.get(parent).push(id);
  }
  const clusters = [];
  for (const ids of components.values()) {
    const ranges = new Map();
    for (const id of ids) {
      for (const position of groups[id].positions) {
        const { segment, start } = locate(position);
        if (!ranges.has(segment)) ranges.set(segment, []);
        ranges.get(segment).push({ start, end: start + window });
      }
    }
    const locations = [];
    let anchor;
    for (const [segment, intervals] of ranges) {
      intervals.sort((a, b) => a.start - b.start);
      const merged = [];
      for (const interval of intervals) {
        const last = merged.at(-1);
        if (last && interval.start < last.end) last.end = Math.max(last.end, interval.end);
        else merged.push({ ...interval });
      }
      for (const { start, end } of merged) {
        anchor ??= segment.codes.subarray(start, start + window).join(",");
        locations.push({
          file: segment.path,
          startLine: segment.lines[start * 2],
          endLine: segment.lines[(end - 1) * 2 + 1],
          tokens: end - start,
        });
      }
    }
    locations.sort((a, b) => a.file.localeCompare(b.file, "en") || a.startLine - b.startLine);
    const projects = [
      ...new Set(locations.map((location) => location.file.split("/").slice(0, 2).join("/"))),
    ].sort();
    const fingerprint = digest(JSON.stringify([window, anchor, projects]));
    clusters.push({
      fingerprint,
      tokens: Math.max(...locations.map((location) => location.tokens)),
      projects,
      locations,
    });
  }
  clusters.sort((a, b) => a.fingerprint.localeCompare(b.fingerprint, "en"));
  return { files: files.length, window, clusters };
}

// Ignore line movement caused by comments/formatting, but ratchet occurrence
// counts and token lengths per file as well as cluster membership.
function footprint(cluster) {
  const files = {};
  for (const { file, tokens } of cluster.locations) {
    files[file] ??= [];
    files[file].push(tokens);
  }
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(files)
        .sort()
        .map(([file, sizes]) => [file, sizes.sort((a, b) => a - b)]),
    ),
  );
}

export function checkAppDuplication(root, { updateBaseline = false, window = 120 } = {}) {
  const result = { ...scanAppDuplication(root, window), problems: [] };
  const current = Object.fromEntries(
    result.clusters.map(({ fingerprint, tokens, locations }) => [
      fingerprint,
      { tokens, locations },
    ]),
  );
  if (updateBaseline) {
    writeBaseline(root, baselineName, { window: result.window, clusters: current });
    return result;
  }
  const baseline = readBaseline(root, baselineName) ?? { window: result.window, clusters: {} };
  if (
    !isRecord(baseline) ||
    baseline.window !== result.window ||
    !isRecord(baseline.clusters) ||
    Object.entries(baseline.clusters).some(
      ([fingerprint, cluster]) =>
        !/^[a-f0-9]{64}$/.test(fingerprint) ||
        !isRecord(cluster) ||
        !Number.isSafeInteger(cluster.tokens) ||
        cluster.tokens < result.window ||
        !Array.isArray(cluster.locations) ||
        cluster.locations.length < 2 ||
        cluster.locations.some(
          (location) =>
            !isRecord(location) ||
            typeof location.file !== "string" ||
            !Number.isSafeInteger(location.tokens) ||
            location.tokens < result.window ||
            !Number.isSafeInteger(location.startLine) ||
            location.startLine < 1 ||
            !Number.isSafeInteger(location.endLine) ||
            location.endLine < location.startLine,
        ),
    )
  ) {
    throw new Error(
      `Invalid or incompatible scripts/${baselineName}; run pnpm run check:app-duplication --update-baseline with the same --window`,
    );
  }
  for (const cluster of result.clusters) {
    const previous = baseline.clusters[cluster.fingerprint];
    if (!previous || footprint(previous) !== footprint(cluster)) {
      result.problems.push(
        `Duplicate cluster ${cluster.fingerprint} (${cluster.tokens} tokens): ${previous ? "changed occurrences; run pnpm run check:app-duplication --update-baseline after reductions" : "new cluster"}\n${cluster.locations.map((location) => `  ${location.file}:${location.startLine}-${location.endLine}`).join("\n")}\n  ${hint}`,
      );
    }
  }
  for (const fingerprint of Object.keys(baseline.clusters)) {
    if (!current[fingerprint])
      result.problems.push(
        `Stale duplicate cluster ${fingerprint}; run pnpm run check:app-duplication --update-baseline`,
      );
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        root: { type: "string" },
        window: { type: "string", default: "120" },
        "update-baseline": { type: "boolean", default: false },
      },
    });
    const result = checkAppDuplication(
      resolve(values.root ?? fileURLToPath(new URL("..", import.meta.url))),
      { window: values.window, updateBaseline: values["update-baseline"] },
    );
    for (const problem of result.problems) console.error(problem);
    console.log(
      `App duplication: ${result.files} files scanned, ${result.clusters.length} clusters (window ${result.window}).${values["update-baseline"] ? " Baseline updated." : ""}`,
    );
    if (result.problems.length) process.exitCode = 1;
  } catch (error) {
    console.error(`App duplication guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
