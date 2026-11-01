// AUTHORED-BY Codex GPT-6.1-Sol
import { fileURLToPath } from "node:url";
import { crc32, gunzipSync, gzipSync as nodeGzipSync } from "node:zlib";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  BitstringDecodeError,
  createStatusBitstring,
  decodeStatusList,
  encodeStatusList,
  getStatusBit,
  setStatusBit,
} from "../src/bitstring.js";

const encoded = (bytes: Uint8Array) => `u${Buffer.from(bytes).toString("base64url")}`;
const compressed = () => nodeGzipSync(createStatusBitstring());

it("bundles the full public entry for browsers without Node builtins and signs without Buffer", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "solidVc",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  expect(result.errors).toEqual([]);
  const bundle = result.outputFiles[0]?.text as string;
  expect(bundle).not.toMatch(/["']node:[^"']+["']/);
  expect(Object.keys(result.metafile.inputs)).not.toContainEqual(expect.stringMatching(/^node:/));
  // Exercise the browser-resolved code, including RDFC and fflate, with no Node globals.
  const api = new Function("Buffer", "process", `${bundle}; return solidVc;`)(undefined, undefined);
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const key = { ...pair, verificationMethod: "https://owner.example/#key" };
  const suite = new api.DataIntegritySuite("ecdsa-rdfc-2019");
  const unsigned = { issuer: "https://owner.example/#me", credentialSubject: { name: "Alice" } };
  const quads = api.credentialToRdf(unsigned);
  expect(quads[0].subject.value).toMatch(/^urn:uuid:/);
  expect(api.credentialToJsonLd(unsigned).id).toMatch(/^urn:uuid:/);
  expect(await api.digestQuads(quads)).toMatch(/^z/);
  const vc = await api.issue({
    credential: unsigned,
    key,
    suite,
  });
  expect(key.privateKey.extractable).toBe(false);
  expect(vc.id).toMatch(/^urn:uuid:/);
  expect(
    await suite.verify(api.credentialToRdf(vc), vc.proof, { resolveKey: () => key.publicKey }),
  ).toBe(true);
  expect(api.decodeStatusList(api.encodeStatusList(api.createStatusBitstring()))).toEqual(
    createStatusBitstring(),
  );
  const listId = "https://owner.example/status/1";
  const unsignedList = api.buildBitstringStatusListCredential({
    id: listId,
    issuer: vc.issuer,
    statusPurpose: "revocation",
  });
  const list = await api.issue({
    credential: {
      ...unsignedList,
      credentialSubject: { ...unsignedList.credentialSubject, label: "\uFEFF🔒" },
    },
    key,
    suite,
  });
  const withStatus = {
    ...vc,
    credentialStatus: api.bitstringStatusListEntry({
      statusPurpose: "revocation",
      statusListIndex: 0,
      statusListCredential: listId,
    }),
  };
  const bodyText = JSON.stringify(list);
  const bytes = new TextEncoder().encode(bodyText);
  const split = bytes.findIndex((byte) => byte >= 128) + 1;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, split));
      controller.enqueue(bytes.subarray(split));
      controller.close();
    },
  });
  const statusOptions = {
    resolveKey: () => key.publicKey,
    isControlledBy: (method: string, owner: string) =>
      method === key.verificationMethod && owner === vc.issuer,
  };
  for (const response of [
    new Response(stream),
    { ok: true, body: null, text: async () => bodyText },
  ])
    expect(
      await api.resolveBitstringStatus(withStatus, {
        ...statusOptions,
        fetch: async () => response,
      }),
    ).toEqual({ status: "valid" });
  // Byte limits still count UTF-8 octets; BOM-prefixed JSON still fails parsing.
  expect(
    (
      await api.resolveBitstringStatus(withStatus, {
        ...statusOptions,
        fetch: async () => ({ ok: true, body: null, text: async () => bodyText }),
        maxBodyBytes: bytes.length - 1,
      })
    ).status,
  ).toBe("unreachable");
  expect(
    (
      await api.resolveBitstringStatus(withStatus, {
        ...statusOptions,
        fetch: async () => new Response(`\uFEFF${bodyText}`),
      })
    ).status,
  ).toBe("unreachable");
  // The Node-only default fetch is disabled in browser resolution; it must fail closed.
  expect(
    await api.resolveWebIdKey("https://owner.example/#me", key.verificationMethod),
  ).toBeUndefined();
});

