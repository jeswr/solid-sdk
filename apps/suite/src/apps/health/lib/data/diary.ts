// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { correlate, rankSuspicions } from "@jeswr/health-insights";
import {
  buildMeal,
  buildSymptom,
  deriveExposures,
  type ExposureData,
  type FoodItemData,
  isSymptomType,
  Meal,
  type MealData,
  parseMeal,
  parseSymptom,
  Symptom,
  type SymptomData,
  type SymptomType,
} from "@jeswr/solid-health-diary";
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { diaryDay } from "../diary-time";
import { emptyHealthDocument, HealthIoError, type Range } from "../model";
import { createHealthDataStore } from "./store";

interface CommonDraft {
  at: Date;
  note: string;
}
/** The widest gap between UTC and a local time zone (UTC+14). */
/** Largest gap between two UTC offsets (+14 h and -12 h): writer and viewer may sit at either end. */
const ZONE_SLACK = 26 * 3_600_000;

export type DiaryDraft = CommonDraft &
  (
    | {
        kind: "meal";
        foods: string[];
        ingredients: string;
        tags: string[];
        items?: FoodItemData[];
        exposures?: ExposureData[];
        itemIngredients?: string[];
      }
    | {
        kind: "symptom";
        symptomType: SymptomType;
        severity: number | null;
        durationMinutes: number | null;
      }
  );
export type DiaryEntry = DiaryDraft & { url: string; etag: string | null; readOnly?: boolean };
export interface DiaryReadFailure {
  url: string;
  error: unknown;
}

/** Match names first (including reorders), then treat an unmatched position as a rename. */
export function matchDiaryItems(
  foods: string[],
  previous: readonly FoodItemData[],
): FoodItemData[] {
  const used = new Set<number>();
  const matches = foods.map((food, index) => {
    const name = food.trim();
    const same =
      previous[index]?.name === name && !used.has(index)
        ? index
        : previous.findIndex((item, i) => item.name === name && !used.has(i));
    if (same >= 0) used.add(same);
    return same;
  });
  return foods.map((food, index) => {
    let match = matches[index] as number;
    if (match < 0 && previous[index] && !used.has(index)) {
      match = index;
      used.add(index);
    }
    return {
      ...(match >= 0 ? previous[match] : { sourceConfidence: "manual" as const }),
      name: food.trim(),
    };
  });
}

