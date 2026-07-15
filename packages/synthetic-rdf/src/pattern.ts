// AUTHORED-BY GPT-5.6 Sol via codex

import type { SubStream } from "./types.js";

const MAX_PATTERN_EXPANSION = 32;
export const MAX_PATTERN_OUTPUT = 256;
export const MAX_PATTERN_MATCH_INPUT = 1_024;
const MAX_PATTERN_SOURCE = 1_024;
const MAX_VARIABLE_QUANTIFIERS = 8;
const WORD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_";
const DIGITS = "0123456789";

function codePointLength(value: string): number {
  return [...value].length;
}

type PatternNode =
  | { kind: "choice"; alternatives: PatternNode[] }
  | { kind: "sequence"; children: PatternNode[] }
  | { kind: "characters"; values: string[] }
  | { kind: "repeat"; child: PatternNode; min: number; max: number; sampleMax?: number };

function containsRepeat(node: PatternNode): boolean {
  if (node.kind === "repeat") return true;
  if (node.kind === "choice") return node.alternatives.some(containsRepeat);
  if (node.kind === "sequence") return node.children.some(containsRepeat);
  return false;
}

function containsChoice(node: PatternNode): boolean {
  if (node.kind === "choice") return true;
  if (node.kind === "sequence") return node.children.some(containsChoice);
  if (node.kind === "repeat") return containsChoice(node.child);
  return false;
}

function countVariableQuantifiers(node: PatternNode): number {
  if (node.kind === "repeat") {
    return (node.min === node.max ? 0 : 1) + countVariableQuantifiers(node.child);
  }
  if (node.kind === "choice") {
    return node.alternatives.reduce((total, child) => total + countVariableQuantifiers(child), 0);
  }
  if (node.kind === "sequence") {
    return node.children.reduce((total, child) => total + countVariableQuantifiers(child), 0);
  }
  return 0;
}

class PatternParser {
  #index = 0;
  readonly #source: string;

  constructor(source: string) {
    if (source.length > MAX_PATTERN_SOURCE) {
      throw new Error(`Unsupported SHACL pattern: source exceeds ${MAX_PATTERN_SOURCE} characters`);
    }
    this.#source = source.startsWith("^") ? source.slice(1) : source;
    if (hasTerminalAnchor(this.#source)) {
      this.#source = this.#source.slice(0, -1);
    }
  }

  parse(): PatternNode {
    const parsed = this.#choice();
    if (this.#index !== this.#source.length) {
      throw this.#error(`unexpected token ${JSON.stringify(this.#source[this.#index])}`);
    }
    if (countVariableQuantifiers(parsed) > MAX_VARIABLE_QUANTIFIERS) {
      throw this.#error(
        `more than ${MAX_VARIABLE_QUANTIFIERS} variable quantifiers are unsupported`,
      );
    }
    return parsed;
  }

  #choice(): PatternNode {
    const alternatives = [this.#sequence()];
    while (this.#peek() === "|") {
      this.#index += 1;
      alternatives.push(this.#sequence());
    }
    return alternatives.length === 1
      ? (alternatives[0] as PatternNode)
      : { kind: "choice", alternatives };
  }

  #sequence(): PatternNode {
    const children: PatternNode[] = [];
    while (this.#index < this.#source.length && this.#peek() !== ")" && this.#peek() !== "|") {
      children.push(this.#quantified());
    }
    return children.length === 1 ? (children[0] as PatternNode) : { kind: "sequence", children };
  }

  #quantified(): PatternNode {
    const child = this.#atom();
    const token = this.#peek();
    const repeated = (min: number, max: number, sampleMax?: number): PatternNode => {
      if (containsRepeat(child)) {
        throw this.#error("nested quantifiers are unsupported");
      }
      if (containsChoice(child)) {
        throw this.#error("repeated alternations are unsupported");
      }
      return { kind: "repeat", child, min, max, ...(sampleMax === undefined ? {} : { sampleMax }) };
    };
    if (token === "?") {
      this.#index += 1;
      return repeated(0, 1);
    }
    if (token === "+") {
      this.#index += 1;
      return repeated(1, MAX_PATTERN_OUTPUT, 3);
    }
    if (token === "*") {
      this.#index += 1;
      return repeated(0, MAX_PATTERN_OUTPUT, 2);
    }
    if (token !== "{") {
      return child;
    }
    this.#index += 1;
    const min = this.#integer();
    let max = min;
    if (this.#peek() === ",") {
      this.#index += 1;
      if (this.#peek() === "}") {
        throw this.#error("unbounded explicit quantifiers are unsupported");
      }
      max = this.#integer();
    }
    if (this.#peek() !== "}") {
      throw this.#error("unterminated quantifier");
    }
    this.#index += 1;
    if (max < min || max > MAX_PATTERN_EXPANSION) {
      throw this.#error(`quantifier range ${min}..${max} exceeds the supported expansion cap`);
    }
    return repeated(min, max);
  }

