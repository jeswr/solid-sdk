// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { checkOwnerOnly, createOwnerOnlyDestinationVerifier } from "@jeswr/pod-access";
import { createTypeIndex } from "@jeswr/pod-type-index";
import {
  createPodClient,
  isAuxiliaryResource,
  type StorageClient,
  StorageError,
  type WriteResult,
} from "@jeswr/storage-client";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { entities, nodes } from "./generated/model.js";
import { normalizeWeek } from "./meal-plan.js";
import {
  DAYS,
  fromGenerated,
  MEAL_PLAN_CLASS,
  type MealPlanData,
  parseMealPlan,
  parseRecipe,
  RECIPE_CLASS,
  type RecipeData,
  recipeSubject,
  serializeMealPlan,
  serializeRecipe,
  toGenerated,
  validateRecipe,
} from "./model.js";

export interface RecipeRecord {
  url: string;
  etag: string | null;
  data: RecipeData;
}
export interface PlanRecord {
  url: string;
  etag: string | null;
  data: MealPlanData;
}
export interface SkippedRecipeEntry {
  url: string;
  reason: "unreadable" | "invalid-data";
}
export interface RecipeListing {
  recipes: RecipeRecord[];
  plans: PlanRecord[];
  skipped: SkippedRecipeEntry[];
}
export interface RecipeStore {
  container: string;
  registrationError?: unknown;
  list(): Promise<RecipeListing>;
  create(data: RecipeData, name?: string): Promise<RecipeRecord>;
  update(record: RecipeRecord, data: RecipeData): Promise<RecipeRecord>;
  savePlan(data: MealPlanData, previous?: PlanRecord): Promise<PlanRecord>;
}

export class RecipePrivacyError extends Error {
  constructor() {
    super("Recipes couldn't verify owner-only access on this pod. Nothing was saved.");
    this.name = "RecipePrivacyError";
  }
}

const MAX_DOCUMENT_BYTES = 1_048_576;
const MAX_LIST_BYTES = 4_000_000;
const READ_TIMEOUT_MS = 10_000;
const CHECK_URL = "https://recipe.invalid/check";

function missing(error: unknown): boolean {
  return error instanceof StorageError && error.code === "not-found";
}
function conflict(error: unknown): boolean {
  return error instanceof StorageError && ["conflict", "precondition-failed"].includes(error.code);
}
function strong(etag: string | null): etag is string {
  return etag !== null && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag);
}
function validator(etag: string | null): string {
  if (!strong(etag)) throw new Error("Your pod did not provide a safe version for this recipe");
  return etag;
}
function receipt(result: WriteResult): string | null {
  return result.etagSource === "response" ? result.etag : null;
}
function stale(url: string) {
  return new StorageError("precondition-failed", { method: "PUT", url });
}
async function requirePrivate(storage: StorageClient, url: string, ownerWebId?: string) {
  if (!ownerWebId) throw new RecipePrivacyError();
  const access = await checkOwnerOnly({ storage, url, ownerWebId }).catch(() => null);
  if (!access?.private) throw new RecipePrivacyError();
}

