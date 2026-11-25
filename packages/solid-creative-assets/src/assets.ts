// AUTHORED-BY Claude Sonnet 5.5
/**
 * Facade over the generated model: one call builds or parses a whole asset description
 * document (the asset at `<doc#it>`, plus its optional run, prompt, model, settings and
 * thumbnail at hash IRIs). Every node is one generated flat entity; this file only picks
 * the fragments, links the nodes and checks the required fields on write.
 */
import { createParseScope, isSafeAbsoluteIri, type ParseOptions } from "@jeswr/model-runtime";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import model, {
  type AiModelData,
  type CollectionData,
  type CreativeWorkData,
  entities,
  type ImageData,
  type Model3DData,
  type VideoData,
} from "./generated/model.js";
import { CLASSES, FRAGMENTS } from "./vocab.js";

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

/** At most this many settings are written or read. */
export const MAX_SETTINGS = 256;
const SETTING = /^setting-(0|[1-9]\d{0,2})$/;
const FIXED = new Set<string>([
  FRAGMENTS.asset,
  FRAGMENTS.run,
  FRAGMENTS.prompt,
  FRAGMENTS.model,
  FRAGMENTS.thumbnail,
]);

type Buildable<D> = {
  build(url: string, data: D): Store;
  parse(url: string, dataset: DatasetCore, options?: ParseOptions): unknown;
};

/**
 * A document URL is an http(s) URL in its normalised form (`new URL(x).href === x`), with no
 * userinfo and no fragment: the nodes are its hash IRIs, and the generated writer normalises
 * link values, so subject and link must already share one spelling.
 */
export function documentUrl(url: string): string {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (
    !parsed ||
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    url.includes("#") ||
    parsed.href !== url ||
    !isSafeAbsoluteIri(url)
  ) {
    throw new TypeError(
      "document URL must be a normalised http(s) URL without userinfo or fragment",
    );
  }
  return url;
}

/** The IRI of a node in the document; the fragment must be one this package writes. */
export function nodeIri(url: string, fragment: string): string {
  if (!FIXED.has(fragment) && !SETTING.test(fragment.startsWith("setting-") ? fragment : "")) {
    throw new TypeError(`unknown document fragment: ${fragment}`);
  }
  return `${documentUrl(url)}#${fragment}`;
}

/** The field names the generated entity has: the one list of keys a build may copy. */
export function fieldsOf(entity: string): string[] {
  const found = model.manifest.entities.find((e) => e.name === entity) as {
    fields: { name: string }[];
  };
  return found.fields.map((f) => f.name);
}

/** Copy only the named, defined keys: nothing the types omit reaches the generated writer. */
export function only<D>(input: object, keys: readonly string[]): D {
  const source = input as Record<string, unknown>;
  return Object.fromEntries(
    keys.filter((k) => source[k] !== undefined).map((k) => [k, source[k]]),
  ) as D;
}

const hrefOf = (value: string): string => {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
};

/** Every supplied value must have been written: a dropped value is a TypeError naming it. */
export function assertKept(what: string, supplied: object, parsed: object): void {
  const got = parsed as Record<string, unknown>;
  for (const [key, value] of Object.entries(supplied)) {
    if (value === undefined) continue;
    const back = got[key];
    let ok: boolean;
    if (Array.isArray(value)) {
      const members = key === "keywords" ? value.filter((m) => String(m).trim() !== "") : value;
      ok =
        members.length === 0 ||
        (Array.isArray(back) &&
          members.every((m: string) =>
            [m, m.trim(), hrefOf(m)].some((v) => (back as unknown[]).includes(v)),
          ));
    } else if (value instanceof Date) {
      ok = back instanceof Date && back.getTime() === value.getTime();
    } else ok = back !== undefined;
    if (!ok) throw new TypeError(`${what}: ${key} was not written because its value is invalid`);
  }
}

/** Build one node; fail closed when a required value, or any supplied one, was dropped. */
export function build<D extends object>(
  entity: Buildable<D>,
  iri: string,
  data: D,
  what: string,
): Store {
  const store = entity.build(iri, data);
  const parsed = entity.parse(iri, store);
  if (parsed === undefined || parsed === null) {
    throw new TypeError(`${what} is missing a required value or has an invalid one`);
  }
  assertKept(what, data, parsed);
  return store;
}

