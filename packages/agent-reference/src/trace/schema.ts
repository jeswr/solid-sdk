// AUTHORED-BY Codex GPT-6
/** Trace contract; legacy hostile-input inspector entries remain readable. */
import { z } from "zod";
import { PACKET_LAYERS, TRACE_SCHEMA } from "./types.js";

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
export const traceFileSchema = z
  .object({
    schema: z.literal(TRACE_SCHEMA),
    events: z.array(z.object({ packet: packetViewSchema.optional() }).passthrough()),
  })
  .passthrough();
