// AUTHORED-BY Claude Opus 5.5
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as errors from "./errors.js";
import * as react from "./react.js";
import * as refs from "./refs.js";

const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  exports: Record<string, { types: string; default: string }>;
};

describe("pure subpaths", () => {
  it.each([
    [
      "./refs",
      "refs",
      refs,
      ["RefError", "decodeIdentifierRef", "decodeRef", "encodeIdentifierRef", "encodeRef"],
    ],
    ["./errors", "errors", errors, ["classifyError"]],
  ] as const)("%s exports exactly the helpers ./react re-exports", (subpath, file, module, names) => {
    expect(manifest.exports[subpath]).toEqual({
      types: `./dist/${file}.d.ts`,
      default: `./dist/${file}.js`,
    });
    expect(Object.keys(module).sort()).toEqual([...names]);
    for (const name of names) {
      expect((react as Record<string, unknown>)[name]).toBe(
        (module as Record<string, unknown>)[name],
      );
    }
  });

  it.each(["refs", "errors"])("keeps %s free of React and client directives", (file) => {
    const source = readFileSync(join(process.cwd(), "src", `${file}.ts`), "utf8");
    expect(source).not.toMatch(/from "react"|"use client"|\.\/react|\.\/index|\.\/offline/);
  });
});
