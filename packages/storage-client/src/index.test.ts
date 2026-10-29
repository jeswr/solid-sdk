// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { expect, test } from "vitest";
import * as errors from "./errors.js";
import * as helpers from "./helpers.js";
import * as api from "./index.js";
import * as lws from "./lws.js";
import * as memory from "./memory.js";
import * as solid from "./solid.js";
import * as testing from "./testing.js";

test("entry points expose the T-020/T-021/T-023 surface; testing stays reserved", () => {
  expect(Object.keys(api).sort()).toEqual(["StorageError", "toStorageError"]);
  expect(Object.keys(errors).sort()).toEqual([
    "MAX_PROBLEM_BYTES",
    "StorageError",
    "parseRetryAfter",
    "readErrorBody",
    "storageErrorFrom",
    "toStorageError",
  ]);
  expect(Object.keys(helpers).sort()).toEqual([
    "JsonPatchError",
    "applyJsonPatch",
    "jsonEqual",
    "retryOnConflict",
  ]);
  expect(Object.keys(memory)).toEqual(["createMemoryStorage"]);
  expect(Object.keys(solid)).toEqual(["createSolidBackend"]);
  expect(Object.keys(lws)).toEqual(["createLwsBackend"]);
  expect(Object.keys(testing)).toEqual([]);
});
