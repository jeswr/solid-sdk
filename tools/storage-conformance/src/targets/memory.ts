// AUTHORED-BY Codex GPT-6.1-Sol
import { deriveFeatures, type StorageDescription } from "@jeswr/storage-capabilities";
import { LWS, SSD } from "@jeswr/storage-capabilities/vocab";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import type { ConformanceTarget } from "../types.js";

/** Reference target with actual in-memory storage semantics, including LWS pagination. */
export function memoryTarget(
  protocol: "solid" | "lws",
  { pageSize = 100 }: { pageSize?: number } = {},
): ConformanceTarget {
  return {
    name: `memory-${protocol}`,
    async start() {
      const root = `https://memory-${protocol}.example/`;
      const webId = "https://identity.example/alice#me";
      const storage = createMemoryStorage({ protocol, root, pageSize });
      const description: StorageDescription = {
        protocol,
        id: root,
        root,
        descriptionUrl: `${root}description`,
        services: [],
        capabilities: [
          {
            type: [SSD.PatchSupport],
            extra: {
              format: {
                "text/turtle": ["text/n3"],
                "application/json": ["application/json-patch+json"],
              },
            },
          },
        ],
        sources: [protocol === "solid" ? "solid-description" : "lws-cid"],
        fetchedAt: 0,
        etag: null,
        maxAgeMs: 0,
        verificationMethods: [],
      };
      if (protocol === "lws") {
        description.services = [{ type: [LWS.StorageRoot], endpoint: root, extra: {} }];
      }
      const noTransport: typeof fetch = async () => {
        throw new Error("The memory target has no HTTP transport");
      };
      return {
        root,
        webId,
        storage,
        fetch: noTransport,
        paginationWitnessSize: protocol === "lws" ? pageSize + 1 : undefined,
        claims: {
          protocol,
          rdfConneg: {
            state: protocol === "solid" ? "available" : "unknown",
            evidence: "target",
            detail: { formats: protocol === "solid" ? ["text/turtle", "application/ld+json"] : [] },
          },
          move: {
            state: protocol === "solid" ? "available" : "unknown",
            evidence: "target",
            detail: {
              native: false,
              containers: protocol === "solid",
              preservesIdentifier: protocol === "solid" ? false : null,
            },
          },
          pagination: {
            state: protocol === "lws" ? "available" : "unknown",
            evidence: "target",
            detail: undefined,
          },
        },
        async resolveFeatures() {
          return deriveFeatures(description);
        },
        async authFetchFor(identity) {
          if (identity === webId) return noTransport;
          throw new StorageError("unsupported", { method: "AUTH", url: root });
        },
        async stop() {},
      };
    },
  };
}
