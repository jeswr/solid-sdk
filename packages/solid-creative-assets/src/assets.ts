// AUTHORED-BY Claude Sonnet 5.5
/**
 * Facade over the generated model: one call builds or parses a whole asset description
 * document (the asset at `<doc#it>`, plus its optional run, prompt, model, settings and
 * thumbnail at hash IRIs). Every node is one generated flat entity; this file only picks
 * the fragments, links the nodes and checks the required fields on write.
 */
import { createParseScope, isSafeAbsoluteIri, type ParseOptions } from "@jeswr/model-runtime";
import type { DatasetCore } from "@rdfjs/types";
import { Store } from "n3";
import {
  type AiModelData,
  type CollectionData,
  type CreativeWorkData,
  entities,
  type ImageData,
  type Model3DData,
  type VideoData,
} from "./generated/model.js";
import { FRAGMENTS } from "./vocab.js";

export type { AiModelData };

type Managed = "thumbnail" | "wasGeneratedBy";
/** The asset's own fields; the thumbnail and run links are managed by the facade. */
export type ImageAssetData = Omit<ImageData, Managed>;
export type VideoAssetData = Omit<VideoData, Managed>;
export type Model3DAssetData = Omit<Model3DData, Managed>;
/** A thumbnail node: its own file with dimensions. */
export type ThumbnailData = Pick<ImageData, "contentUrl" | "width" | "height" | "encodingFormat">;
/** One generation setting; `value` is text because a 64-bit seed does not fit a JS number. */
export interface SettingData {
  propertyID: string;
  value: string;
}
/** How an asset was produced. Every field is optional; any of them creates the `#run` node. */
export interface GenerationData {
  startedAtTime?: Date;
  endedAtTime?: Date;
  prompt?: string;
  model?: AiModelData;
  settings?: SettingData[];
  /** Source asset IRIs the run used (besides the prompt and settings). */
  usedAssets?: string[];
  /** Extra agents of the run, such as the user's WebID (the model is added automatically). */
  associatedWith?: string[];
}
/** Optional nodes shared by every asset kind. */
export interface Described {
  thumbnail?: ThumbnailData;
  generation?: GenerationData;
}
export type AssetDescription = Described &
  (
    | { kind: "image"; asset: ImageAssetData }
    | { kind: "video"; asset: VideoAssetData }
    | { kind: "model3d"; asset: Model3DAssetData }
  );
export type ProjectDocumentData = Omit<CreativeWorkData, "text">;
export type { CollectionData };

type Buildable<D> = {
  build(url: string, data: D): Store;
  parse(url: string, dataset: DatasetCore, options?: ParseOptions): unknown;
};

/** A document URL is an absolute IRI without a fragment: the nodes are its hash IRIs. */
export function documentUrl(url: string): string {
  if (!isSafeAbsoluteIri(url) || url.includes("#")) {
    throw new TypeError("document URL must be a safe absolute IRI without a fragment");
  }
  return url;
}

/** The IRI of a node in the document, such as `nodeIri(doc, "run")`. */
export function nodeIri(url: string, fragment: string): string {
  return `${documentUrl(url)}#${fragment}`;
}

/** Build one node and fail closed when the generated guards dropped a required value. */
function build<D>(
  entity: Buildable<D>,
  iri: string,
  data: D,
  what: string,
  accept: (parsed: never) => boolean = () => true,
): Store {
  const store = entity.build(iri, data);
  const parsed = entity.parse(iri, store);
  if (parsed === undefined || !accept(parsed as never)) {
    throw new TypeError(`${what} is missing a required value or has an invalid one`);
  }
  return store;
}

function buildGeneration(doc: string, g: GenerationData, into: Store): void {
  const used: string[] = [];
  const agents: string[] = [];
  if (g.prompt !== undefined) {
    const iri = nodeIri(doc, FRAGMENTS.prompt);
    const prompt = build(
      entities.CreativeWork,
      iri,
      { text: g.prompt },
      "prompt",
      (p: CreativeWorkData) => p.text !== undefined,
    );
    into.addQuads([...prompt]);
    used.push(iri);
  }
  if (g.model !== undefined) {
    const iri = nodeIri(doc, FRAGMENTS.model);
    into.addQuads([...build(entities.AiModel, iri, g.model, "model")]);
    agents.push(iri);
  }
  (g.settings ?? []).forEach((setting, index) => {
    const iri = nodeIri(doc, `${FRAGMENTS.settingPrefix}${index + 1}`);
    const data = { propertyID: setting.propertyID, settingValue: setting.value };
    into.addQuads([...build(entities.Setting, iri, data, "setting")]);
    used.push(iri);
  });
  const run = {
    ...(g.startedAtTime ? { startedAtTime: g.startedAtTime } : {}),
    ...(g.endedAtTime ? { endedAtTime: g.endedAtTime } : {}),
    used: [...used, ...(g.usedAssets ?? [])],
    wasAssociatedWith: [...agents, ...(g.associatedWith ?? [])],
  };
  into.addQuads([...build(entities.Run, nodeIri(doc, FRAGMENTS.run), run, "run")]);
}

