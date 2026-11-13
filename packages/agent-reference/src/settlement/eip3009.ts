// AUTHORED-BY Codex GPT-6
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { z } from "zod";

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const uint256Schema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .max(78)
  .refine((n) => /^(0|[1-9]\d*)$/.test(n) && n.length <= 78 && BigInt(n) < 2n ** 256n);
export const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const signatureSchema = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
export const authorizationSchema = z.strictObject({
  from: addressSchema,
  to: addressSchema,
  value: uint256Schema,
  validAfter: uint256Schema,
  validBefore: uint256Schema,
  nonce: bytes32Schema,
});
export const domainSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  chainId: uint256Schema,
  verifyingContract: addressSchema,
});
export type Authorization = z.infer<typeof authorizationSchema>;
export type Eip712Domain = z.infer<typeof domainSchema>;

const utf8 = (text: string) => new TextEncoder().encode(text);
const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString("hex")}`;
const bytes = (value: string) => Uint8Array.from(Buffer.from(value.slice(2), "hex"));
const join = (...items: Uint8Array[]) => Uint8Array.from(Buffer.concat(items));
const hashText = (text: string) => keccak_256(utf8(text));
const word = (n: string) => bytes(`0x${BigInt(n).toString(16).padStart(64, "0")}`);
const addressWord = (address: string) =>
  bytes(`0x${address.slice(2).toLowerCase().padStart(64, "0")}`);

/** EIP-712 ABI words, Keccak-256 (not SHA3-256), and the 0x1901 prefix. */
export function hashAuthorization(
  domainInput: Eip712Domain,
  authorizationInput: Authorization,
): Uint8Array {
  const domain = domainSchema.parse(domainInput);
  const auth = authorizationSchema.parse(authorizationInput);
  const separator = keccak_256(
    join(
      hashText(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
      ),
      hashText(domain.name),
      hashText(domain.version),
      word(domain.chainId),
      addressWord(domain.verifyingContract),
    ),
  );
  const struct = keccak_256(
    join(
      hashText(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
      ),
      addressWord(auth.from),
      addressWord(auth.to),
      word(auth.value),
      word(auth.validAfter),
      word(auth.validBefore),
      bytes(auth.nonce),
    ),
  );
  return keccak_256(join(Uint8Array.of(0x19, 0x01), separator, struct));
}

export function addressFromKey(secretKey: Uint8Array): string {
  return hex(keccak_256(secp256k1.getPublicKey(secretKey, false).slice(1)).slice(-20));
}

/** EIP-3009 nonce scope shared by protocols using the same provider ledger. */
export function authorizationOnceKey(domain: Eip712Domain, authorization: Authorization): string {
  domainSchema.parse(domain);
  authorizationSchema.parse(authorization);
  return JSON.stringify([
    "eip3009",
    domain.chainId,
    domain.verifyingContract.toLowerCase(),
    authorization.from.toLowerCase(),
    authorization.nonce.toLowerCase(),
  ]);
}

/** Ethereum r || s || v encoding, with v = 27/28 and canonical low-s. */
export function signAuthorization(
  domain: Eip712Domain,
  authorization: Authorization,
  secretKey: Uint8Array,
): string {
  if (addressFromKey(secretKey) !== authorization.from.toLowerCase())
    throw new Error("signing key differs from authorizer");
  const sig = secp256k1.sign(hashAuthorization(domain, authorization), secretKey, {
    prehash: false,
    lowS: true,
    format: "recovered",
  });
  return encodeAuthorizationSignature(sig);
}

/** Convert noble's recovery-byte prefix to Ethereum's recovery-byte suffix. */
export function encodeAuthorizationSignature(signature: Uint8Array): string {
  if (signature.length !== 65 || (signature[0] !== 0 && signature[0] !== 1))
    throw new Error("unsupported recovery id or signature length");
  return hex(join(signature.slice(1), Uint8Array.of((signature[0] as number) + 27)));
}

export function recoverAuthorization(
  domain: Eip712Domain,
  authorization: Authorization,
  signature: string,
): string {
  signatureSchema.parse(signature);
  const sig = bytes(signature);
  const v = sig[64];
  if (v !== 27 && v !== 28) throw new Error("invalid recovery id");
  const parsed = secp256k1.Signature.fromBytes(sig.slice(0, 64), "compact");
  if (parsed.hasHighS()) throw new Error("high-s signature");
  const digest = hashAuthorization(domain, authorization);
  const publicKey = secp256k1.recoverPublicKey(
    join(Uint8Array.of(v - 27), sig.slice(0, 64)),
    digest,
    { prehash: false },
  );
  const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  return hex(keccak_256(uncompressed.slice(1)).slice(-20));
}
