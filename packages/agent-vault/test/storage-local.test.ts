// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers

import { createCipheriv } from "crypto";
import {
  chmodSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { inspect } from "util";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EncryptedRecords,
  FileKeyProvider,
  LocalEncryptedBackend,
  recordKey,
  Secret,
} from "../src/index.js";
import { login, PASSWORD, SITE, setup } from "./helpers.js";

describe("private encryption and local backend", () => {
  it.each([4, 8, 12, 13, 14, 15])("refuses a truncated GCM tag of %i bytes", async (length) => {
    const { store, dir } = setup();
    const records = new EncryptedRecords(store, {
      key: async () => new Secret(Buffer.alloc(32, 7)),
    });
    await records.put("tags", "a", z.string(), PASSWORD);
    const path = join(dir, "vault", `${recordKey("tags", "a")}.json`);
    const envelope = JSON.parse(readFileSync(path, "utf8"));
    expect(Buffer.from(envelope.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(envelope.tag, "base64")).toHaveLength(16);
    expect(await records.get("tags", "a", z.string())).toBe(PASSWORD);
    envelope.tag = Buffer.from(envelope.tag, "base64").subarray(0, length).toString("base64");
    writeFileSync(path, JSON.stringify(envelope));
    await expect(records.get("tags", "a", z.string())).rejects.toThrow();
  });
  it.each([8, 16])("refuses an authenticated envelope with a %i-byte IV", async (length) => {
    const { store } = setup();
    const key = Buffer.alloc(32, 7);
    const iv = Buffer.alloc(length, 1);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(JSON.stringify(["iv", "a"])));
    const data = Buffer.concat([cipher.update(JSON.stringify(PASSWORD)), cipher.final()]);
    const schema = z.strictObject({
      version: z.literal(1),
      iv: z.string(),
      tag: z.string(),
      data: z.string(),
    });
    store.putPrivateRecord(recordKey("iv", "a"), schema, {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    });
    const records = new EncryptedRecords(store, { key: async () => new Secret(key) });
    await expect(records.get("iv", "a", z.string())).rejects.toThrow();
  });
  it("encrypts per item, persists key, finds exact origin, updates and hides diagnostics", async () => {
    const { store, dir } = setup();
    const backend = new LocalEncryptedBackend({ store, profile: "personal" });
    const a = await backend.save(login());
    const b = await backend.save(login());
    expect(a.ref).not.toBe(b.ref);
    expect(await backend.find(SITE)).toHaveLength(2);
    expect(await backend.find("https://sub.shop.test")).toEqual([]);
    expect(
      await new LocalEncryptedBackend({ store, profile: "work", id: backend.id }).find(SITE),
    ).toEqual([]);
    const reopened = new LocalEncryptedBackend({ store, profile: "personal" });
    const value = await reopened.read(a.ref, "login");
    expect(await value.use((v) => v.password === PASSWORD)).toBe(true);
    for (const text of [
      JSON.stringify(value),
      inspect(value, { showHidden: true }),
      String(value),
      await value.use((v) => JSON.stringify(v)),
      await value.use((v) => inspect(v)),
    ])
      expect(text).not.toContain(PASSWORD);
    await reopened.save(login(a.ref));
    expect(await reopened.find(SITE)).toHaveLength(2);
    expect(await new LocalEncryptedBackend({ store, profile: "work" }).find(SITE)).toEqual([]);
    for (const f of readdirSync(join(dir, "vault"))) {
      expect(statSync(join(dir, "vault", f)).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(dir, "vault", f), "utf8")).not.toContain(PASSWORD);
    }
    expect(statSync(join(dir, "vault")).mode & 0o777).toBe(0o700);
    await expect(backend.read("missing", "login")).rejects.toThrow("Vault missing");
    await expect(backend.read(a.ref, "save" as never)).rejects.toThrow("Vault denied");
    await expect(backend.save(login("index"))).rejects.toThrow();
  });
  it("binds ciphertext to scope and key; detects authentication corruption and wrong keys", async () => {
    const { store, records, dir } = setup();
    const schema = z.strictObject({ value: z.string() });
    await records.put("one", "a", schema, { value: PASSWORD });
    copyFileSync(
      join(dir, "vault", `${recordKey("one", "a")}.json`),
      join(dir, "vault", `${recordKey("two", "b")}.json`),
    );
    await expect(records.get("two", "b", schema)).rejects.toThrow("Vault unavailable");
    const wrong = new EncryptedRecords(store, { key: async () => new Secret(Buffer.alloc(32, 5)) });
    await expect(wrong.get("one", "a", schema)).rejects.toThrow();
    const bad = new EncryptedRecords(store, { key: async () => new Secret(Buffer.alloc(3)) });
    await expect(bad.put("one", "b", schema, { value: PASSWORD })).rejects.toThrow("Vault invalid");
    const path = join(dir, "vault", `${recordKey("one", "a")}.json`);
    const r = JSON.parse(readFileSync(path, "utf8"));
    r.tag = Buffer.alloc(16).toString("base64");
    writeFileSync(path, JSON.stringify(r));
    await expect(records.get("one", "a", schema)).rejects.toThrow();
  });
  it("refuses symlinks and permissive files without revealing filesystem diagnostics", async () => {
    const { store, dir } = setup();
    const key = new FileKeyProvider(store);
    await key.key();
    const p = join(dir, "vault/encryption-key.json");
    chmodSync(p, 0o644);
    await expect(key.key()).rejects.toThrow("Vault unavailable");
    chmodSync(p, 0o600);
    const records = new EncryptedRecords(store);
    symlinkSync(p, join(dir, "vault", `${recordKey("s", "k")}.json`));
    await expect(records.get("s", "k", z.string())).rejects.toThrow();
    await expect(records.put("s", "k", z.string(), PASSWORD)).rejects.toThrow();
  });
  it("shares one default key under concurrent initialization", async () => {
    const { store } = setup();
    const a = new FileKeyProvider(store);
    const b = new FileKeyProvider(store);
    const [x, y] = await Promise.all([a.key(), b.key()]);
    expect(await x.use((v) => y.use((w) => Buffer.from(v).equals(Buffer.from(w))))).toBe(true);
  });
  it("never preserves thrown secret-bearing causes", async () => {
    const error = await login()
      .use(() => {
        throw new Error(PASSWORD);
      })
      .catch((e) => e);
    expect(
      [String(error), JSON.stringify(error), inspect(error, { showHidden: true })].join(" "),
    ).not.toContain(PASSWORD);
  });
});
