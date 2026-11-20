// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { addressSchema, authorizationSchema, signatureSchema, uint256Schema } from "../eip3009.js";
import { decodeJson, encodeJson, type HttpExchange } from "../http.js";
import { convertMoney, type Money, type UnitAmount } from "../money.js";

export const networkSchema = z.string().regex(/^eip155:[1-9]\d*$/);
export const paymentRequirementsSchema = z.strictObject({
  scheme: z.literal("exact"),
  network: networkSchema,
  amount: uint256Schema.refine((value) => /^\d+$/.test(value) && BigInt(value) > 0n),
  asset: addressSchema,
  payTo: addressSchema,
  maxTimeoutSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  extra: z.strictObject({ name: z.string().min(1), version: z.string().min(1) }),
});
const resourceSchema = z.strictObject({
  url: z.url(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});
const extensions = z.record(z.string(), z.json()).optional();
export const paymentRequiredSchema = z.strictObject({
  x402Version: z.literal(2),
  error: z.string().optional(),
  resource: resourceSchema,
  accepts: z.array(paymentRequirementsSchema).min(1).max(16),
  extensions,
});
export const paymentPayloadSchema = z.strictObject({
  x402Version: z.literal(2),
  resource: resourceSchema.optional(),
  accepted: paymentRequirementsSchema,
  payload: z.strictObject({ signature: signatureSchema, authorization: authorizationSchema }),
  extensions,
});
export const x402ErrorSchema = z.enum([
  "insufficient_funds",
  "invalid_exact_evm_payload_authorization_value_mismatch",
  "invalid_exact_evm_payload_recipient_mismatch",
  "invalid_payload",
  "invalid_scheme",
]);
export const verificationResponseSchema = z.discriminatedUnion("isValid", [
  z.strictObject({ isValid: z.literal(true), payer: addressSchema }),
  z.strictObject({
    isValid: z.literal(false),
    payer: addressSchema.optional(),
    invalidReason: x402ErrorSchema,
  }),
]);
export const settlementResponseSchema = z.discriminatedUnion("success", [
  z.strictObject({
    success: z.literal(true),
    payer: addressSchema,
    transaction: z.string().min(1),
    network: networkSchema,
  }),
  z.strictObject({
    success: z.literal(false),
    payer: addressSchema.optional(),
    transaction: z.literal(""),
    network: networkSchema,
    errorReason: x402ErrorSchema,
  }),
]);
export const facilitatorRequestSchema = z.strictObject({
  x402Version: z.literal(2),
  paymentPayload: paymentPayloadSchema,
  paymentRequirements: paymentRequirementsSchema,
});
export type PaymentRequirements = z.infer<typeof paymentRequirementsSchema>;
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;
export type PaymentPayload = z.infer<typeof paymentPayloadSchema>;
export type SettlementResponse = z.infer<typeof settlementResponseSchema>;
export type VerificationResponse = z.infer<typeof verificationResponseSchema>;
export type X402Error = z.infer<typeof x402ErrorSchema>;

export function encodePaymentRequired(value: PaymentRequired): string {
  return encodeJson(paymentRequiredSchema.parse(value), "base64");
}
export function parsePaymentRequired(value: string): PaymentRequired {
  return paymentRequiredSchema.parse(decodeJson(value, "base64"));
}
export function encodePaymentSignature(value: PaymentPayload): string {
  return encodeJson(paymentPayloadSchema.parse(value), "base64");
}
export function parsePaymentSignature(value: string): PaymentPayload {
  return paymentPayloadSchema.parse(decodeJson(value, "base64"));
}
export function encodePaymentResponse(value: SettlementResponse): string {
  return encodeJson(settlementResponseSchema.parse(value), "base64");
}
export function parsePaymentResponse(value: string): SettlementResponse {
  return settlementResponseSchema.parse(decodeJson(value, "base64"));
}

export function paymentRequiredExchange(
  method: string,
  path: string,
  value: PaymentRequired,
): HttpExchange {
  return {
    method,
    path,
    status: 402,
    headers: { "PAYMENT-REQUIRED": encodePaymentRequired(value) },
    body: null,
  };
}

export function convertX402Amount(value: Money, decimals: number): UnitAmount;
export function convertX402Amount(value: UnitAmount, decimals: number): Money;
export function convertX402Amount(value: Money | UnitAmount, decimals: number): Money | UnitAmount {
  return "amount" in value ? convertMoney(value, decimals) : convertMoney(value, decimals);
}
