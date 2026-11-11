// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { expect, test } from "vitest";
import * as errors from "./errors.js";
import * as helpers from "./helpers.js";
import * as api from "./index.js";
import * as lws from "./lws.js";
import * as memory from "./memory.js";
import * as solid from "./solid.js";
import * as testing from "./testing.js";
import * as trash from "./trash.js";
import * as versions from "./versions.js";

test("entry points expose the storage client and testing surface", () => {
  expect(Object.keys(api).sort()).toEqual([
    "StorageError",
    "createPodClient",
    "displayNameOf",
    "toStorageError",
  ]);
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
    "createAt",
    "displayNameOf",
    "jsonEqual",
    "retryOnConflict",
  ]);
  expect(Object.keys(memory)).toEqual(["createMemoryStorage"]);
  expect(Object.keys(solid).sort()).toEqual(["buildN3Patch", "createSolidBackend"]);
  expect(Object.keys(lws)).toEqual(["createLwsBackend"]);
  expect(Object.keys(trash)).toEqual(["createTrashClient"]);
  expect(Object.keys(versions)).toEqual(["createVersionsClient"]);
  expect(Object.keys(testing).sort()).toEqual([
    "createRecordingFetch",
    "createReplayFetch",
    "loadFixtures",
  ]);
});
