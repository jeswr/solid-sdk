// AUTHORED-BY Codex GPT-6
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { expect, it } from "vitest";
import {
  addressFromKey,
  encodeAuthorizationSignature,
  hashAuthorization,
  recoverAuthorization,
  signAuthorization,
} from "../../src/settlement/eip3009.js";
import { authorization, domain, payer, secretKey } from "./fixtures.js";

const signature =
  "0x6facd3744648d8bc9425ca345a40a19379ab3155485c148271c454c5477966226021a2bcb0b1270a99282a2c107fabe074faed081ae90b8bbb04f2e29c3f0f7b1b";
it("pins the locally computed EIP-712 vector, deterministic signature and private-key-one address", () => {
  expect(payer).toBe("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
  expect(Buffer.from(hashAuthorization(domain, authorization)).toString("hex")).toBe(
    "6767eab8c0813eab7a63818c25c82a302cb4e87d66a58af9a3125b8c1a3bbf86",
  );
  expect(signAuthorization(domain, authorization, secretKey)).toBe(signature);
  expect(recoverAuthorization(domain, authorization, signature)).toBe(payer);
});
it.each([
  ["from", "0x4444444444444444444444444444444444444444"],
  ["to", "0x4444444444444444444444444444444444444444"],
  ["value", "1250001"],
  ["validAfter", "1"],
  ["validBefore", "2000000001"],
  ["nonce", `0x${"44".repeat(32)}`],
])("binds authorization field %s", (field, value) => {
  expect(recoverAuthorization(domain, { ...authorization, [field]: value }, signature)).not.toBe(
    payer,
  );
});
it.each([
  ["name", "Other Token"],
  ["version", "3"],
  ["chainId", "1"],
  ["verifyingContract", "0x4444444444444444444444444444444444444444"],
])("binds domain field %s", (field, value) => {
  expect(recoverAuthorization({ ...domain, [field]: value }, authorization, signature)).not.toBe(
    payer,
  );
});
it("refuses the mathematically equivalent high-s signature", () => {
  const raw = Buffer.from(signature.slice(2), "hex");
  const s = BigInt(`0x${raw.subarray(32, 64).toString("hex")}`);
  raw.set(Buffer.from((secp256k1.Point.Fn.ORDER - s).toString(16).padStart(64, "0"), "hex"), 32);
  raw[64] = raw[64] === 27 ? 28 : 27;
  expect(() => recoverAuthorization(domain, authorization, `0x${raw.toString("hex")}`)).toThrow(
    "high-s",
  );
});
it.each([
  "0x00",
  `${signature.slice(0, -2)}00`,
  `${signature.slice(0, -2)}1d`,
  `0x${"00".repeat(64)}1b`,
])("refuses malformed signatures %s", (sig) => {
  expect(() => recoverAuthorization(domain, authorization, sig)).toThrow();
});
it("refuses signing for another authorizer", () => {
  const key = Uint8Array.from([...new Uint8Array(31), 2]);
  expect(addressFromKey(key)).not.toBe(payer);
  expect(() => signAuthorization(domain, authorization, key)).toThrow("authorizer");
});
it("refuses recovery encodings that Ethereum r/s/v cannot represent", () => {
  expect(() => encodeAuthorizationSignature(Uint8Array.from([2, ...new Uint8Array(64)]))).toThrow(
    "unsupported recovery id",
  );
  expect(() => encodeAuthorizationSignature(new Uint8Array(64))).toThrow("signature length");
});
it.each(["-1", "01", "1.5", (2n ** 256n).toString()])("refuses non-uint256 values %s", (value) => {
  expect(() => hashAuthorization(domain, { ...authorization, value })).toThrow();
});
