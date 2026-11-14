// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import {
  consistencyProof,
  inclusionProof,
  leafHash,
  nodeHash,
  treeHash,
  verifyConsistency,
  verifyInclusion,
} from "../src/mechanisms/merkle-log.js";

it("uses RFC domain separation and verifies all leaves and all prefixes across irregular trees", () => {
  expect(treeHash([])).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(leafHash("")).toBe("6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d");
  for (let n = 1; n <= 32; n++) {
    const xs = Array.from({ length: n }, (_, i) => `Source-signed record ${i}`),
      root = treeHash(xs);
    for (let i = 0; i < n; i++) {
      const proof = inclusionProof(xs, i);
      expect(verifyInclusion(xs[i]!, i, n, proof, root), `${n}/${i}`).toBe(true);
      expect(verifyInclusion("changed", i, n, proof, root)).toBe(false);
      expect(verifyInclusion(xs[i]!, i, n, [...proof, leafHash("extra")], root)).toBe(false);
    }
    for (let m = 0; m <= n; m++) {
      const old = treeHash(xs.slice(0, m)),
        proof = consistencyProof(xs, m);
      expect(verifyConsistency(m, n, old, root, proof), `${m} -> ${n}`).toBe(true);
      expect(verifyConsistency(m, n, leafHash("fork"), root, proof)).toBe(false);
      expect(verifyConsistency(m, n, old, root, [...proof, leafHash("extra")])).toBe(false);
    }
  }
  expect(nodeHash(leafHash("a"), leafHash("b"))).not.toBe(leafHash("ab"));
  expect(verifyInclusion("a", -1, 1, [], leafHash("a"))).toBe(false);
  expect(verifyConsistency(2, 1, leafHash("a"), leafHash("b"), [])).toBe(false);
});
