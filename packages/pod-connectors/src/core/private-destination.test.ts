// AUTHORED-BY Codex GPT-6
import { createOwnerOnlyDestinationVerifier } from "@jeswr/pod-access";
import { expect, it, vi } from "vitest";
import { bankStatementsFileAdapter } from "../bank-statements/file-adapter.js";
import { MONZO } from "../bank-statements/fixtures.js";
import { garminAdapter } from "../garmin/adapter.js";
import { createOwnerOnlyDestinationVerifier as publicVerifier } from "../index.js";
import { whoopAdapter } from "../whoop/adapter.js";
import { runFileImport } from "./file-import.js";
import { runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { createOwnerOnlyDestinationVerifier as connectorVerifier } from "./private-destination.js";
import {
  createMemoryPod,
  memoryFile,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "./testing.js";
import type { PodWriter } from "./types.js";

it.each([
  ["public-read parent", async () => false],
  [
    "unavailable ACL",
    async () => {
      throw new Error("ACL unavailable");
    },
  ],
  ["no verifier", undefined],
] as const)("sends no bank payload request with %s", async (_name, verify) => {
  const pod = createMemoryPod();
  const fetch = vi.fn(pod.fetch);
  const adapter = bankStatementsFileAdapter;
  const verifyPrivateDestination = verify && vi.fn(verify);
  await expect(
    runFileImport({
      adapter,
      file: memoryFile("bank.csv", MONZO),
      podWriter: createFetchPodWriter({
        adapterId: adapter.metadata.id,
        webId: TEST_WEBID,
        profileDocumentUrl: TEST_PROFILE_DOC,
        podRoot: TEST_POD_ROOT,
        fetch,
        verifyPrivateDestination,
      }),
    }),
  ).rejects.toMatchObject({ name: "PrivateDestinationError" });
  if (verifyPrivateDestination)
    expect(verifyPrivateDestination).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/finance\/bank\/monzo-.*\/account\.ttl$/),
    );
  expect(fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  expect(pod.putCount).toBe(0);
});

it.each([
  garminAdapter,
  whoopAdapter,
])("refuses sensitive API imports without a verified destination ($metadata.id)", async (adapter) => {
  const write = vi.fn<PodWriter["write"]>();
  await expect(
    runImport({
      adapter,
      mode: "demo",
      podWriter: {
        resolve: (slug) => new URL(slug, TEST_POD_ROOT).href,
        read: async () => undefined,
        write,
        registerType: vi.fn(),
      },
    }),
  ).rejects.toMatchObject({ name: "PrivateDestinationError" });
  expect(write).not.toHaveBeenCalled();
});

it("keeps the connector public export and CLI shim wired to pod-access", () => {
  expect(publicVerifier).toBe(createOwnerOnlyDestinationVerifier);
  expect(connectorVerifier).toBe(createOwnerOnlyDestinationVerifier);
});
