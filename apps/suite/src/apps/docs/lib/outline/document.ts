// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type DocumentAnalysis,
  DocumentOutlineError,
  type DocumentStatistics,
  type NodePath,
  type NodeTextRange,
  type OutlineHeading,
  type PlainTextProjection,
  type TextSpan,
} from "./types";
import { type DocumentNode, readDocument } from "./validation";

interface Heading extends NodeTextRange {
  level: 1 | 2 | 3;
  text: string;
  anchor: string;
  children: Heading[];
}

function project(root: DocumentNode): {
  projection: PlainTextProjection;
  outline: readonly OutlineHeading[];
} {
  const parts: string[] = [];
  const spans: TextSpan[] = [];
  const nodes: NodeTextRange[] = [];
  const outline: Heading[] = [];
  const stack: Heading[] = [];
  const anchors = new Set<string>();
  const suffixes = new Map<string, number>();
  let position = 0;
  function emit(text: string, path: NodePath, kind: TextSpan["kind"]): void {
    if (text.length === 0) return;
    const start = position;
    position += Array.from(text).length;
    parts.push(text);
    spans.push({ start, end: position, path, kind });
  }
  function visit(node: DocumentNode, path: NodePath): void {
    const range = { path, start: position, end: position };
    nodes.push(range);
    const firstPart = parts.length;
    if (node.type === "text") emit(node.text, path, "text");
    else if (node.type === "hardBreak") emit("\n", path, "hardBreak");
    else {
      const separator = ["paragraph", "heading", "codeBlock"].includes(node.type)
        ? ""
        : node.type === "tableRow"
          ? "\t"
          : "\n";
      node.content.forEach((child, index) => {
        if (index > 0) emit(separator, path, "separator");
        visit(child, [...path, index]);
      });
    }
    range.end = position;
    if (node.type === "heading") {
      const text = parts
        .slice(firstPart)
        .join("")
        .replace(/[\s\p{White_Space}]+/gu, " ")
        .trim();
      const base =
        text
          .normalize("NFKD")
          .replace(/\p{M}/gu, "")
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/gu, "") || "section";
      let anchor = base;
      let suffix = suffixes.get(base) ?? 0;
      while (anchors.has(anchor)) anchor = `${base}-${++suffix}`;
      suffixes.set(base, suffix);
      anchors.add(anchor);
      const heading: Heading = { ...range, level: node.level, text, anchor, children: [] };
      while (stack.length > 0 && (stack.at(-1) as Heading).level >= heading.level) stack.pop();
      const parent = stack.at(-1);
      if (parent) parent.children.push(heading);
      else outline.push(heading);
      stack.push(heading);
    }
  }
  visit(root, []);
  return { projection: { text: parts.join(""), spans, nodes }, outline };
}

function statistics(text: string, locale: string): DocumentStatistics {
  if (typeof Intl.Segmenter !== "function") {
    throw new DocumentOutlineError("segmenter-unavailable", "Intl.Segmenter is required");
  }
  try {
    if (
      typeof locale !== "string" ||
      locale.length === 0 ||
      Intl.Segmenter.supportedLocalesOf(locale).length !== 1
    )
      throw new Error();
  } catch {
    throw new DocumentOutlineError("invalid-locale", "Expected a supported segmentation locale");
  }
  let words = 0;
  let characters = 0;
  let charactersWithoutSpaces = 0;
  for (const segment of new Intl.Segmenter(locale, { granularity: "word" }).segment(text)) {
    if (segment.isWordLike) words += 1;
  }
  for (const { segment } of new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(text)) {
    characters += 1;
    if (!/^[\s\p{White_Space}]+$/u.test(segment)) charactersWithoutSpaces += 1;
  }
  return { words, characters, charactersWithoutSpaces, readingTimeMinutes: words / 230 };
}

/** Validate once, then derive the outline, lossless text projection and statistics. */
export function analyzeDocument(input: unknown, locale = "en"): DocumentAnalysis {
  const { projection, outline } = project(readDocument(input));
  return { projection, outline, statistics: statistics(projection.text, locale) };
}

/** Project without requiring Intl.Segmenter; offsets match the Docs anchoring library. */
export function projectPlainText(input: unknown): PlainTextProjection {
  return project(readDocument(input)).projection;
}

export function buildOutline(input: unknown): readonly OutlineHeading[] {
  return project(readDocument(input)).outline;
}

export function documentStatistics(input: unknown, locale = "en"): DocumentStatistics {
  return statistics(projectPlainText(input).text, locale);
}
