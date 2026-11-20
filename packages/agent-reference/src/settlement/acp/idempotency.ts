// AUTHORED-BY Codex GPT-6
import { z } from "zod";
import { digestOf } from "../../core/canonical.js";
import { AcpError } from "./errors.js";

interface RecordState<T> {
  digest: string;
  state: "in-flight" | "complete";
  response?: T;
}
export class IdempotencyStore<T> {
  private readonly records = new Map<string, RecordState<T>>();

  /** One store per endpoint scope. A response is copied before caching and returning. */
  async execute(key: string | undefined, body: unknown, action: () => T | Promise<T>): Promise<T> {
    if (!key) throw new AcpError("idempotency_key_required", 400);
    const digest = digestOf(z.json().parse(body));
    const existing = this.records.get(key);
    if (existing) {
      if (existing.digest !== digest) throw new AcpError("idempotency_conflict", 422);
      if (existing.state === "in-flight") throw new AcpError("idempotency_in_flight", 409);
      return structuredClone(existing.response as T);
    }
    const record: RecordState<T> = { digest, state: "in-flight" };
    this.records.set(key, record);
    try {
      const response = structuredClone(await action());
      record.response = response;
      record.state = "complete";
      return structuredClone(response);
    } catch (error) {
      this.records.delete(key);
      throw error;
    }
  }
}
