// AUTHORED-BY Codex GPT-6.1-Sol
import {
  buildObservationDay,
  buildRoom,
  buildSensor,
  type DayObservation,
  DEFAULT_MAX_OBSERVATIONS,
  observationDocPath,
  PROPERTY,
  PROPERTY_UNITS,
  parseObservations,
  RDF_TYPE,
  SOSA_OBSERVATION,
  sensorDocPath,
} from "@jeswr/solid-environment";
import { Store, Writer } from "n3";
import { RunBudget, readJson } from "../core/budget.js";
import { IntegrationSyncError } from "../core/errors.js";
import { mergeItems } from "../core/incremental.js";
import type { IntegrationAdapter } from "../core/types.js";
import {
  BYPASS,
  DETAIL,
  DEVICES,
  MAX_DEVICES,
  MAX_RESPONSE_BYTES,
  MAX_RUN_OBSERVATIONS,
  REQUEST_TIMEOUT_MS,
  record,
  text,
  VESYNC_API,
} from "./api.js";
import { VeSyncAuthError } from "./errors.js";
import { VESYNC_FIXTURES } from "./fixtures.js";
import { ENVIRONMENT_CLASSES, vocabMap } from "./vocab-map.js";

export interface VeSyncOptions {
  /** One label for all devices, or labels keyed by the hashed sensor slug. */
  readonly room?: string | Readonly<Record<string, string>>;
  readonly now?: () => Date;
}
/** Hash opaque device identifiers; never use cid, uuid or MAC in a pod IRI. */
export async function sensorSlug(id: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return `vesync-${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function supported(model: string): boolean {
  return /^(?:Core(?:200|300|400|600)S|LAP-(?:C|V)[A-Z0-9-]{1,64}|Vital ?(?:100|200)S|LV-PUR131S)$/i.test(
    model,
  );
}
/** Only finite numeric readings are meaningful; never coerce labels, booleans or numeric strings. */
export function measurements(status: Record<string, unknown>, legacy: boolean) {
  const result: {
    key: string;
    property: (typeof PROPERTY)[keyof typeof PROPERTY];
    value: number;
  }[] = [];
  for (const [key, property, value, max] of [
    ["pm25", PROPERTY.PM2_5MassConcentration, status.air_quality_value, 100000],
    ["aqi", PROPERTY.AirQualityIndex, legacy ? status.airQuality : status.air_quality, 100000],
    [
      "fan",
      PROPERTY.FanSpeedLevel,
      legacy ? status.level : (status.fan_speed_level ?? status.fan_level),
      100,
    ],
    ["filter", PROPERTY.FilterLifeRemaining, legacy ? status.filterLife : status.filter_life, 100],
  ] as const) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max)
      result.push({ key, property, value });
  }
  return result;
}
export function createVeSyncAdapter(options: VeSyncOptions = {}): IntegrationAdapter {
  return {
    vocabMap,
    maxRunActivities: 32,
    metadata: {
      id: "vesync",
      name: "Levoit (VeSync)",
      tier: "B",
      authKind: "account-cli",
      cliOnly: true,
      scopes: [],
      categories: ["environment"],
      whatYouGet: "Air quality and numeric purifier readings from your Levoit purifiers.",
      requirements: [
        "CLI only: run pod-connectors import vesync (or add --watch 10). Enter your VeSync account at the hidden prompt, or supply VESYNC_EMAIL / VESYNC_PASSWORD. Uses the unofficial VeSync cloud API; browser access is unavailable.",
      ],
    },
    fixtures: () => VESYNC_FIXTURES,
    async import(ctx) {
      const budget = new RunBudget("vesync", {
        maxRequests: MAX_DEVICES + 1,
        maxItems: MAX_DEVICES,
        maxBytes: 8 * MAX_RESPONSE_BYTES,
      });
      const post = async (path: string, body: object) => {
        budget.request();
        const signal = AbortSignal.any([
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          ...(ctx.signal ? [ctx.signal] : []),
        ]);
        // Timeout spans both headers and body, including injected transports.
        let abort!: () => void;
        const aborted = new Promise<never>((_, reject) => {
          abort = () =>
            reject(new IntegrationSyncError("vesync", "VeSync request cancelled or timed out."));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        });
        try {
          return await Promise.race([
            (async () => {
              signal.throwIfAborted();
              const response = await ctx.api(VESYNC_API + path, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
                redirect: "error",
                signal,
              });
              if (!response.ok) {
                void response.body?.cancel().catch(() => {});
                throw new Error();
              }
              const value = record(
                await readJson(
                  response,
                  "vesync",
                  VESYNC_API + path,
                  MAX_RESPONSE_BYTES,
                  budget,
                  signal,
                ),
              );
              if (value.code !== 0) throw new Error();
              return record(value.result);
            })(),
            aborted,
          ]);
        } catch (error) {
          if (error instanceof VeSyncAuthError) throw error;
          // Source transport errors may contain credentials or provider-controlled strings.
          throw new IntegrationSyncError("vesync", "VeSync reading failed.");
        } finally {
          signal.removeEventListener("abort", abort);
        }
      };
      const answer = await post(DEVICES, { pageNo: 1, pageSize: MAX_DEVICES });
      if (
        !Array.isArray(answer.list) ||
        answer.list.length > MAX_DEVICES ||
        (answer.total !== undefined &&
          (typeof answer.total !== "number" ||
            !Number.isSafeInteger(answer.total) ||
            answer.total < answer.list.length ||
            answer.total > MAX_DEVICES))
      )
        throw new IntegrationSyncError(
          "vesync",
          "VeSync device list is invalid or exceeds the device cap.",
        );
      budget.items(answer.list.length);
      let skipped = 0,
        observations = 0;
      const seen = new Set<string>();
      for (const value of answer.list) {
        ctx.signal?.throwIfAborted();
        const device = record(value);
        const id = text(device.cid) ?? text(device.uuid);
        const model = text(device.deviceType);
        const label = text(device.deviceName);
        if (!id || !model || !label || !supported(model) || seen.has(id)) {
          skipped++;
          continue;
        }
        seen.add(id);
        const legacy = model.toUpperCase() === "LV-PUR131S";
        const status = await post(
          legacy ? DETAIL : BYPASS,
          legacy
            ? { cid: id }
            : {
                cid: id,
                ...(text(device.uuid) ? { uuid: device.uuid } : {}),
                configModule: text(device.configModule) ?? "WiFi",
                deviceRegion: text(device.deviceRegion) ?? "US",
                payload: { method: "getPurifierStatus", source: "APP", data: {} },
              },
        );
        const readings = measurements(legacy ? status : record(status.result), legacy);
        if (observations + readings.length > MAX_RUN_OBSERVATIONS)
          throw new IntegrationSyncError("vesync", "VeSync observation budget exceeded.");
        observations += readings.length;
        const now = options.now?.() ?? new Date();
        // Minute identity makes repeats idempotent; time and partition are both UTC.
        const resultTime = new Date(Math.floor(now.getTime() / 60000) * 60000).toISOString();
        const day = resultTime.slice(0, 10),
          minute = resultTime.slice(11, 16).replace(":", "");
        const slug = await sensorSlug(id);
        const sensorPath = sensorDocPath(slug),
          sensor = `${ctx.resolve(sensorPath)}#sensor`;
        const roomPath = `environment/${slug}/room.ttl`,
          room = `${ctx.resolve(roomPath)}#room`;
        const roomLabel =
          typeof options.room === "string" ? options.room : (options.room?.[slug] ?? label);
        if (!text(roomLabel)) throw new IntegrationSyncError("vesync", "Invalid room label.");
        await ctx.write({
          requirePrecondition: true,
          slug: sensorPath,
          category: "environment",
          forClass: ENVIRONMENT_CLASSES.Sensor,
          registrationContainer: "environment/",
          dataset: buildSensor(sensor, { label, manufacturer: "Levoit", model }),
        });
        await ctx.write({
          requirePrecondition: true,
          slug: roomPath,
          category: "environment",
          forClass: ENVIRONMENT_CLASSES.FeatureOfInterest,
          registrationContainer: "environment/",
          dataset: buildRoom(room, { label: roomLabel }),
        });
        // Metadata remains useful when a model omits every numeric reading.
        if (!readings.length) {
          skipped++;
          continue;
        }
        const path = observationDocPath(slug, day),
          url = ctx.resolve(path);
        const previous = await ctx.read(path);
        let stored = new Store();
        if (previous) {
          try {
            parseObservations(url, previous); // Applies model's root/quad budgets before merging.
            stored = new Store([...previous]);
          } catch {
            ctx.progress({ label: "VeSync day document exceeds limits; skipped.", done: 0 });
            skipped += readings.length;
            continue;
          }
        }
        const entries: DayObservation[] = readings.map(({ key, property, value }) => ({
          id: `${key}-${minute}`,
          property,
          value,
          unit: PROPERTY_UNITS[property],
          resultTime,
          featureOfInterest: key === "fan" || key === "filter" ? sensor : room,
        }));
        const incoming = buildObservationDay(url, sensor, day, entries);
        const roots = stored.getSubjects(RDF_TYPE, SOSA_OBSERVATION, null).length;
        const added = entries.filter(
          ({ id }) =>
            !stored.countQuads(`${url}#observation-${id}`, RDF_TYPE, SOSA_OBSERVATION, null),
        ).length;
        // Include shared session provenance overhead (2 triples per local subject).
        if (
          roots + added > DEFAULT_MAX_OBSERVATIONS ||
          stored.size + incoming.size + entries.length * 4 + 4 > 50000
        ) {
          ctx.progress({ label: "VeSync day document cap reached; skipped.", done: 0 });
          skipped += readings.length;
          continue;
        }
        // Reserve bounded room for the import session's document/item provenance.
        const encoder = new TextEncoder();
        const iriBytes =
          encoder.encode(url).byteLength +
          encoder.encode(ctx.resolve("_provenance.ttl")).byteLength +
          128;
        const byteLimit =
          8 * 1024 * 1024 - 64 * 1024 - (entries.length * 2 + 1) * (iriBytes * 4 + 1024);
        // Match PodWriter's unprefixed N3 serialization, rather than a compact model serializer.
        const turtle = await new Promise<string>((resolve, reject) => {
          const writer = new Writer({ format: "text/turtle" });
          for (const quad of mergeItems(stored, incoming)) writer.addQuad(quad);
          writer.end((error, body) => (error ? reject(error) : resolve(body)));
        });
        if (turtle.length > byteLimit || encoder.encode(turtle).byteLength > byteLimit) {
          ctx.progress({ label: "VeSync day document byte cap reached; skipped.", done: 0 });
          skipped += readings.length;
          continue;
        }
        // Merge mode replaces deterministic incoming roots/results while carrying earlier minutes.
        await ctx.write({
          requirePrecondition: true,
          slug: path,
          category: "environment",
          forClass: SOSA_OBSERVATION,
          registrationContainer: "environment/",
          dataset: incoming,
          writeMode: "merge",
        });
      }
      return { skipped };
    },
  };
}
export const vesyncAdapter = createVeSyncAdapter();