function safeDocument(storage: StorageClient, url: string): boolean {
  return (
    URL.canParse(url) &&
    new URL(url).href === url &&
    !url.includes("?") &&
    !url.includes("#") &&
    storage.isWithinStorage(url) &&
    !isAuxiliaryResource(url)
  );
}
async function checkResource(storage: StorageClient, url: string, parents: string[]) {
  const invalid = () => new StorageError("scope", { method: "PUT", url });
  if (!safeDocument(storage, url) || parents.includes(url)) throw invalid();
  // Solid membership follows the path. LWS requires the fresh, server-advertised parent.
  if (storage.protocol === "solid" && !parents.includes((await storage.parentOf(url)) ?? ""))
    throw invalid();
  const head = await storage.head(url, {
    revalidate: true,
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (
    head.url !== url ||
    head.kind !== "resource" ||
    !head.parent ||
    !parents.includes(head.parent)
  )
    throw invalid();
  const parent = await storage.head(head.parent, {
    revalidate: true,
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  });
  if (
    parent.url !== head.parent ||
    parent.kind !== "container" ||
    isAuxiliaryResource(url, head, parent)
  )
    throw invalid();
  return head.parent;
}

function updateRecipeDataset(
  current: Awaited<ReturnType<StorageClient["readRdf"]>>,
  data: RecipeData,
): RecipeData {
  const { url, dataset } = current;
  const original = fromGenerated(entities.Recipe.parse(url, dataset));
  if (!original) throw new Error("Couldn't read the recipe to update");
  for (const quad of dataset) {
    if (quad.graph.termType !== "DefaultGraph")
      throw new StorageError("not-rdf", { method: "PUT", url });
  }

  validateRecipe(data);
  const before = entities.Recipe.build(url, toGenerated(original));
  const after = entities.Recipe.build(url, toGenerated(data));
  const nested = Object.values(nodes.Recipe)
    .filter((node) => node.fragment !== "it")
    .map((node) => node.subject(url));
  const changed = new Set<string>();
  // Use the generated graph to identify the predicates owned by the changed fields.
  // The source dataset keeps all other statements, including other subjects and annotations.
  for (const quad of [...before.difference(after), ...after.difference(before)]) {
    if (quad.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type") {
      if (after.has(quad)) dataset.add(quad);
      continue;
    }
    const key = JSON.stringify([quad.subject.value, quad.predicate.value]);
    if (changed.has(key)) continue;
    changed.add(key);
    const values = after.match(quad.subject, quad.predicate, null, quad.graph);
    const existing = dataset.match(quad.subject, quad.predicate, null, quad.graph);
    if (quad.object.termType === "NamedNode" && nested.includes(quad.object.value)) {
      // Keep a link when clearing the modeled value: the node can have other properties.
      if (values.size === 0) continue;
      for (const value of existing) {
        if (!values.has(value)) throw stale(url);
      }
    }
    for (const value of existing) dataset.delete(value);
    for (const value of values) dataset.add(value);
  }
  const expected = fromGenerated(entities.Recipe.parse(url, after));
  const parsed = fromGenerated(entities.Recipe.parse(url, dataset));
  if (!expected || !parsed) throw stale(url);
  // An externally linked composite may use noncanonical node IDs. Refuse a change
  // that didn't reach its intended field, rather than silently rewriting that link.
  for (const field of Object.keys({ ...original, ...expected }) as (keyof RecipeData)[]) {
    if (
      JSON.stringify(expected[field]) !== JSON.stringify(original[field]) &&
      JSON.stringify(expected[field]) !== JSON.stringify(parsed[field])
    )
      throw stale(url);
  }
  return parsed;
}

/** Shared pod I/O stays in the model package. Supply the owner WebID to enable writes. */
export function recipeStore(
  storage: StorageClient,
  container: string,
  planContainer = container,
  ownerWebId?: string,
): RecipeStore {
  let knownRecipes = new Set<string>();
  let recipeVersion = 0;
  const reservations = new Map<
    string,
    { url: string; etag: string | null; attemptedBody?: string }
  >();
  async function read(url: string, signal = AbortSignal.timeout(READ_TIMEOUT_MS)) {
    const result = await storage.read(url, {
      accept: "text/turtle",
      maxBytes: MAX_DOCUMENT_BYTES,
      signal,
    });
    return {
      body: await result.text(),
      contentType: result.contentType ?? "text/turtle",
      etag: result.etag,
    };
  }
  async function savedVersion(url: string, written: WriteResult, body: string) {
    const etag = receipt(written);
    if (strong(etag)) return etag;
    // A GET can supply a version when it returns the exact acknowledged representation.
    const observed = await read(url).catch(() => undefined);
    return observed?.body === body ? observed.etag : etag;
  }
  async function checkWrite(url: string, parents: string[]) {
    const parent = await checkResource(storage, url, parents);
    await requirePrivate(storage, parent, ownerWebId);
    await requirePrivate(storage, url, ownerWebId);
  }
  function rememberRecipe(url: string) {
    recipeVersion++;
    knownRecipes.add(recipeSubject(url));
  }
  return {
    container,
    async list() {
      const version = ++recipeVersion;
      const recipes: RecipeRecord[] = [];
      const plans: PlanRecord[] = [];
      const skipped: SkippedRecipeEntry[] = [];
      let count = 0;
      for (const location of new Set([container, planContainer])) {
        try {
          for await (const entry of storage.listAll(location, { maxBytes: MAX_LIST_BYTES })) {
            if (entry.kind === "container") continue;
            if (++count > 2000) throw new Error("This recipe box is too large to load in one view");
            if (!safeDocument(storage, entry.url)) continue;
            const signal = AbortSignal.timeout(READ_TIMEOUT_MS);
            let current: Awaited<ReturnType<typeof read>>;
            try {
              current = await read(entry.url, signal);
            } catch (error) {
              if (missing(error)) continue;
              if (
                error instanceof StorageError &&
                ((signal.aborted && error.code === "network") ||
                  ["not-rdf", "invalid-response", "unsupported", "payload-too-large"].includes(
                    error.code,
                  ))
              ) {
                skipped.push({ url: entry.url, reason: "unreadable" });
                continue;
              }
              throw error;
            }
            try {
              const recipe = await parseRecipe(entry.url, current.body, current.contentType);
              if (recipe) recipes.push({ url: entry.url, etag: current.etag, data: recipe });
              else {
                const plan = await parseMealPlan(entry.url, current.body, current.contentType);
                if (plan) plans.push({ url: entry.url, etag: current.etag, data: plan });
                else skipped.push({ url: entry.url, reason: "invalid-data" });
              }
            } catch {
              skipped.push({ url: entry.url, reason: "invalid-data" });
            }
          }
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
      if (version === recipeVersion)
        knownRecipes = new Set(recipes.map((recipe) => recipeSubject(recipe.url)));
      return { recipes, plans, skipped };
    },
    async create(data, name) {
      validateRecipe(data);
      const key = JSON.stringify([
        name,
        await serializeRecipe(CHECK_URL, { ...data, modified: undefined }),
      ]);
      await requirePrivate(storage, container, ownerWebId);
      if (name !== undefined && storage.protocol === "solid") {
        const url = new URL(encodeURIComponent(name), container).href;
        const parent = await storage.head(container, { revalidate: true });
        if (!safeDocument(storage, url) || isAuxiliaryResource(url, parent))
          throw new StorageError("scope", { method: "PUT", url });
      }
      let reservation = reservations.get(key);
      if (!reservation) {
        const created = await storage.create(container, null, {
          contentType: "text/turtle",
          name,
          links: [{ rel: "type", target: RECIPE_CLASS }],
        });
        reservation = { url: created.url, etag: receipt(created) };
        reservations.set(key, reservation);
      }
      const { url, attemptedBody } = reservation;
      await checkWrite(url, [container]);
      const current = await read(url);
      if (attemptedBody !== undefined && current.body === attemptedBody) {
        const parsed = await parseRecipe(url, current.body, current.contentType);
        if (!parsed) throw new Error("Couldn't read the saved recipe");
        reservations.delete(key);
        rememberRecipe(url);
        return { url, etag: current.etag, data: parsed };
      }
      if (current.body.length)
        throw new Error("The new recipe resource was changed by another writer");
      const ifMatch = validator(current.etag);
      if (reservation.etag !== null && reservation.etag !== ifMatch) throw stale(url);
      reservation.etag = ifMatch;
      const body = await serializeRecipe(url, data);
      const parsed = await parseRecipe(url, body);
      if (!parsed) throw new Error("Couldn't prepare the recipe");
      reservation.attemptedBody = body;
      const written = await storage.write(url, body, {
        contentType: "text/turtle",
        ifMatch,
      });
      reservations.delete(key);
      rememberRecipe(url);
      return { url, etag: await savedVersion(url, written, body), data: parsed };
    },
    async update(record, data) {
      const ifMatch = validator(record.etag);
      const { url } = record;
      await checkWrite(url, [container]);
      const current = await storage.readRdf(url, {
        maxBytes: MAX_DOCUMENT_BYTES,
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      if (current.url !== url || current.etag !== ifMatch) throw stale(url);
      const parsed = updateRecipeDataset(current, data);
      const written = await storage.writeRdf(url, current.dataset, { ifMatch });
      rememberRecipe(url);
      return { url, etag: receipt(written), data: parsed };
    },
    async savePlan(data, previous) {
      // Check dates before reserving a pod resource and use the canonical week as the key.
      await serializeMealPlan(CHECK_URL, data);
      data = normalizeWeek(data);
      const expected = previous && validator(previous.etag);
      if (previous && previous.data.name !== data.name)
        throw new TypeError("A meal plan belongs to its original week");
      const changes = DAYS.filter((day) => data[day] !== previous?.data[day]);
      const validateReferences = (before?: MealPlanData) => {
        for (const day of changes) {
          const recipe = data[day];
          if (recipe && recipe !== before?.[day] && !knownRecipes.has(recipe))
            throw new TypeError("Choose a recipe from your recipe box");
        }
      };
      let url = previous?.url;
      if (url === undefined) {
        validateReferences();
        await requirePrivate(storage, planContainer, ownerWebId);
        if (storage.protocol !== "solid")
          throw new Error("This pod does not support reserving one meal plan per week");
        const name = `week-${encodeURIComponent(data.name)}.ttl`;
        // Solid supports create-if-absent at an exact URL. Both writers can recover the
        // empty reservation, and only one PUT can succeed with its initial ETag.
        url = new URL(encodeURIComponent(name), planContainer).href;
        const parent = await storage.head(planContainer, { revalidate: true });
        if (!safeDocument(storage, url) || isAuxiliaryResource(url, parent))
          throw new StorageError("scope", { method: "PUT", url });
        try {
          const created = await storage.create(planContainer, null, {
            exactUrl: url,
            contentType: "text/turtle",
          });
          if (created.url !== url)
            throw new StorageError("invalid-response", { method: "PUT", url });
        } catch (error) {
          if (!conflict(error)) throw error;
        }
      }
      for (let attempt = 0; ; attempt++) {
        await checkWrite(url, previous ? [planContainer, container] : [planContainer]);
        const current = await read(url);
        if (expected !== undefined && current.etag !== expected) throw stale(url);
        const before = current.body
          ? await parseMealPlan(url, current.body, current.contentType)
          : undefined;
        if ((current.body || previous) && before?.name !== data.name)
          throw new Error("Couldn't read the meal plan for this week");
        validateReferences(before);
        const next = before ? { ...before } : { name: data.name, startDate: data.startDate };
        for (const day of changes) next[day] = data[day];
        const body = await serializeMealPlan(url, next);
        const parsed = await parseMealPlan(url, body);
        if (!parsed) throw new Error("Couldn't prepare the meal plan");
        try {
          const written = await storage.write(url, body, {
            contentType: "text/turtle",
            ifMatch: validator(current.etag),
          });
          return { url, etag: await savedVersion(url, written, body), data: parsed };
        } catch (error) {
          if (previous || attempt >= 2 || !conflict(error)) throw error;
        }
      }
    },
  };
}

export async function openRecipeStore(options: {
  fetch: typeof globalThis.fetch;
  storageUrl: string;
  webId: string;
  /** Explicit caller configuration for a known Solid transport without discovery headers. */
  protocol?: "solid";
}): Promise<RecipeStore> {
  const fetch: typeof globalThis.fetch = (input, init) =>
    options.fetch(input, {
      ...init,
      cache: init?.cache ?? (init?.method === "GET" ? "no-cache" : undefined),
      signal: init?.signal ?? AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  let storage: StorageClient;
  if (options.protocol === "solid") {
    storage = createSolidBackend({ fetch, root: options.storageUrl });
    const head = await storage.head(storage.root);
    if (head.links.has("acl") && !head.links.has("http://www.w3.org/ns/solid/acp#accessControl")) {
      const features = {
        ...storage.features,
        accessControl: { state: "available", evidence: "header:Link", detail: { model: "wac" } },
      } as const;
      storage = createSolidBackend({ fetch, root: storage.root, features });
    }
  } else storage = (await createPodClient({ fetch, storage: options.storageUrl })).storage;

  const locations = [
    { name: "recipes", type: RECIPE_CLASS, marker: "https://jeswr.org/ns/recipe#RecipeCollection" },
    {
      name: "meal-plans",
      type: MEAL_PLAN_CLASS,
      marker: "https://jeswr.org/ns/recipe#MealPlanCollection",
    },
  ] as const;
  const found = new Map<string, string>();
  if (storage.protocol === "lws") {
    for await (const entry of storage.listAll(storage.root, {
      maxBytes: MAX_LIST_BYTES,
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      revalidate: true,
    })) {
      if (entry.kind !== "container" || !safeDocument(storage, entry.url)) continue;
      for (const { marker } of locations) {
        if (!entry.types.includes(marker)) continue;
        if (found.has(marker) && found.get(marker) !== entry.url)
          throw new Error("More than one Recipes collection has the same type");
        found.set(marker, entry.url);
      }
    }
  }
  async function ensureContainer(location: (typeof locations)[number]): Promise<string> {
    const conventional = new URL(`${location.name}/`, storage.root).href;
    const existing = found.get(location.marker) ?? conventional;
    try {
      await verifyContainer(existing);
      return existing;
    } catch (error) {
      if (!missing(error) || found.has(location.marker)) throw error;
    }
    try {
      return (
        await storage.create(storage.root, null, {
          name: location.name,
          kind: "container",
          links: [{ rel: "type", target: location.marker }],
        })
      ).url;
    } catch (error) {
      if (storage.protocol !== "solid" || !conflict(error)) throw error;
      await verifyContainer(conventional);
      return conventional;
    }
  }
  async function verifyContainer(url: string) {
    const head = await storage.head(url, { revalidate: true });
    if (
      head.url !== url ||
      head.kind !== "container" ||
      head.parent !== storage.root ||
      isAuxiliaryResource(url, head)
    )
      throw new Error("Recipes collection could not be verified");
  }
  const container = await ensureContainer(locations[0]);
  const planContainer = await ensureContainer(locations[1]);
  if (container === planContainer) throw new Error("Recipes requires two distinct collections");
  const store = recipeStore(storage, container, planContainer, options.webId);
  if (storage.protocol !== "solid") return store;

  // A private registration can contain sensitive collection locations. Check the actual
  // index destinations selected by the SDK, even when a profile calls them private.
  const verifyNew = createOwnerOnlyDestinationVerifier({
    podRoot: storage.root,
    ownerWebId: options.webId,
    openStorage: () => storage,
  });
  const indexStorage: StorageClient = {
    ...storage,
    async writeRdf(url, dataset, opts) {
      await requirePrivate(storage, url, options.webId);
      return storage.writeRdf(url, dataset, opts);
    },
    async create(parent, body, opts) {
      if (body !== null) {
        if (!opts?.name) throw new RecipePrivacyError();
        const url = new URL(encodeURIComponent(opts.name), parent).href;
        if (!(await verifyNew(url).catch(() => false))) throw new RecipePrivacyError();
      }
      return storage.create(parent, body, opts);
    },
  };
  try {
    const index = createTypeIndex({
      storage: indexStorage,
      features: storage.features,
      profile: options.webId,
      fetch,
    });
    for (const [location, url] of [
      [locations[0], container],
      [locations[1], planContainer],
    ] as const) {
      try {
        await requirePrivate(storage, url, options.webId);
        await index.register(location.type, { container: url });
      } catch (error) {
        store.registrationError = error;
      }
    }
  } catch (error) {
    store.registrationError = error;
  }
  return store;
}
