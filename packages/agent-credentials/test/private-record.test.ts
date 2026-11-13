// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: credential package uses bare module specifiers
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, it } from "vitest";
import { z } from "zod";
import { CredentialStore } from "../src/index.js";

it("validates generic private records before atomic replacement", () => {
  const dir = mkdtempSync(join(tmpdir(), "credential-record-"));
  try {
    const store = new CredentialStore(dir);
    const schema = z.strictObject({ value: z.string() });
    expect(store.privateRecord("fixture", schema)).toBeUndefined();
    store.putPrivateRecord("fixture", schema, { value: "synthetic" });
    expect(store.privateRecord("fixture", schema)).toEqual({ value: "synthetic" });
    expect(() => store.putPrivateRecord("fixture", schema, { value: 1 } as never)).toThrow();
    expect(store.privateRecord("fixture", schema)).toEqual({ value: "synthetic" });
    expect(() => store.putPrivateRecord("fixture", schema, { value: "x".repeat(65536) })).toThrow(
      "private record is too large",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
