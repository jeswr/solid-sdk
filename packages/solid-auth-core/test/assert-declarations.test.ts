// AUTHORED-BY GPT-5.6
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertDeclarationsSelfContained } from "../scripts/assert-declarations.mjs";

function withDeclaration(
  relativePath: string,
  contents: string,
  assertion: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "solid-auth-core-declarations-"));
  try {
    const declarationPath = join(root, relativePath);
    mkdirSync(dirname(declarationPath), { recursive: true });
    writeFileSync(declarationPath, contents);
    assertion(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("assertDeclarationsSelfContained", () => {
  it("accepts declarations without workspace-only references", () => {
    withDeclaration(
      "index.d.ts",
      'export type Value = import("oauth4webapi").JsonValue;',
      (root) => {
        expect(() => assertDeclarationsSelfContained(root)).not.toThrow();
      },
    );
  });

  it("rejects a package-root declaration reference", () => {
    withDeclaration(
      "index.d.ts",
      'export type Session = import("@jeswr/solid-session-restore").PersistedSession;',
      (root) => {
        expect(() => assertDeclarationsSelfContained(root)).toThrow(
          "references inlined dependency @jeswr/solid-session-restore",
        );
      },
    );
  });

  it("rejects a nested subpath declaration reference", () => {
    withDeclaration(
      "react/index.d.ts",
      'export type SessionStore = import("@jeswr/solid-session-restore/store").SessionStore;',
      (root) => {
        expect(() => assertDeclarationsSelfContained(root)).toThrow(
          "references inlined dependency @jeswr/solid-session-restore",
        );
      },
    );
  });

  it.each([
    "index.d.mts",
    "index.d.cts",
  ])("rejects a package reference in %s output", (relativePath) => {
    withDeclaration(
      relativePath,
      'export type Session = import("@jeswr/solid-session-restore").PersistedSession;',
      (root) => {
        expect(() => assertDeclarationsSelfContained(root)).toThrow(
          "references inlined dependency @jeswr/solid-session-restore",
        );
      },
    );
  });
});
