// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { isAbsolute } from "path";
import { z } from "zod";

export const matrixIdentitySchema = z.strictObject({
  homeserver: z
    .string()
    .url()
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value;
    }),
  userId: z
    .string()
    .regex(/^@[^\s:]+:[^\s/]+$/)
    .max(255),
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/),
  cryptoStorePath: z.string().max(4096).refine(isAbsolute),
});
export type MatrixDeviceIdentity = z.infer<typeof matrixIdentitySchema>;
export const matrixDeviceSchema = matrixIdentitySchema.extend({
  version: z.literal(1),
  account: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  purpose: z.enum(["read", "send"]),
  accessToken: z.string().regex(/^[\x21-\x7e]{8,8192}$/),
});
export type MatrixDevice = z.infer<typeof matrixDeviceSchema>;