  #atom(): PatternNode {
    const token = this.#peek();
    if (token === undefined) {
      throw this.#error("unexpected end of pattern");
    }
    if (token === "(") {
      this.#index += 1;
      if (this.#source.slice(this.#index, this.#index + 2) === "?:") {
        this.#index += 2;
      } else if (this.#peek() === "?") {
        throw this.#error("lookarounds and special groups are unsupported");
      }
      const child = this.#choice();
      if (this.#peek() !== ")") {
        throw this.#error("unterminated group");
      }
      this.#index += 1;
      return child;
    }
    if (token === "[") {
      return { kind: "characters", values: this.#characterClass() };
    }
    if (token === "\\") {
      this.#index += 1;
      const escaped = this.#peek();
      if (escaped === undefined) {
        throw this.#error("trailing escape");
      }
      this.#index += 1;
      if (escaped === "d") return { kind: "characters", values: [...DIGITS] };
      if (escaped === "w") return { kind: "characters", values: [...WORD] };
      if (/^[A-Za-z1-9]$/.test(escaped)) {
        throw this.#error(`unsupported escape \\${escaped}`);
      }
      return { kind: "characters", values: [escaped] };
    }
    if (token === "." || token === "^" || token === "$" || token === ")") {
      throw this.#error(`unsupported token ${JSON.stringify(token)}`);
    }
    return { kind: "characters", values: [this.#consumeCharacter()] };
  }

  #characterClass(): string[] {
    this.#index += 1;
    if (this.#peek() === "^") {
      throw this.#error("negated character classes are unsupported");
    }
    const values: string[] = [];
    while (this.#index < this.#source.length && this.#peek() !== "]") {
      const start = this.#classCharacter();
      if (this.#peek() === "-" && this.#source[this.#index + 1] !== "]") {
        this.#index += 1;
        const end = this.#classCharacter();
        if (start.codePointAt(0) === undefined || end.codePointAt(0) === undefined) {
          throw this.#error("empty character-class range");
        }
        const startCode = start.codePointAt(0) as number;
        const endCode = end.codePointAt(0) as number;
        if (endCode < startCode || endCode - startCode > 127) {
          throw this.#error("only ascending ASCII-sized character-class ranges are supported");
        }
        for (let code = startCode; code <= endCode; code += 1) {
          values.push(String.fromCodePoint(code));
        }
      } else {
        values.push(start);
      }
    }
    if (this.#peek() !== "]") {
      throw this.#error("unterminated character class");
    }
    this.#index += 1;
    if (values.length === 0) {
      throw this.#error("empty character classes are unsupported");
    }
    return [...new Set(values)].sort();
  }

  #classCharacter(): string {
    const token = this.#peek();
    if (token === undefined) throw this.#error("unterminated character class");
    if (token !== "\\") return this.#consumeCharacter();
    this.#index += 1;
    const escaped = this.#peek();
    if (escaped === undefined) throw this.#error("trailing character-class escape");
    const escapedCharacter = this.#consumeCharacter();
    if (/^[A-Za-z]$/.test(escaped)) {
      throw this.#error(`unsupported character-class escape \\${escaped}`);
    }
    return escapedCharacter;
  }

