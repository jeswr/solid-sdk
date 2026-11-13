// AUTHORED-BY Codex GPT-6
import {
  type Authorization,
  addressFromKey,
  type Eip712Domain,
} from "../../src/settlement/eip3009.js";
export const secretKey = Uint8Array.from([...new Uint8Array(31), 1]);
export const payer = addressFromKey(secretKey);
export const payee = "0x2222222222222222222222222222222222222222";
export const domain: Eip712Domain = {
  name: "USD Coin",
  version: "2",
  chainId: "84532",
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
export const authorization: Authorization = {
  from: payer,
  to: payee,
  value: "1250000",
  validAfter: "0",
  validBefore: "2000000000",
  nonce: `0x${"33".repeat(32)}`,
};
export const now = 1_800_000_000;
