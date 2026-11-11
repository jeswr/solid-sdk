// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { deriveFeatures, type StorageDescription } from "@jeswr/storage-capabilities";
import { LWS, SSD } from "@jeswr/storage-capabilities/vocab";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import type { ConformanceTarget } from "../types.js";
import { memoryTransport } from "./memory-transport.js";

/** Reference target with actual in-memory storage semantics, including LWS pagination. */
export function memoryTarget(
  protocol: "solid" | "lws",
  {
    pageSize = 100,
    accessModel = "wac",
    trash = true,
    versioning = true,
  }: {
    pageSize?: number;
    accessModel?: "wac" | "acp";
    trash?: boolean;
    versioning?: boolean;
  } = {},
): ConformanceTarget {
  return {
    name: `memory-${protocol}${protocol === "solid" && accessModel === "acp" ? "-acp" : ""}`,
    async start() {
      const root = `https://memory-${protocol}.example/`;
      const webId = "https://identity.example/alice#me";
      const storage = createMemoryStorage({ protocol, root, pageSize, trash, versioning });
      const transport = await memoryTransport(storage, webId, accessModel);
      const description: StorageDescription = {
        protocol,
        id: root,
        root,
        descriptionUrl: `${root}description`,
        services: [
          ...(trash ? [{ type: [SSD.TrashService], endpoint: `${root}.trash/`, extra: {} }] : []),
          ...(versioning
            ? [
                {
                  type: [SSD.VersioningService],
                  endpoint: `${root}.versions/?resource={resource}`,
                  extra: {},
                },
              ]
            : []),
        ],
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
        description.services = [
          ...description.services,
          { type: [LWS.StorageRoot], endpoint: root, extra: {} },
          {
            type: [LWS.AccessGrantService],
            endpoint: transport.grantsEndpoint as string,
            conformsTo: [LWS.AccessProfile],
            extra: {},
          },
          { type: [LWS.TypeIndexService], endpoint: transport.indexEndpoint as string, extra: {} },
          {
            type: [LWS.TypeSearchService],
            endpoint: transport.searchEndpoint as string,
            extra: {},
          },
        ];
      } else {
        description.capabilities = [
          ...description.capabilities,
          {
            type: [SSD.AccessControl],
            extra: { model: accessModel === "wac" ? SSD.WAC : SSD.ACP },
          },
        ];
      }
      const features = deriveFeatures(description);
      Object.assign(storage.features, {
        accessControl: features.accessControl,
        accessGrants: features.accessGrants,
        typeIndex: features.typeIndex,
      });
      return {
        root,
        webId,
        storage,
        jsonLdWrites: true,
        fetch: transport.fetch,
        accessModel,
        serviceEndpoints: {
          trash: `${root}.trash/`,
          versioning: `${root}.versions/?resource={resource}`,
          typeSearch: transport.searchEndpoint,
        },
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
          trash: {
            state: trash ? "available" : "unknown",
            evidence: "target",
            detail: trash ? { endpoint: `${root}.trash/` } : {},
          },
          versioning: {
            state: versioning ? "available" : "unknown",
            evidence: "target",
            detail: versioning ? { endpoint: `${root}.versions/?resource={resource}` } : {},
          },
          accessControl: {
            state: "available",
            evidence: "target",
            detail: { model: protocol === "lws" ? "odrl-grants" : accessModel },
          },
          typeIndex: {
            state: "available",
            evidence: "target",
            detail:
              protocol === "solid"
                ? { mode: "client" }
                : {
                    mode: "server",
                    indexEndpoint: transport.indexEndpoint,
                    searchEndpoint: transport.searchEndpoint,
                  },
          },
        },
        async resolveFeatures() {
          return deriveFeatures(description);
        },
        async authFetchFor(identity) {
          if (identity === webId) return transport.fetch;
          throw new StorageError("unsupported", { method: "AUTH", url: root });
        },
        async stop() {},
      };
    },
  };
}
