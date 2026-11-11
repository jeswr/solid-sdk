// AUTHORED-BY Codex GPT-6
import { expect, test } from "vitest";
import { activity, auth, challenge, decrypt, receiverPublic } from "../test/delivery-fixtures.js";
import { encryptPayload, encryptRecord } from "./push-crypto.js";

test("matches the complete RFC 8291 section 5 wire vector byte for byte", () => {
  const actual = encryptRecord(
    Buffer.from("When I grow up, I want to be a watermelon"),
    receiverPublic,
    auth,
    {
      salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"),
      ephemeral: Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"),
    },
  );
  expect(actual).toBe(
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
      "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
      "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});

test("independently decrypts exactly 512 UTF-8 bytes plus the final delimiter for both payload kinds", () => {
  for (const payload of [
    activity,
    { ...challenge, nonce: "🔐" },
    {
      ...challenge,
      nonce: "x".repeat(512 - Buffer.byteLength(JSON.stringify({ ...challenge, nonce: "" }))),
    },
  ]) {
    const encoded = encryptPayload(payload, receiverPublic, auth);
    const body = Buffer.from(encoded, "base64url");
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(body.length).toBe(86 + 512 + 1 + 16);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(body[21]).toBe(4);
    const plain = decrypt(encoded);
    expect(plain.length).toBe(513);
    expect(plain[512]).toBe(2);
    expect(plain.subarray(0, 512).toString()).toBe(
      JSON.stringify(payload).padEnd(
        512 - (Buffer.byteLength(JSON.stringify(payload)) - JSON.stringify(payload).length),
        " ",
      ),
    );
    expect(JSON.parse(plain.subarray(0, -1).toString())).toEqual(payload);
    expect(encryptPayload(payload, receiverPublic, auth)).not.toBe(encoded);
  }
});

test("rejects oversize plaintext, malformed inputs, compressed/off-curve keys and invalid test entropy", () => {
  expect(() =>
    encryptPayload({ ...challenge, nonce: "🔐".repeat(128) }, receiverPublic, auth),
  ).toThrow("too large");
  expect(() => encryptRecord(Buffer.alloc(3994), receiverPublic, auth)).toThrow("too large");
  for (const publicKey of [
    "",
    `${receiverPublic}=`,
    `!${receiverPublic}`,
    Buffer.alloc(65).toString("base64url"),
    Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString("base64url"),
  ])
    expect(() => encryptPayload(activity, publicKey, auth)).toThrow();
  for (const secret of ["", `${auth}=`, "a".repeat(22)])
    expect(() => encryptPayload(activity, receiverPublic, secret)).toThrow();
  expect(() => encryptPayload(activity, receiverPublic, auth, { salt: Buffer.alloc(15) })).toThrow(
    "salt",
  );
  expect(() =>
    encryptPayload(activity, receiverPublic, auth, { ephemeral: Buffer.alloc(32) }),
  ).toThrow();
});