  #consumeCharacter(): string {
    const codePoint = this.#source.codePointAt(this.#index);
    if (codePoint === undefined) throw this.#error("unexpected end of pattern");
    const character = String.fromCodePoint(codePoint);
    this.#index += character.length;
    return character;
  }

  #integer(): number {
    const start = this.#index;
    while (/^[0-9]$/.test(this.#peek() ?? "")) this.#index += 1;
    if (start === this.#index) throw this.#error("expected an integer quantifier");
    return Number(this.#source.slice(start, this.#index));
  }

  #peek(): string | undefined {
    return this.#source[this.#index];
  }

  #error(message: string): Error {
    return new Error(`Unsupported SHACL pattern at offset ${this.#index}: ${message}`);
  }
}

function expand(node: PatternNode, random: SubStream, coordinate: string): string {
  switch (node.kind) {
    case "characters":
      return random.fork(coordinate).pick(node.values);
    case "choice": {
      const choice = random.fork(`${coordinate}:choice`).int(0, node.alternatives.length - 1);
      const selected = node.alternatives[choice];
      if (selected === undefined) throw new Error("Pattern alternative unexpectedly absent");
      return expand(selected, random, `${coordinate}:alternative:${choice}`);
    }
    case "sequence": {
      const result = node.children
        .map((child, index) => expand(child, random, `${coordinate}:sequence:${index}`))
        .join("");
      if (codePointLength(result) > MAX_PATTERN_OUTPUT) {
        throw new Error(`SHACL pattern expansion exceeds ${MAX_PATTERN_OUTPUT} characters`);
      }
      return result;
    }
    case "repeat": {
      const count = random.fork(`${coordinate}:count`).int(node.min, node.sampleMax ?? node.max);
      let result = "";
      for (let index = 0; index < count; index += 1) {
        result += expand(node.child, random, `${coordinate}:repeat:${index}`);
        if (codePointLength(result) > MAX_PATTERN_OUTPUT) {
          throw new Error(`SHACL pattern expansion exceeds ${MAX_PATTERN_OUTPUT} characters`);
        }
      }
      return result;
    }
  }
}

type LengthMemo = WeakMap<PatternNode, Map<number, readonly number[]>>;

function combinedLengths(
  left: readonly number[],
  right: readonly number[],
  limit: number,
): number[] {
  const combined = new Set<number>();
  for (const leftLength of left) {
    for (const rightLength of right) {
      const length = leftLength + rightLength;
      if (length <= limit) combined.add(length);
    }
  }
  return [...combined].sort((leftLength, rightLength) => leftLength - rightLength);
}

function possibleSequenceLengths(
  children: readonly PatternNode[],
  limit: number,
  memo: LengthMemo,
): number[] {
  let lengths: readonly number[] = [0];
  for (const child of children) {
    lengths = combinedLengths(lengths, possibleLengths(child, limit, memo), limit);
    if (lengths.length === 0) break;
  }
  return [...lengths];
}

function possibleRepeatLengths(
  child: PatternNode,
  count: number,
  limit: number,
  memo: LengthMemo,
): number[] {
  return possibleSequenceLengths(
    Array.from({ length: count }, () => child),
    limit,
    memo,
  );
}

function possibleLengths(node: PatternNode, limit: number, memo: LengthMemo): number[] {
  const cached = memo.get(node)?.get(limit);
  if (cached !== undefined) return [...cached];
  let lengths: number[];
  switch (node.kind) {
    case "characters":
      lengths = limit >= 1 ? [1] : [];
      break;
    case "choice":
      lengths = [
        ...new Set(
          node.alternatives.flatMap((alternative) => possibleLengths(alternative, limit, memo)),
        ),
      ].sort((left, right) => left - right);
      break;
    case "sequence":
      lengths = possibleSequenceLengths(node.children, limit, memo);
      break;
    case "repeat": {
      const result = new Set<number>();
      let exact: readonly number[] = [0];
      for (let count = 0; count <= node.max; count += 1) {
        if (count >= node.min) {
          for (const length of exact) result.add(length);
        }
        if (count === node.max || exact.length === 0) break;
        exact = combinedLengths(exact, possibleLengths(node.child, limit, memo), limit);
      }
      lengths = [...result].sort((left, right) => left - right);
      break;
    }
  }
  const byLimit = memo.get(node) ?? new Map<number, readonly number[]>();
  byLimit.set(limit, lengths);
  memo.set(node, byLimit);
  return [...lengths];
}

