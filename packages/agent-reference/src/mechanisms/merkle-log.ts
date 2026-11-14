// AUTHORED-BY Codex GPT-6
/** RFC 9162 domain-separated SHA-256 tree hashing and bounded audit paths. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHash } from "crypto";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const validHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
export const leafHash = (record: string) =>
  hash(Buffer.concat([Buffer.from([0]), Buffer.from(record, "utf8")]));
export const nodeHash = (left: string, right: string) => {
  if (!validHash(left) || !validHash(right)) throw new TypeError("invalid Merkle hash");
  return hash(
    Buffer.concat([Buffer.from([1]), Buffer.from(left, "hex"), Buffer.from(right, "hex")]),
  );
};
const split = (n: number) => 2 ** Math.floor(Math.log2(n - 1));
export function treeHash(records: readonly string[]): string {
  if (!records.length) return hash(new Uint8Array());
  if (records.length === 1) return leafHash(records[0]!);
  const k = split(records.length);
  return nodeHash(treeHash(records.slice(0, k)), treeHash(records.slice(k)));
}
export function inclusionProof(records: readonly string[], index: number): string[] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= records.length)
    throw new RangeError("invalid leaf index");
  if (records.length === 1) return [];
  const k = split(records.length);
  return index < k
    ? [...inclusionProof(records.slice(0, k), index), treeHash(records.slice(k))]
    : [...inclusionProof(records.slice(k), index - k), treeHash(records.slice(0, k))];
}
export function verifyInclusion(
  record: string,
  index: number,
  size: number,
  proof: readonly string[],
  root: string,
): boolean {
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= size ||
    proof.length > 64 ||
    !validHash(root) ||
    proof.some((p) => !validHash(p))
  )
    return false;
  let fn = index,
    sn = size - 1,
    r = leafHash(record);
  for (const sibling of proof) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(sibling, r);
      while (fn !== 0 && fn % 2 === 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else r = nodeHash(r, sibling);
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && r === root;
}
export function consistencyProof(records: readonly string[], oldSize: number): string[] {
  if (!Number.isSafeInteger(oldSize) || oldSize < 0 || oldSize > records.length)
    throw new RangeError("invalid earlier tree size");
  if (oldSize === 0) return [];
  const sub = (xs: readonly string[], m: number, complete: boolean): string[] => {
    if (m === xs.length) return complete ? [] : [treeHash(xs)];
    const k = split(xs.length);
    return m <= k
      ? [...sub(xs.slice(0, k), m, complete), treeHash(xs.slice(k))]
      : [...sub(xs.slice(k), m - k, false), treeHash(xs.slice(0, k))];
  };
  return sub(records, oldSize, true);
}
export function verifyConsistency(
  oldSize: number,
  size: number,
  oldRoot: string,
  root: string,
  proof: readonly string[],
): boolean {
  if (
    !Number.isSafeInteger(oldSize) ||
    !Number.isSafeInteger(size) ||
    oldSize < 0 ||
    size < oldSize ||
    proof.length > 64 ||
    ![oldRoot, root, ...proof].every(validHash)
  )
    return false;
  if (oldSize === 0) return oldRoot === treeHash([]) && proof.length === 0;
  if (oldSize === size) return oldRoot === root && proof.length === 0;
  let fn = oldSize - 1,
    sn = size - 1;
  while (fn % 2 === 1) {
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  let offset = 0,
    fr = oldRoot,
    sr = oldRoot;
  if (fn !== 0) {
    if (!proof.length) return false;
    fr = sr = proof[offset++]!;
  }
  for (const sibling of proof.slice(offset)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = nodeHash(sibling, fr);
      sr = nodeHash(sibling, sr);
      while (fn !== 0 && fn % 2 === 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else sr = nodeHash(sr, sibling);
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && fr === oldRoot && sr === root;
}
