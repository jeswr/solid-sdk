// AUTHORED-BY Claude Opus 5.5
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { PodScopeError } from "@jeswr/guarded-fetch";
import { expect, it } from "vitest";
import { IntegrationSyncError, PreconditionUnsupportedError } from "../core/errors.js";
import { ResourceWriteError } from "../pod/resource.js";
import { VeSyncAuthError, VeSyncSourceError } from "../vesync/errors.js";
import { NodeRuntimeError, PermanentCauseError, StateStoreError } from "./errors.js";
import { classifyVeSyncFailure } from "./vesync-failure.js";

const secret = "synthetic-private-server-text";
it.each([
  ["network fault", new TypeError(secret), true, "import"],
  ["timeout", new DOMException(secret, "TimeoutError"), true, "import"],
  ["token exchange fault", new Error(secret), true, "import"],
  ["VeSync source fault", new VeSyncSourceError(), true, "import"],
  ["Pod 503 read", new RdfFetchError(secret, { status: 503 }), true, "import"],
  ["Pod 408 read", new RdfFetchError(secret, { status: 408 }), true, "import"],
  ["Pod 412 write", new ResourceWriteError("https://pod.example/x", 412), true, "import"],
  [
    "transient state I/O",
    new StateStoreError("Cannot save connector state.", true),
    true,
    "import",
  ],
  ["VeSync login rejection", new VeSyncAuthError(), false, "auth"],
  ["Pod 401 read", new RdfFetchError(secret, { status: 401 }), false, "auth"],
  ["Pod 403 write", new ResourceWriteError("https://pod.example/x", 403), false, "auth"],
  ["Pod 400 write", new ResourceWriteError("https://pod.example/x", 400), false, "import"],
  ["Pod 409 write", new ResourceWriteError("https://pod.example/x", 409), false, "import"],
  ["Pod 429 write", new ResourceWriteError("https://pod.example/x", 429), true, "import"],
  ["weak ETag", new PreconditionUnsupportedError("vesync", secret), false, "import"],
  [
    "corrupt state",
    new StateStoreError("Cannot read or protect connector state.", false),
    false,
    "import",
  ],
  ["configuration", new NodeRuntimeError("config", "Invalid room label."), false, "config"],
  [
    "Pod login",
    new NodeRuntimeError("auth", "Pod client-credentials login failed."),
    false,
    "auth",
  ],
  ["scope refusal", new PodScopeError(secret), false, "import"],
  ["structural refusal", new PermanentCauseError(), false, "import"],
  ["adapter validation", new IntegrationSyncError("vesync", secret), false, "import"],
] as const)("classifies a %s", (_name, error, retry, kind) => {
  const failure = classifyVeSyncFailure(error);
  expect(failure).toMatchObject({ retry, kind });
  expect(failure.message).not.toContain(secret);
  expect(failure.message).not.toContain("pod.example");
  expect(classifyVeSyncFailure(failure)).toBe(failure);
});