/** Only the two fields absent from the package model; no parallel diary vocabulary. */
class DiaryFields extends TermWrapper {
  get tags() {
    return SetFrom.subjectPredicate(
      this,
      `${NS.SCHEMA}keywords`,
      LiteralAs.string,
      LiteralFrom.string,
    );
  }
  get duration() {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEMA}duration`, LiteralAs.string);
  }
  set duration(value: string | undefined) {
    OptionalAs.object(this, `${NS.SCHEMA}duration`, value, LiteralFrom.string);
  }
}
/** Health canonicalizes schema to HTTPS; the diary package currently reads HTTP. */
function packageDataset(document: DatasetCore) {
  const copy = new Store([...document]);
  for (const quad of [...copy]) {
    if (!quad.predicate.value.startsWith(NS.SCHEMA)) continue;
    const subject = new TermWrapper(quad.subject, copy, DataFactory);
    SetFrom.subjectPredicate(
      subject,
      quad.predicate.value.replace(NS.SCHEMA, "http://schema.org/"),
      TermAs.term,
      TermFrom.itself,
    ).add(quad.object);
    copy.delete(quad);
  }
  return copy;
}
function missing(error: unknown) {
  return error instanceof RdfFetchError && error.status === 404;
}
function conflict(error: unknown) {
  return error instanceof HealthIoError && error.status === 412;
}
function version(etag: string | null): string {
  if (etag === null || !/^"[^"\r\n]*"$/.test(etag))
    throw new TypeError("This entry has no strong version. Refresh before editing.");
  return etag;
}
function validate(draft: DiaryDraft) {
  if (!Number.isFinite(draft.at.getTime()) || draft.note.length > 4000)
    throw new TypeError("Choose a valid time and keep notes under 4,000 characters.");
  if (draft.kind === "meal") {
    if (
      !draft.foods.length ||
      draft.foods.some((food) => !food.trim()) ||
      draft.foods.join("").length > 4000 ||
      draft.ingredients.length > 4000 ||
      (draft.itemIngredients !== undefined && draft.itemIngredients.join("\n").length > 4000) ||
      draft.tags.join("").length > 1000
    )
      throw new TypeError(
        "Enter at least one food and keep food text under 4,000 characters and tags under 1,000.",
      );
  } else if (
    !isSymptomType(draft.symptomType) ||
    (draft.severity !== null &&
      (!Number.isInteger(draft.severity) || draft.severity < 0 || draft.severity > 10)) ||
    (draft.durationMinutes !== null &&
      (!Number.isInteger(draft.durationMinutes) ||
        draft.durationMinutes < 1 ||
        draft.durationMinutes > 525600))
  )
    throw new TypeError(
      "Choose a symptom, severity from 0 to 10, and a duration from 1 to 525,600 minutes.",
    );
}
export function diaryLabel(entry: DiaryDraft): string {
  return entry.kind === "meal" ? entry.foods.join(", ") : entry.symptomType.replaceAll("-", " ");
}

/** Account-scoped diary operations; Health's existing store owns privacy verification. */
export function createDiaryStore(fetch: typeof globalThis.fetch, storage: string, owner: string) {
  // Solid requires an explicit BasicContainer link on PUT-created containers.
  const transport: typeof globalThis.fetch = (input, init) => {
    if (init?.method === "PUT" && String(input).endsWith("/")) {
      const headers = new Headers(init.headers);
      headers.set("link", `<${NS.LDP}BasicContainer>; rel="type"`);
      return fetch(input, { ...init, headers });
    }
    return fetch(input, init);
  };
  const store = createHealthDataStore(transport, storage, owner);
  const base = `${store.base}diary/`;
  const scoped = (url: string) => {
    const safe = assertWithinPodScope(base, url);
    if (!/^\d{4}-\d{2}\/[A-Za-z0-9_-]+\.ttl$/.test(safe.slice(base.length)))
      throw new TypeError("Invalid diary entry URL");
    return safe;
  };
  async function readEntry(url: string): Promise<DiaryEntry | null> {
    const safe = assertWithinPodScope(base, url);
    const legacy = /^(meals|symptoms)\/(?:\d{4}\/(?:0[1-9]|1[0-2])\/)?[A-Za-z0-9_-]+\.ttl$/.test(
      safe.slice(base.length),
    );
    if (!legacy) scoped(url);
    const { document, etag } = await readDocument(url);
    const fields = new DiaryFields(`${url}#it`, document, DataFactory);
    const compatible = packageDataset(document);
    const meal = parseMeal(url, compatible);
    if (meal)
      return {
        kind: "meal",
        readOnly: legacy,
        exposures: meal.exposures ?? [],
        url,
        etag,
        at: meal.startTime,
        foods: meal.items.map((item) => item.name as string),
        items: meal.items,
        ingredients: meal.items
          .map((item) => item.ingredientsText ?? "")
          .filter(Boolean)
          .join("\n"),
        tags: [...fields.tags].sort(),
        note: meal.note ?? "",
      };
    const symptom = parseSymptom(url, compatible);
    if (!symptom) {
      if (
        new Meal(`${url}#it`, compatible, DataFactory).isMeal ||
        new Symptom(`${url}#it`, compatible, DataFactory).isSymptom
      )
        throw new TypeError("This diary entry could not be read");
      return null;
    }
    const duration = fields.duration;
    if (duration !== undefined && !/^PT[1-9]\d*M$/.test(duration))
      throw new TypeError("Invalid symptom duration");
    return {
      kind: "symptom",
      readOnly: legacy,
      url,
      etag,
      at: symptom.onset,
      symptomType: symptom.symptomType,
      severity: symptom.severity ?? null,
      durationMinutes: duration === undefined ? null : Number(duration.slice(2, -1)),
      note: symptom.note ?? "",
    };
  }
  async function read(url: string): Promise<DiaryEntry> {
    const entry = await readEntry(url);
    if (!entry) throw new TypeError("This diary entry could not be read");
    return entry;
  }
  type MonthResult = { entries: DiaryEntry[]; failures: DiaryReadFailure[] };
  let catalogue: Promise<string[]> | undefined;
  const monthsCache = new Map<string, Promise<MonthResult>>();
  // Legacy data is read-only here. Keep listings and month reads across suite mutations.
  const legacyListings = new Map<string, Promise<string[]>>();
  const legacyMonths = new Map<string, Promise<MonthResult>>();
  function invalidateSuite() {
    catalogue = undefined;
    monthsCache.clear();
  }
  /** No URL means explicit Retry; notifications invalidate only their legacy subtree. */
  function invalidate(url?: string) {
    invalidateSuite();
    for (const cache of [legacyListings, legacyMonths]) {
      for (const key of cache.keys()) {
        if (
          url === undefined ||
          ((url.startsWith(`${base}meals/`) || url.startsWith(`${base}symptoms/`)) &&
            (key.startsWith(url) || url.startsWith(key)))
        )
          cache.delete(key);
      }
    }
  }
  // One queue for all reads, including concurrent consumers and every level of the walk.
  let activeReads = 0;
  const waiting: (() => void)[] = [];
  async function readDocument(url: string) {
    if (activeReads >= 6) await new Promise<void>((resolve) => waiting.push(resolve));
    else activeReads++;
    try {
      return await store.read(url);
    } finally {
      const next = waiting.shift();
      if (next) next();
      else activeReads--;
    }
  }
  async function monthUrls(): Promise<string[]> {
    try {
      const { document } = await readDocument(base);
      return [...new Container(base, document, DataFactory).contains]
        .map((item) => item.value)
        .filter(
          (url) => url.startsWith(base) && /^\d{4}-(0[1-9]|1[0-2])\/$/.test(url.slice(base.length)),
        );
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
  }
  async function childUrls(container: string, legacy: boolean): Promise<string[]> {
    let document: DatasetCore;
    try {
      document = (await readDocument(container)).document;
    } catch (error) {
      if (legacy && missing(error) && /\/(meals|symptoms)\/$/.test(container)) return [];
      throw error;
    }
    return [
      ...new Set(
        [...new Container(container, document, DataFactory).contains].map((item) => item.value),
      ),
    ].filter(
      (url) =>
        url.startsWith(container) &&
        (/^[A-Za-z0-9_-]+\.ttl$/.test(url.slice(container.length)) ||
          (legacy &&
            /^(meals|symptoms)\/(?:\d{4}\/)?$/.test(container.slice(base.length)) &&
            (/\/(meals|symptoms)\/$/.test(container) ? /^\d{4}\/$/ : /^(0[1-9]|1[0-2])\/$/).test(
              url.slice(container.length),
            ))),
    );
  }
  async function readDocuments(urls: string[]): Promise<MonthResult> {
    const entries: DiaryEntry[] = [],
      failures: DiaryReadFailure[] = [];
    await Promise.all(
      urls
        .filter((url) => !url.endsWith("/"))
        .map(async (url) => {
          try {
            const entry = await readEntry(url);
            if (entry) entries.push(entry);
          } catch (error) {
            failures.push({ url, error });
          }
        }),
    );
    return { entries, failures };
  }
  async function list(
    range?: Range,
    options: { failures?: DiaryReadFailure[]; cached?: boolean } = {},
  ): Promise<DiaryEntry[]> {
    if (
      range &&
      (!Number.isFinite(range.start.getTime()) ||
        !Number.isFinite(range.end.getTime()) ||
        range.end <= range.start)
    )
      throw new TypeError("Choose a valid date range");
    const result: DiaryEntry[] = [];
    if (options.cached && !catalogue) catalogue = monthUrls();
    const months = await (options.cached ? (catalogue as Promise<string[]>) : monthUrls());
    // Suite folders use the writer's local month; Coeliac folders use UTC. Widen both
    // for zone boundaries, then apply the precise timestamp filter to the results.
    const lower = range && new Date(range.start.getTime() - ZONE_SLACK);
    const upper = range && new Date(range.end.getTime() - 1 + ZONE_SLACK);
    const first = lower && diaryDay(lower).slice(0, 7);
    const last = upper && diaryDay(upper).slice(0, 7);
    const utcFirst = lower?.toISOString().slice(0, 7).replace("-", "/");
    const utcLast = upper?.toISOString().slice(0, 7).replace("-", "/");
    function collect(loaded: MonthResult) {
      options.failures?.push(...loaded.failures);
      for (const entry of loaded.entries) {
        if (!range || (entry.at >= range.start && entry.at < range.end)) result.push(entry);
      }
    }
    async function loadMonth(month: string, legacy: boolean, urls?: string[]) {
      const cache = legacy ? legacyMonths : monthsCache;
      let task = options.cached ? cache.get(month) : undefined;
      if (!task) {
        task = urls ? readDocuments(urls) : childUrls(month, false).then(readDocuments);
        if (options.cached) cache.set(month, task);
      }
      try {
        collect(await task);
      } catch (error) {
        if (cache.get(month) === task) cache.delete(month);
        options.failures?.push({ url: month, error });
      }
    }
    async function walkLegacy(container: string) {
      let task = options.cached ? legacyListings.get(container) : undefined;
      if (!task) {
        task = childUrls(container, true);
        if (options.cached) legacyListings.set(container, task);
      }
      let urls: string[];
      try {
        urls = await task;
      } catch (error) {
        if (legacyListings.get(container) === task) legacyListings.delete(container);
        options.failures?.push({ url: container, error });
        return;
      }
      await Promise.all([
        loadMonth(container, true, urls),
        ...urls
          .filter((url) => {
            if (!url.endsWith("/")) return false;
            if (!utcFirst || !utcLast) return true;
            const bucket = url
              .slice(base.length)
              .replace(/^(meals|symptoms)\//, "")
              .slice(0, -1);
            const length = bucket.length; // YYYY or YYYY/MM, both lexically ordered UTC buckets
            return bucket >= utcFirst.slice(0, length) && bucket <= utcLast.slice(0, length);
          })
          .map(walkLegacy),
      ]);
    }
    await Promise.all([
      ...months
        .filter((month) => {
          const key = month.slice(base.length, -1);
          return !first || !last || (key >= first && key <= last);
        })
        .map((month) => loadMonth(month, false)),
      walkLegacy(`${base}meals/`),
      walkLegacy(`${base}symptoms/`),
    ]);
    return result.sort((a, b) => b.at.getTime() - a.at.getTime() || a.url.localeCompare(b.url));
  }
  async function container(path: string) {
    try {
      await store.write(path, emptyHealthDocument(), { create: true });
    } catch (error) {
      if (!conflict(error)) throw error;
    }
  }
  async function save(
    draft: DiaryDraft,
    id: string,
    existing?: DiaryEntry,
    restoreUrl?: string,
  ): Promise<DiaryEntry> {
    if (existing?.readOnly) throw new TypeError("Coeliac entries are read-only");
    validate(draft);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new TypeError("Invalid diary ID");
    const source = existing ? scoped(existing.url) : undefined;
    const filename = source ? source.slice(source.lastIndexOf("/") + 1) : `${id}.ttl`;
    const url = scoped(restoreUrl ?? `${base}${diaryDay(draft.at).slice(0, 7)}/${filename}`);
    if (existing && existing.kind !== draft.kind)
      throw new TypeError("An entry's kind cannot change");
    const etag = existing ? version(existing.etag) : undefined;
    const moving = source !== undefined && source !== url;
    const condition = existing && !moving ? { etag: etag as string } : { create: true as const };
    const current = existing ? await readDocument(source as string) : null;
    if (moving && current?.etag !== etag) throw new HealthIoError(412, "move diary entry");
    const previous = packageDataset(current ? current.document : emptyHealthDocument());
    const previousMeal = parseMeal(source ?? url, previous);
    const previousSymptom = parseSymptom(source ?? url, previous);
    if (previousSymptom) delete previousSymptom.severity;
    const items =
      draft.kind === "meal"
        ? matchDiaryItems(draft.foods, draft.items ?? previousMeal?.items ?? [])
        : [];
    if (draft.kind === "meal") {
      const oldIngredients = items
        .map((item) => item.ingredientsText ?? "")
        .filter(Boolean)
        .join("\n");
      items.forEach((item, index) => {
        if (draft.itemIngredients) item.ingredientsText = draft.itemIngredients[index] ?? "";
        else if (draft.ingredients !== oldIngredients && index === 0)
          item.ingredientsText = draft.ingredients;
        item.id = `${url}#item-${index}`;
      });
    }
    const document =
      draft.kind === "meal"
        ? buildMeal(url, {
            ...previousMeal,
            startTime: draft.at,
            note: draft.note,
            patient: owner,
            items,
            exposures: diaryExposures(items, draft.exposures ?? previousMeal?.exposures),
          })
        : buildSymptom(url, {
            ...previousSymptom,
            onset: draft.at,
            note: draft.note,
            patient: owner,
            symptomType: draft.symptomType,
            ...(draft.severity === null ? {} : { severity: draft.severity }),
          });
    const fields = new DiaryFields(`${url}#it`, document, DataFactory);
    if (draft.kind === "meal")
      for (const tag of draft.tags) {
        if (tag.trim()) fields.tags.add(tag.trim());
      }
    else
      fields.duration = draft.durationMinutes === null ? undefined : `PT${draft.durationMinutes}M`;
    await store.initialize();
    await container(base);
    await container(new URL(".", url).href);
    try {
      await store.write(url, document, condition);
    } catch (error) {
      if (!conflict(error)) throw error;
      // Creation timestamps differ when retrying a create after a lost response.
      const actual = await readDocument(url);
      const intended = [...document].filter((quad) => quad.predicate.value !== `${NS.DCT}created`);
      const stored = [...actual.document].filter(
        (quad) => quad.predicate.value !== `${NS.DCT}created`,
      );
      if (stored.length !== intended.length || !intended.every((quad) => actual.document.has(quad)))
        throw error;
    }
    const saved = await read(url);
    if (moving) {
      try {
        await remove(existing as DiaryEntry);
      } catch (error) {
        // A lost DELETE response may mean the source is already gone. Never
        // discard the destination until a readable source is confirmed to remain.
        let remains = true;
        try {
          await read(source as string);
        } catch (readError) {
          if (!missing(readError)) throw error;
          remains = false;
        }
        if (remains) {
          await remove(saved);
          throw error;
        }
      }
    }
    invalidateSuite();
    return saved;
  }
  async function remove(entry: DiaryEntry): Promise<void> {
    if (entry.readOnly) throw new TypeError("Coeliac entries are read-only");
    const url = scoped(entry.url);
    const etag = version(entry.etag);
    const response = await fetch(url, {
      method: "DELETE",
      redirect: "error",
      headers: { "if-match": etag },
    });
    if (response.ok || response.status === 404) {
      invalidateSuite();
      return;
    }
    if (response.status === 412) {
      try {
        await read(url);
      } catch (error) {
        if (missing(error)) {
          invalidateSuite();
          return;
        }
        throw error;
      }
    }
    throw new HealthIoError(response.status, "delete diary entry");
  }
  const restore = (entry: DiaryEntry) => save(entry, "restore", undefined, entry.url);
  return { base, list, read, save, remove, restore, invalidate };
}
export type DiaryStore = ReturnType<typeof createDiaryStore>;

export interface DiaryPattern {
  symptomType: SymptomType;
  food: string;
  kind: "food" | "tag";
  followed: number;
  without: number;
  symptoms: number;
}
/** Descriptive co-occurrence only. Each meal counts once per food/tag and symptom type. */
export function diaryPatterns(
  entries: readonly DiaryEntry[],
  minHours = 2,
  maxHours = 48,
  observedUntil = new Date(),
): DiaryPattern[] {
  if (
    !Number.isFinite(minHours) ||
    !Number.isFinite(maxHours) ||
    minHours < 0 ||
    maxHours <= minHours ||
    maxHours > 168 ||
    !Number.isFinite(observedUntil.getTime())
  )
    throw new TypeError("Choose a window from 0 to 168 hours with the end after the start");
  const symptoms = entries.filter(
    (entry): entry is Extract<DiaryEntry, { kind: "symptom" }> =>
      entry.kind === "symptom" && entry.at <= observedUntil,
  );
  const types = [...new Set(symptoms.map((entry) => entry.symptomType))];
  const rows = new Map<string, DiaryPattern>();
  const seen = new Map<string, Set<string>>();
  for (const meal of entries) {
    if (meal.kind !== "meal" || meal.at.getTime() + maxHours * 3600000 > observedUntil.getTime())
      continue;
    for (const type of types) {
      const following = symptoms.filter(
        (symptom) =>
          symptom.symptomType === type &&
          symptom.at.getTime() - meal.at.getTime() >= minHours * 3600000 &&
          symptom.at.getTime() - meal.at.getTime() <= maxHours * 3600000,
      );
      for (const kind of ["food", "tag"] as const) {
        for (const food of new Set(
          (kind === "food" ? meal.foods : meal.tags)
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
        )) {
          const key = JSON.stringify([type, kind, food]);
          const row = rows.get(key) ?? {
            symptomType: type,
            food,
            kind,
            followed: 0,
            without: 0,
            symptoms: 0,
          };
          if (following.length) row.followed++;
          else row.without++;
          const distinct = seen.get(key) ?? new Set<string>();
          for (const symptom of following) distinct.add(symptom.url);
          seen.set(key, distinct);
          row.symptoms = distinct.size;
          rows.set(key, row);
        }
      }
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.followed - a.followed ||
      a.symptomType.localeCompare(b.symptomType) ||
      a.food.localeCompare(b.food) ||
      a.kind.localeCompare(b.kind),
  );
}

/** Preserve explicit meal-level observations while recalculating product-derived exposures. */
export const MANUAL_EXPOSURE_NOTE = "Manually logged exposure";
export function diaryExposures(
  items: FoodItemData[],
  exposures: readonly ExposureData[] = [],
): ExposureData[] {
  const result = new Map(deriveExposures(items).map((value) => [value.trigger, value]));
  const strength = { absent: 0, "possible-undeclared": 1, trace: 2, present: 3 };
  for (const exposure of exposures) {
    if (exposure.note !== MANUAL_EXPOSURE_NOTE) continue;
    const derived = result.get(exposure.trigger);
    if (!derived || strength[exposure.exposureLevel] >= strength[derived.exposureLevel])
      result.set(exposure.trigger, {
        trigger: exposure.trigger,
        exposureLevel: exposure.exposureLevel,
        note: MANUAL_EXPOSURE_NOTE,
      });
  }
  return [...result.values()];
}
/** Use the shared engine over both storage layouts; future events are excluded. */
export function likelyDiaryTriggers(entries: readonly DiaryEntry[], now = new Date()) {
  const meals: MealData[] = [],
    symptoms: SymptomData[] = [];
  for (const entry of entries) {
    if (entry.at > now) continue;
    if (entry.kind === "meal")
      meals.push({
        id: entry.url,
        startTime: entry.at,
        items: entry.items ?? entry.foods.map((name) => ({ name })),
        exposures: entry.exposures ?? deriveExposures(entry.items ?? []),
      });
    else
      symptoms.push({
        id: entry.url,
        onset: entry.at,
        symptomType: entry.symptomType,
        ...(entry.severity === null ? {} : { severity: entry.severity }),
      });
  }
  return rankSuspicions(correlate(meals, symptoms)).filter((score) => score.exposureCount > 0);
}
