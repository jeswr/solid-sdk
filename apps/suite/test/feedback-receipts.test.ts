// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { signReceipt, verifyReceipts } from "../src/feedback/receipts";

const env = { FEEDBACK_GITHUB_TOKEN: "token", FEEDBACK_GITHUB_REPO: "private/feedback" };
const now = 1_800_000_000_000;
const receipt = signReceipt({ sha: "a".repeat(40), size: 100, ext: "webm" }, env, now);
it("authenticates the SHA, size, extension and two-hour expiry, rejecting duplicates and unknown blobs", () => {
  expect(Object.keys(receipt)).toEqual(["sha", "size", "ext", "sig"]);
  expect(verifyReceipts([receipt], env, now)).toEqual([receipt]);
  for (const changed of [
    { ...receipt, sha: "b".repeat(40) },
    { ...receipt, size: 101 },
    { ...receipt, ext: "ogg" },
    { ...receipt, sig: `1800007200001.${receipt.sig.split(".")[1]}` },
    { ...receipt, sig: "bad" },
    { ...receipt, sha: "unknown" },
    { ...receipt, extra: "no" },
  ])
    expect(() => verifyReceipts([changed], env, now)).toThrow();
  expect(() => verifyReceipts([receipt, receipt], env, now)).toThrow();
  expect(() => verifyReceipts([receipt], env, now + 2 * 60 * 60 * 1000)).toThrow();
  expect(() =>
    verifyReceipts([receipt], { ...env, FEEDBACK_GITHUB_TOKEN: "other" }, now),
  ).toThrow();
  expect(() =>
    verifyReceipts([receipt], { ...env, FEEDBACK_GITHUB_REPO: "other/repo" }, now),
  ).toThrow();
});
it("supports an explicit receipt secret across token rotation", () => {
  const secretEnv = { ...env, FEEDBACK_RECEIPT_SECRET: "receipt-secret" };
  const signed = signReceipt({ sha: "b".repeat(40), size: 100, ext: "m4a" }, secretEnv, now);
  expect(verifyReceipts([signed], { ...secretEnv, FEEDBACK_GITHUB_TOKEN: "rotated" }, now)).toEqual(
    [signed],
  );
});
