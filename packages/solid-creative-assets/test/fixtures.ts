// AUTHORED-BY Claude Sonnet 5.5
/** Shared test fixtures. Not exported from the package. */
import type { DatasetCore, Quad } from "@rdfjs/types";
import type { AssetDescription } from "../src/assets.js";

export const DOC = "https://pod.example/creative/assets/sunset";
export const ALICE = "https://alice.example/profile/card#me";

export const fullImage: AssetDescription = {
  kind: "image",
  asset: {
    name: "Sunset fox",
    description: "A red fox at sunset.",
    contentUrl: "https://pod.example/creative/files/sunset.png",
    encodingFormat: "image/png",
    width: 1024,
    height: 768,
    contentSize: "1.2 MB",
    dateCreated: new Date("2026-06-15T09:41:07.000Z"),
    keywords: ["ai", "sunset"],
    creator: ALICE,
    wasDerivedFrom: ["https://pod.example/creative/assets/sketch#it"],
    isBasedOn: ["https://pod.example/creative/assets/sketch#it"],
  },
  thumbnail: {
    contentUrl: "https://pod.example/creative/files/sunset-thumb.webp",
    width: 128,
    height: 96,
    encodingFormat: "image/webp",
  },
  generation: {
    startedAtTime: new Date("2026-06-15T09:40:00.000Z"),
    endedAtTime: new Date("2026-06-15T09:41:00.000Z"),
    prompt: "a red fox at sunset, oil painting",
    model: {
      name: "Flux Pro",
      identifier: "flux-pro-1.1",
      softwareVersion: "1.1",
      provider: "https://bfl.ai/",
    },
    settings: [
      { propertyID: "seed", value: "18446744073709551615" },
      { propertyID: "steps", value: "30" },
    ],
    usedAssets: ["https://pod.example/creative/assets/sketch#it"],
    associatedWith: [ALICE],
  },
};

export const video: AssetDescription = {
  kind: "video",
  asset: {
    name: "Fox run",
    contentUrl: "https://pod.example/creative/files/fox.mp4",
    encodingFormat: "video/mp4",
    width: 1280,
    height: 720,
    duration: "PT5.5S",
    keywords: ["fox"],
  },
  generation: { prompt: "a fox running", settings: [{ propertyID: "seed", value: "42" }] },
};

export const mesh: AssetDescription = {
  kind: "model3d",
  asset: {
    name: "Fox mesh",
    contentUrl: "https://pod.example/creative/files/fox.glb",
    encodingFormat: "model/gltf-binary",
    contentSize: "3 MB",
  },
};

export const splat: AssetDescription = {
  kind: "model3d",
  asset: {
    name: "Fox splat",
    contentUrl: "https://pod.example/creative/files/fox.splat",
    encodingFormat: "application/x-gaussian-splat",
  },
  generation: { model: { identifier: "splat-gen-2" } },
};

/** The sorted, lexical form of every quad: a graph comparison for blank-node-free data. */
export function graphOf(dataset: DatasetCore): string[] {
  const term = (t: Quad["object"]): string =>
    t.termType === "Literal"
      ? `"${t.value}"^^${t.datatype.value}@${t.language}`
      : `${t.termType}:${t.value}`;
  return [...dataset]
    .map((q) => `${term(q.subject)} ${term(q.predicate)} ${term(q.object)}`)
    .sort();
}