/** Build the whole description document of an asset as one store. */
export function buildAssetDocument(url: string, description: AssetDescription): Store {
  const doc = documentUrl(url);
  const iri = nodeIri(doc, FRAGMENTS.asset);
  const store = new Store();
  const links = {
    ...(description.thumbnail ? { thumbnail: nodeIri(doc, FRAGMENTS.thumbnail) } : {}),
    ...(description.generation ? { wasGeneratedBy: nodeIri(doc, FRAGMENTS.run) } : {}),
  };
  switch (description.kind) {
    case "image":
      store.addQuads([...build(entities.Image, iri, { ...description.asset, ...links }, "image")]);
      break;
    case "video":
      store.addQuads([...build(entities.Video, iri, { ...description.asset, ...links }, "video")]);
      break;
    case "model3d":
      store.addQuads([
        ...build(entities.Model3D, iri, { ...description.asset, ...links }, "3D model"),
      ]);
      break;
  }
  if (description.thumbnail) {
    const thumbIri = nodeIri(doc, FRAGMENTS.thumbnail);
    store.addQuads([...build(entities.Image, thumbIri, description.thumbnail, "thumbnail")]);
  }
  if (description.generation) buildGeneration(doc, description.generation, store);
  return store;
}

function parseGeneration(
  doc: string,
  dataset: DatasetCore,
  options: ParseOptions,
): GenerationData | undefined {
  const run = entities.Run.parse(nodeIri(doc, FRAGMENTS.run), dataset, options);
  if (run === undefined) return undefined;
  const generation: GenerationData = {};
  if (run.startedAtTime) generation.startedAtTime = run.startedAtTime;
  if (run.endedAtTime) generation.endedAtTime = run.endedAtTime;
  const promptIri = nodeIri(doc, FRAGMENTS.prompt);
  const modelIri = nodeIri(doc, FRAGMENTS.model);
  const settingPrefix = nodeIri(doc, FRAGMENTS.settingPrefix);
  const settings: [number, SettingData][] = [];
  const usedAssets: string[] = [];
  for (const used of run.used ?? []) {
    const index = used.startsWith(settingPrefix)
      ? Number(used.slice(settingPrefix.length))
      : Number.NaN;
    if (used === promptIri) {
      const text = entities.CreativeWork.parse(used, dataset, options)?.text;
      if (text !== undefined) generation.prompt = text;
    } else if (Number.isInteger(index)) {
      const s = entities.Setting.parse(used, dataset, options);
      if (s) settings.push([index, { propertyID: s.propertyID, value: s.settingValue }]);
    } else usedAssets.push(used);
  }
  if (settings.length) generation.settings = settings.sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  if (usedAssets.length) generation.usedAssets = usedAssets;
  const associatedWith: string[] = [];
  for (const agent of run.wasAssociatedWith ?? []) {
    if (agent !== modelIri) associatedWith.push(agent);
    else {
      const model = entities.AiModel.parse(agent, dataset, options);
      if (model) generation.model = model;
    }
  }
  if (associatedWith.length) generation.associatedWith = associatedWith;
  return generation;
}

const KINDS = [
  ["image", entities.Image],
  ["video", entities.Video],
  ["model3d", entities.Model3D],
] as const;

/** Parse an asset description document; `undefined` unless `<doc#it>` is a valid asset. */
export function parseAssetDocument(
  url: string,
  dataset: DatasetCore,
): AssetDescription | undefined {
  const doc = documentUrl(url);
  const options = { scope: createParseScope(dataset) };
  const iri = nodeIri(doc, FRAGMENTS.asset);
  for (const [kind, entity] of KINDS) {
    const data = entity.parse(iri, dataset, options);
    if (data === undefined) continue;
    const { thumbnail, wasGeneratedBy, ...asset } = data;
    const result = { kind, asset } as AssetDescription;
    if (thumbnail === nodeIri(doc, FRAGMENTS.thumbnail)) {
      const t = entities.Image.parse(thumbnail, dataset, options);
      if (t) result.thumbnail = pickThumbnail(t);
    }
    if (wasGeneratedBy === nodeIri(doc, FRAGMENTS.run)) {
      const generation = parseGeneration(doc, dataset, options);
      if (generation) result.generation = generation;
    }
    return result;
  }
  return undefined;
}

function pickThumbnail(t: ImageData): ThumbnailData {
  return {
    contentUrl: t.contentUrl,
    ...(t.width === undefined ? {} : { width: t.width }),
    ...(t.height === undefined ? {} : { height: t.height }),
    ...(t.encodingFormat === undefined ? {} : { encodingFormat: t.encodingFormat }),
  };
}
