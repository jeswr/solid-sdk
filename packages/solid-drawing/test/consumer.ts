// AUTHORED-BY Codex (GPT-6.1 Sol)

import {
  buildScene,
  parseScene,
  parseSceneTtl,
  type Quad,
  type SceneData,
  sceneSubject,
  serializeScene,
  storeToTurtle,
} from "@jeswr/solid-drawing";
import { buildScene as subpathBuild } from "@jeswr/solid-drawing/scene";
import type { DatasetCore, NamedNode } from "@rdfjs/types";
import type { Store } from "n3";

const data: SceneData = {
  sceneDocument: "https://pod.example/drawing.excalidraw",
  title: "Title",
  created: "2026-01-01T00:00:00Z",
  modified: "2026-01-02T00:00:00Z",
  schemaVersion: "2",
  viewBackgroundColor: "#fff",
  thumbnail: "https://pod.example/thumb",
  about: "https://pod.example/about",
  wasGeneratedBy: "https://pod.example/activity",
};
const subject: (url: string) => NamedNode = sceneSubject;
const build: (url: string, value: SceneData) => Store = buildScene;
const subpath: typeof buildScene = subpathBuild;
const parse: (url: string, dataset: DatasetCore) => SceneData | undefined = parseScene;
const parseTtl: (
  url: string,
  body: string,
  contentType?: string | null,
) => Promise<SceneData | undefined> = parseSceneTtl;
const serialize: (url: string, value: SceneData) => Promise<string> = serializeScene;
const serializeStore: (store: Store) => Promise<string> = storeToTurtle;
// Store iteration uses RDF/JS Quad; the public Quad alias remains the n3 class.
const publicQuad: (quad: Quad) => import("n3").Quad = (quad) => quad;
// @ts-expect-error The public timestamp type remains string.
const badTimestamp: SceneData = { sceneDocument: data.sceneDocument, created: new Date() };
// @ts-expect-error The canvas link remains required.
const missingCanvas: SceneData = { title: "orphan" };
void [
  subject,
  build,
  subpath,
  parse,
  parseTtl,
  serialize,
  serializeStore,
  publicQuad,
  badTimestamp,
  missingCanvas,
];