describe("strict browser status-list codec", () => {
  it("decodes standard GZIP and round trips set and cleared MSB-first bits", () => {
    expect(decodeStatusList(encoded(compressed()))).toEqual(createStatusBitstring());
    const bits = createStatusBitstring();
    for (const index of [0, 7, 8, bits.length * 8 - 1]) setStatusBit(bits, index, true);
    const encodedBits = encodeStatusList(bits);
    // Preserve zlib's deterministic, zero-timestamp GZIP encoding.
    expect(Buffer.from(encodedBits.slice(1), "base64url").subarray(4, 8)).toEqual(Buffer.alloc(4));
    let decoded = decodeStatusList(encodedBits);
    expect(decoded).toEqual(bits);
    for (const index of [0, 7, 8, bits.length * 8 - 1])
      expect(getStatusBit(decoded, index)).toBe(true);
    setStatusBit(decoded, 7, false);
    decoded = decodeStatusList(encodeStatusList(decoded));
    expect(getStatusBit(decoded, 7)).toBe(false);
    expect(getStatusBit(decoded, 0)).toBe(true);
  });
  it("enforces the byte limit while inflating highly compressed and concatenated members", () => {
    const bomb = nodeGzipSync(new Uint8Array(2 * 1024 * 1024));
    expect(() => decodeStatusList(encoded(bomb), { maxDecodedBytes: 16384 })).toThrow(
      /within 16384 bytes/,
    );
    const joined = Buffer.concat([compressed(), compressed()]);
    expect(decodeStatusList(encoded(joined))).toHaveLength(32768);
    expect(() => decodeStatusList(encoded(joined), { maxDecodedBytes: 16384 })).toThrow(
      BitstringDecodeError,
    );
  });
  it("validates optional GZIP extra fields, names, comments and header checksums", () => {
    const gzip = compressed();
    const header = Buffer.concat([
      gzip.subarray(0, 10),
      Buffer.from([3, 0, 1, 2, 3]), // FEXTRA length and contents.
      Buffer.from("status.bin\0synthetic status list\0"), // FNAME and FCOMMENT.
    ]);
    header[3] = 4 | 8 | 16 | 2;
    const checksum = Buffer.alloc(2);
    checksum.writeUInt16LE(crc32(header) & 0xffff);
    const member = Buffer.concat([header, checksum, gzip.subarray(10)]);
    expect(gunzipSync(member)).toEqual(Buffer.from(createStatusBitstring()));
    expect(decodeStatusList(encoded(member))).toEqual(createStatusBitstring());
    member[header.length] = (member[header.length] as number) ^ 1;
    expect(() => decodeStatusList(encoded(member))).toThrow(BitstringDecodeError);
  });
  it("rejects missing member trailers and trailing garbage after a valid member", () => {
    const gzip = compressed();
    for (const trailing of [Buffer.from([1]), Buffer.alloc(8, 255), gzip.subarray(0, 10)])
      expect(() => decodeStatusList(encoded(Buffer.concat([gzip, trailing])))).toThrow(
        BitstringDecodeError,
      );
    // Removing only the trailer leaves a completely inflated body; it still must fail.
    expect(() => decodeStatusList(encoded(gzip.subarray(0, -8)))).toThrow(BitstringDecodeError);
  });
  it.each([1, 2, 4, 8, 9, 10, 20, 30])("rejects GZIP truncated by %i bytes", (cut) => {
    const gzip = compressed();
    expect(() => decodeStatusList(encoded(gzip.subarray(0, -cut)))).toThrow(BitstringDecodeError);
  });
  it.each([0, 2, 3, -8, -4, -1])("rejects corrupt GZIP headers and trailers at %i", (offset) => {
    const gzip = compressed();
    const index = offset < 0 ? gzip.length + offset : offset;
    gzip[index] = (gzip[index] as number) ^ 255;
    expect(() => decodeStatusList(encoded(gzip))).toThrow(BitstringDecodeError);
  });
  it.each([
    "uA",
    "uAB",
    "uAAB",
    "u!",
    "uabc=",
    "uabc+",
    "uabc/",
    "uabc\n",
    "u abc",
  ])("rejects non-base64url or noncanonical input %j", (value) => {
    expect(() => decodeStatusList(value)).toThrow(BitstringDecodeError);
  });
  it("rejects a final newline even though the regex end anchor permits it", () => {
    expect(() => decodeStatusList(`${encodeStatusList(createStatusBitstring())}\n`)).toThrow(
      /payload is not valid base64url/,
    );
  });
  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("fails closed on invalid byte ceiling %s", (maxDecodedBytes) => {
    expect(() => decodeStatusList(encoded(compressed()), { maxDecodedBytes })).toThrow(
      BitstringDecodeError,
    );
  });
});
