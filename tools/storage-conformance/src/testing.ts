// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import type { DatasetCore, Quad, Term } from "@jeswr/fetch-rdf";
import { StorageError, type StorageErrorCode } from "@jeswr/storage-client";

/** Assert structured SDK errors and optional HTTP status; unexpected failures propagate. */
export async function expectStorageError(
  operation: Promise<unknown>,
  code: StorageErrorCode,
  status?: number,
): Promise<StorageError> {
  try {
    await operation;
  } catch (error) {
    assert(error instanceof StorageError, "Expected StorageError");
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return error;
  }
  throw new Error("Expected the operation to fail");
}

function terms(quad: Quad): Term[] {
  return [quad.subject, quad.predicate, quad.object, quad.graph];
}

/** Small-fixture RDF/JS graph isomorphism, including a consistent blank-node bijection. */
export function assertIsomorphic(actual: DatasetCore, expected: DatasetCore): void {
  assert.equal(actual.size, expected.size, "Different RDF dataset sizes");
  const left = [...actual];
  const right = [...expected];
  const blankIds = (quads: Quad[]) => [
    ...new Set(
      quads
        .flatMap(terms)
        .filter((term) => term.termType === "BlankNode")
        .map((term) => term.value),
    ),
  ];
  const a = blankIds(left);
  const b = blankIds(right);
  assert.equal(a.length, b.length, "Different blank-node counts");
  const matches = (mapping: Map<string, string>) =>
    left.every((quad) =>
      right.some((candidate) =>
        terms(quad).every((term, index) => {
          const other = terms(candidate)[index] as Term;
          return term.termType === "BlankNode"
            ? other.termType === "BlankNode" && mapping.get(term.value) === other.value
            : term.equals(other);
        }),
      ),
    );
  const search = (mapping: Map<string, string>, remaining: string[]): boolean => {
    if (mapping.size === a.length) return matches(mapping);
    for (const id of remaining) {
      const next = new Map(mapping).set(a[mapping.size] as string, id);
      if (
        search(
          next,
          remaining.filter((candidate) => candidate !== id),
        )
      )
        return true;
    }
    return false;
  };
  assert(search(new Map(), b), "RDF datasets are not isomorphic");
}