/** Add a second canonical type through the generated wrapper (not a hand-built triple). */
function addType(
  Wrapper: new (
    term: string,
    dataset: Store,
    factory: typeof DataFactory,
  ) => { types: Set<string> },
  iri: string,
  store: Store,
  type: string,
): void {
  new Wrapper(iri, store, DataFactory).types.add(type);
}

function rejectReserved(doc: string, what: string, iris: readonly string[] | undefined): void {
  for (const iri of iris ?? []) {
    const href = hrefOf(iri);
    const fragment = href.startsWith(`${doc}#`) ? href.slice(doc.length + 1) : undefined;
    if (fragment !== undefined && (FIXED.has(fragment) || fragment.startsWith("setting-"))) {
      throw new TypeError(`${what} must not name a reserved node of this document: ${iri}`);
    }
  }
}

const PROMPT_KEYS = ["text"];
const MODEL_KEYS = fieldsOf("AiModel");
const THUMBNAIL_KEYS = ["contentUrl", "width", "height", "encodingFormat"];
const ASSET_KEYS = {
  image: fieldsOf("Image").filter((k) => k !== "thumbnail" && k !== "wasGeneratedBy"),
  video: fieldsOf("Video").filter((k) => k !== "thumbnail" && k !== "wasGeneratedBy"),
  model3d: fieldsOf("Model3D").filter((k) => k !== "thumbnail" && k !== "wasGeneratedBy"),
};

function buildGeneration(doc: string, g: GenerationData, into: Store): void {
  const settings = g.settings ?? [];
  if (settings.length > MAX_SETTINGS) {
    throw new TypeError(`at most ${MAX_SETTINGS} settings are supported`);
  }
  rejectReserved(doc, "usedAssets", g.usedAssets);
  rejectReserved(doc, "associatedWith", g.associatedWith);
  const used: string[] = [];
  const agents: string[] = [];
  if (g.prompt !== undefined) {
    const iri = nodeIri(doc, FRAGMENTS.prompt);
    const store = build(entities.CreativeWork, iri, { text: g.prompt }, "prompt");
    addType(entities.CreativeWork.Wrapper, iri, store, CLASSES.promptEntity);
    into.addQuads([...store]);
    used.push(iri);
  }
  if (g.model !== undefined) {
    const iri = nodeIri(doc, FRAGMENTS.model);
    const store = build(entities.AiModel, iri, only<AiModelData>(g.model, MODEL_KEYS), "model");
    addType(entities.AiModel.Wrapper, iri, store, CLASSES.modelAgent);
    into.addQuads([...store]);
    agents.push(iri);
  }
  settings.forEach((setting, index) => {
    const iri = nodeIri(doc, `${FRAGMENTS.settingPrefix}${index + 1}`);
    const data = { propertyID: setting?.propertyID, settingValue: setting?.value };
    into.addQuads([...build(entities.Setting, iri, data as never, "setting")]);
    used.push(iri);
  });
  const run = {
    ...(g.startedAtTime === undefined ? {} : { startedAtTime: g.startedAtTime }),
    ...(g.endedAtTime === undefined ? {} : { endedAtTime: g.endedAtTime }),
    used: [...used, ...(g.usedAssets ?? [])],
    wasAssociatedWith: [...agents, ...(g.associatedWith ?? [])],
  };
  into.addQuads([...build(entities.Run, nodeIri(doc, FRAGMENTS.run), run, "run")]);
}

