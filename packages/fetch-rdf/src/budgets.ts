// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DataFactory as RdfDataFactory, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { RdfFetchError } from "./errors.js";
import { checkAbort } from "./operation.js";
import type { ParseRdfOptions } from "./types.js";

export const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_QUADS = 1_000_000;
export const DEFAULT_MAX_JSON_DEPTH = 128;

export function parseLimit(name: string): RdfFetchError {
  return new RdfFetchError(`Parse budget exceeded: ${name}.`, { code: "PARSE_LIMIT" });
}

export function limit(
  value: number | undefined,
  fallback: number,
  name: string,
  minimum = 0,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw new RdfFetchError(`Invalid parse budget: ${name}.`, { code: "PARSE_LIMIT" });
  }
  return result;
}

/** Scan raw JSON before parser allocation, retaining lexical state across chunks. */
export function jsonDepthScanner(maxDepth: number): (text: string) => void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  return (text) => {
    for (const char of text) {
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "[" || char === "{") {
        if (++depth > maxDepth) throw parseLimit("maxJsonDepth");
      } else if (char === "]" || char === "}") depth = Math.max(0, depth - 1);
    }
  };
}

/**
 * Copy a custom loader's result into plain JSON data, enforcing depth while copying.
 * The parser receives only this snapshot, so accessors, inherited or non-enumerable
 * properties and later mutations cannot add nesting after the check.
 */
export function snapshotJson(document: unknown, maxDepth: number): unknown {
  const root: { value?: unknown } = {};
  const stack: { source: object; target: Record<string, unknown> | unknown[]; depth: number }[] =
    [];
  const copy = (value: unknown, depth: number): unknown => {
    // Functions are not JSON data; a copied callback (such as a `then`) could run after the check.
    if (typeof value === "function") throw new TypeError("Context documents must be JSON data.");
    if (value === null || typeof value !== "object") return value;
    if (depth > maxDepth) throw parseLimit("maxJsonDepth");
    const target: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
    stack.push({ source: value, target, depth });
    return target;
  };
  root.value = copy(document, 1);
  for (let frame = stack.pop(); frame; frame = stack.pop()) {
    const { source, target, depth } = frame;
    if (Array.isArray(target)) {
      const items = source as unknown[];
      for (let index = 0; index < items.length; index++) target.push(copy(items[index], depth + 1));
    } else {
      for (const key of Object.keys(source)) {
        // Define rather than assign so a "__proto__" key stays plain data.
        Object.defineProperty(target, key, {
          value: copy((source as Record<string, unknown>)[key], depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
  }
  return root.value;
}

/** Check expanded terms before a quad can enter any parser output buffer. */
export function budgetFactory(
  options: ParseRdfOptions,
  signal: AbortSignal,
  check?: () => void,
): {
  factory: RdfDataFactory;
  start: () => void;
} {
  const maxQuads = limit(options.maxQuads, DEFAULT_MAX_QUADS, "maxQuads");
  const maxTermLength = limit(options.maxTermLength, 1024 * 1024, "maxTermLength");
  const maxTotalTermLength = limit(
    options.maxTotalTermLength,
    64 * 1024 * 1024,
    "maxTotalTermLength",
  );
  let started = false;
  let allocatedCharacters = 0;
  const allocate = (value: string): void => {
    if (!started) return; // Parser constructors create a fixed set of vocabulary constants.
    check?.();
    checkAbort(signal);
    if (value.length > maxTermLength) throw parseLimit("maxTermLength");
    allocatedCharacters += value.length;
    if (allocatedCharacters > maxTotalTermLength) throw parseLimit("maxTotalTermLength");
  };
  let quads = 0;
  let characters = 0;
  const term = (value: Term): void => {
    if (value.termType === "Quad") {
      for (const part of [value.subject, value.predicate, value.object, value.graph]) term(part);
      return;
    }
    if (value.value.length > maxTermLength) throw parseLimit("maxTermLength");
    characters += value.value.length;
    if (characters > maxTotalTermLength) throw parseLimit("maxTotalTermLength");
    if (value.termType === "Literal") {
      term(value.datatype);
      characters += value.language.length;
      if (characters > maxTotalTermLength) throw parseLimit("maxTotalTermLength");
    }
  };
  const factory: RdfDataFactory = {
    ...DataFactory,
    namedNode(value) {
      allocate(value);
      return DataFactory.namedNode(value);
    },
    blankNode(value) {
      if (value !== undefined) allocate(value);
      return DataFactory.blankNode(value);
    },
    // jsonld-streaming-parser passes null for an absent language/datatype.
    literal(value, languageOrDatatype) {
      allocate(value);
      if (typeof languageOrDatatype === "string") allocate(languageOrDatatype);
      else if (languageOrDatatype && "termType" in languageOrDatatype)
        allocate(languageOrDatatype.value);
      return (DataFactory.literal as RdfDataFactory["literal"])(
        value,
        languageOrDatatype ?? undefined,
      );
    },
    quad(subject, predicate, object, graph = DataFactory.defaultGraph()) {
      check?.();
      checkAbort(signal);
      if (++quads > maxQuads) throw parseLimit("maxQuads");
      for (const part of [subject, predicate, object, graph]) term(part);
      return DataFactory.quad(subject, predicate, object, graph);
    },
  };
  return {
    factory,
    start: () => {
      started = true;
    },
  };
}

/** UTF-8 byte count without allocating a second, encoded copy of buffered input. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Bounded engine/context buffer. Cancellation must never delay failure delivery. */
export async function bufferBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
  checkChunk?: (text: string) => void,
): Promise<string> {
  checkAbort(signal);
  const reader = body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) break;
      if (value !== undefined) {
        bytes += value.byteLength;
        if (bytes > maxBytes) throw parseLimit("maxBytes");
        const text = decoder.decode(value, { stream: true });
        checkChunk?.(text);
        chunks.push(text);
      }
    }
    const tail = decoder.decode();
    checkChunk?.(tail);
    chunks.push(tail);
    return chunks.join("");
  } catch (cause) {
    cancel();
    throw cause;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
