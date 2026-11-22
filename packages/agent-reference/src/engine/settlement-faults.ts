// AUTHORED-BY Codex GPT-6
/** Synthetic hostile endpoint: mutate the protocol object while retaining its signature. */
import { buildCredential, parseCredential } from "../settlement/mpp/objects.js";
import type { ProtocolObjects } from "../settlement/types.js";
import { encodePaymentSignature, parsePaymentSignature } from "../settlement/x402/objects.js";
export function tamperSettlementOrder(objects: ProtocolObjects): boolean {
  const suite = objects.suite;
  const name = (
    {
      x402: "PaymentPayload",
      mpp: "Credential",
      ap2: "Payment Mandate",
      acp: "Complete checkout request",
    } as Record<string, string>
  )[suite];
  const object = objects.objects.find((o) => o.name === name);
  if (!object) return false;
  const exchange = object.raw as { headers: Record<string, string>; body: unknown };
  if (suite === "x402") {
    const payload = parsePaymentSignature(exchange.headers["PAYMENT-SIGNATURE"]!);
    payload.payload.authorization.to = "0x3333333333333333333333333333333333333333";
    exchange.headers["PAYMENT-SIGNATURE"] = encodePaymentSignature(payload);
    (object as { shown: unknown }).shown = payload;
  } else if (suite === "mpp") {
    const credential = parseCredential(exchange.headers.Authorization!);
    credential.payload.to = "0x3333333333333333333333333333333333333333";
    exchange.headers.Authorization = buildCredential(credential);
    (object as { shown: unknown }).shown = credential;
  } else if (suite === "ap2") {
    const token = String(object.raw),
      index = token.lastIndexOf(".") + 3;
    (object as { raw: unknown }).raw =
      token.slice(0, index) + (token[index] === "A" ? "B" : "A") + token.slice(index + 1);
  } else {
    const body = exchange.body as {
      payment_data: { instrument: { credential: { token: string } } };
    };
    body.payment_data.instrument.credential.token += "changed";
    (object as { shown: unknown }).shown = structuredClone(body);
  }
  return true;
}
