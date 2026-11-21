// AUTHORED-BY Codex GPT-6
/** Trace contract; legacy hostile-input inspector entries remain readable. */
import { z } from "zod";
import { LINKED_KINDS, PACKET_LAYERS, TRACE_SCHEMA } from "./types.js";

const layer = z.object({
  present: z.boolean(),
  summary: z.string(),
  raw: z.unknown().optional(),
  digest: z.string().optional(),
  untrusted: z.array(z.object({ path: z.string(), text: z.string() })).optional(),
});
const fields = {
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: z.string(),
  carriage: z.object({ suite: z.string(), summary: z.string() }),
  layers: z.object(
    Object.fromEntries(PACKET_LAYERS.map((name) => [name, layer])) as Record<
      (typeof PACKET_LAYERS)[number],
      typeof layer
    >,
  ),
};
export const documentPacketSchema = z
  .object({
    ...fields,
    jsonld: z.string().min(1),
    context: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    rdf: z.string().min(1),
    attachments: z.array(
      z
        .object({
          digest: z.string().regex(/^sha-256:[a-f0-9]{64}$/),
          mediaType: z.string().min(1),
          byteLength: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
export const packetViewSchema = z.union([documentPacketSchema, z.object(fields).strict()]);
const linkedKey = z.string().regex(/^sha-256:[a-f0-9]{64}$/);
const linkedView = z.strictObject({
  what: z.enum(LINKED_KINDS),
  context: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  jsonld: z.string().min(1),
  turtle: z.string().min(1),
});
export const traceLinkedTableSchema = z.record(linkedKey, linkedView);
export const traceFileShapeSchema = z
  .object({
    schema: z.literal(TRACE_SCHEMA),
    events: z.array(
      z
        .object({ packet: packetViewSchema.optional(), linked: z.array(linkedKey).optional() })
        .passthrough(),
    ),
    linked: traceLinkedTableSchema.optional(),
    linkedTable: z
      .string()
      .regex(/^linked\/[a-zA-Z0-9_-]+\.json$/)
      .optional(),
  })
  .passthrough();

/** Validate references with the caller's table lookup. The schema does no I/O. */
export function traceFileSchemaWithLinkedTable(resolve?: (reference: string) => unknown) {
  return traceFileShapeSchema.superRefine((trace, ctx) => {
    let table = trace.linked;
    if (trace.linkedTable !== undefined) {
      const resolved = traceLinkedTableSchema.safeParse(resolve?.(trace.linkedTable));
      if (table !== undefined || !resolved.success) {
        ctx.addIssue({
          code: "custom",
          path: ["linkedTable"],
          message:
            table !== undefined
              ? "Trace has both linked tables"
              : "Invalid or unavailable linked table",
        });
        return;
      }
      table = resolved.data;
    }
    for (const [eventIndex, event] of trace.events.entries()) {
      event.linked?.forEach((key, keyIndex) => {
        if (!table || !Object.hasOwn(table, key))
          ctx.addIssue({
            code: "custom",
            path: ["events", eventIndex, "linked", keyIndex],
            message: "Missing linked view",
          });
      });
    }
  });
}

export const traceFileSchema = traceFileSchemaWithLinkedTable();