function expandSequenceAtLength(
  children: readonly PatternNode[],
  targetLength: number,
  random: SubStream,
  coordinate: string,
  memo: LengthMemo,
): string {
  let remaining = targetLength;
  const values: string[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index] as PatternNode;
    const suffix = children.slice(index + 1);
    const suffixLengths = new Set(possibleSequenceLengths(suffix, remaining, memo));
    const candidates = possibleLengths(child, remaining, memo).filter((length) =>
      suffixLengths.has(remaining - length),
    );
    if (candidates.length === 0) throw new Error("Pattern length plan unexpectedly absent");
    const childLength = random.fork(`${coordinate}:sequence:${index}:length`).pick(candidates);
    values.push(
      expandAtLength(child, childLength, random, `${coordinate}:sequence:${index}`, memo),
    );
    remaining -= childLength;
  }
  if (remaining !== 0) throw new Error("Pattern length plan did not consume its target");
  return values.join("");
}

function expandAtLength(
  node: PatternNode,
  targetLength: number,
  random: SubStream,
  coordinate: string,
  memo: LengthMemo,
): string {
  switch (node.kind) {
    case "characters":
      if (targetLength !== 1) throw new Error("Character node cannot satisfy planned length");
      return random.fork(coordinate).pick(node.values);
    case "choice": {
      const candidates = node.alternatives.filter((alternative) =>
        possibleLengths(alternative, targetLength, memo).includes(targetLength),
      );
      const selected = random.fork(`${coordinate}:choice`).pick(candidates);
      return expandAtLength(selected, targetLength, random, `${coordinate}:alternative`, memo);
    }
    case "sequence":
      return expandSequenceAtLength(node.children, targetLength, random, coordinate, memo);
    case "repeat": {
      const counts = Array.from(
        { length: node.max - node.min + 1 },
        (_, index) => node.min + index,
      ).filter((count) =>
        possibleRepeatLengths(node.child, count, targetLength, memo).includes(targetLength),
      );
      const count = random.fork(`${coordinate}:count`).pick(counts);
      return expandSequenceAtLength(
        Array.from({ length: count }, () => node.child),
        targetLength,
        random,
        `${coordinate}:repeat`,
        memo,
      );
    }
  }
}

export function generatePattern(pattern: string, random: SubStream): string {
  return expand(new PatternParser(pattern).parse(), random, "root");
}

export function validatePatternSyntax(pattern: string): void {
  new PatternParser(pattern).parse();
}

function hasTerminalAnchor(pattern: string): boolean {
  if (!pattern.endsWith("$")) return false;
  let backslashes = 0;
  for (let index = pattern.length - 2; index >= 0 && pattern[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 0;
}

export function generatePatternWithLength(
  pattern: string,
  random: SubStream,
  minLength: number,
  maxLength: number,
): string {
  const parsed = new PatternParser(pattern).parse();
  const matcher = new RegExp(pattern, "u");
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const attemptRandom = attempt === 0 ? random : random.fork(`length:${attempt}`);
    const value = expand(parsed, attemptRandom, "root");
    const initialLength = codePointLength(value);
    if (initialLength >= minLength && initialLength <= maxLength) return value;
    if (initialLength < minLength) {
      const padding = "x".repeat(minLength - initialLength);
      for (const candidate of [`${value}${padding}`, `${padding}${value}`]) {
        const paddedLength = codePointLength(candidate);
        if (
          paddedLength <= MAX_PATTERN_OUTPUT &&
          paddedLength <= maxLength &&
          matcher.test(candidate)
        ) {
          return candidate;
        }
      }
    }
  }
  const memo: LengthMemo = new WeakMap();
  const feasibleLengths = possibleLengths(
    parsed,
    Math.min(maxLength, MAX_PATTERN_OUTPUT),
    memo,
  ).filter((length) => length >= minLength);
  if (feasibleLengths.length > 0) {
    const targetLength = random.fork("length:exact").pick(feasibleLengths);
    return expandAtLength(parsed, targetLength, random.fork("length:exact"), "root", memo);
  }
  throw new Error(`SHACL pattern cannot satisfy length interval ${minLength}..${maxLength}`);
}