/** Build the whole description document of an asset as one store. */
export function buildAssetDocument(url: string, description: AssetDescription): Store {
  const doc = documentUrl(url);
  const iri = nodeIri(doc, FRAGMENTS.asset);
  const kind = description.kind;
  if (kind !== "image" && kind !== "video" && kind !== "model3d") {
    throw new TypeError(`unknown asset kind: ${String(kind)}`);
  }
  const asset = only<Record<string, unknown>>(description.asset, ASSET_KEYS[kind]);
  rejectReserved(doc, "wasDerivedFrom", asset.wasDerivedFrom as string[] | undefined);
  rejectReserved(doc, "isBasedOn", asset.isBasedOn as string[] | undefined);
  const data = {
    ...asset,
    ...(description.thumbnail ? { thumbnail: nodeIri(doc, FRAGMENTS.thumbnail) } : {}),
    ...(description.generation ? { wasGeneratedBy: nodeIri(doc, FRAGMENTS.run) } : {}),
  };
  const entity = { image: entities.Image, video: entities.Video, model3d: entities.Model3D }[kind];
  const store = new Store();
  store.addQuads([...build(entity as Buildable<object>, iri, data, kind)]);
  if (description.thumbnail) {
    const thumb = only<ThumbnailData>(description.thumbnail, THUMBNAIL_KEYS);
    store.addQuads([
      ...build(entities.Image, nodeIri(doc, FRAGMENTS.thumbnail), thumb as ImageData, "thumbnail"),
    ]);
  }
  if (description.generation) buildGeneration(doc, description.generation, store);
  assertWholeDocument(doc, description, store);
  return store;
}

/** A build never returns a disconnected graph: every supplied node must read back. */
function assertWholeDocument(doc: string, d: AssetDescription, store: Store): void {
  const back = parseAssetDocument(doc, store);
  const g = d.generation;
  const lost =
    back === undefined ||
    (d.thumbnail && !back.thumbnail) ||
    (g &&
      (!back.generation ||
        (g.prompt !== undefined && back.generation.prompt === undefined) ||
        (g.model !== undefined && back.generation.model === undefined) ||
        (g.settings?.length ?? 0) !== (back.generation.settings?.length ?? 0)));
  if (lost) throw new TypeError("the document did not read back with every node supplied");
}

/** Marks a parse that must fail as a whole rather than return a partial description. */
const FAILED = null;

function parseGeneration(
  doc: string,
  dataset: DatasetCore,
  options: ParseOptions,
): GenerationData | undefined | typeof FAILED {
  const run = entities.Run.parse(nodeIri(doc, FRAGMENTS.run), dataset, options);
  if (run === undefined) return undefined;
  const generation: GenerationData = {};
  if (run.startedAtTime) generation.startedAtTime = run.startedAtTime;
  if (run.endedAtTime) generation.endedAtTime = run.endedAtTime;
  const promptIri = nodeIri(doc, FRAGMENTS.prompt);
  const modelIri = nodeIri(doc, FRAGMENTS.model);
  const settings: [number, SettingData][] = [];
  const usedAssets: string[] = [];
  for (const used of run.used ?? []) {
    const match = used.startsWith(`${doc}#`) ? SETTING.exec(used.slice(doc.length + 1)) : null;
    if (used === promptIri) {
      const text = entities.CreativeWork.parse(used, dataset, options)?.text;
      if (text !== undefined) generation.prompt = text;
    } else if (match) {
      if (settings.length >= MAX_SETTINGS) return FAILED;
      const s = entities.Setting.parse(used, dataset, options);
      if (s) settings.push([Number(match[1]), { propertyID: s.propertyID, value: s.settingValue }]);
    } else usedAssets.push(used);
  }
  if (settings.length) generation.settings = settings.sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  if (usedAssets.length) generation.usedAssets = usedAssets;
  const associatedWith: string[] = [];
  for (const agent of run.wasAssociatedWith ?? []) {
    if (agent !== modelIri) associatedWith.push(agent);
    else {
      const found = entities.AiModel.parse(agent, dataset, options);
      if (found) generation.model = found;
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

/**
 * Parse an asset description document; `undefined` unless `<doc#it>` is a valid asset, and
 * also `undefined` when the document is too large to read completely (more than
 * {@link MAX_SETTINGS} settings, or the parse budget ran out).
 */
export function parseAssetDocument(
  url: string,
  dataset: DatasetCore,
): AssetDescription | undefined {
  const doc = documentUrl(url);
  const scope = createParseScope(dataset);
  const options = { scope };
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
      if (generation === FAILED) return undefined;
      if (generation) result.generation = generation;
    }
    return scope.exhausted ? undefined : result;
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
