// AUTHORED-BY Claude Opus 5.5
import type { TaskTrace } from "@jeswr/agent-browser";
import {
  type FinalAgentResponse,
  type ResultItem,
  STATUSES,
  type Status,
  type TaskType,
} from "./types.js";

export function responseInstructions(type: TaskType): string {
  return (
    `Benchmark final answer format for ${type}: finish with ANSWER: followed by one JSON object. ` +
    `Use {"status":"SUCCESS","retrieved_data":${type === "RETRIEVE" ? "[items]" : "null"},"error_details":null${type === "NAVIGATE" ? ',"final_url":"the observed page IRI"' : ""}}. ` +
    `For RETRIEVE, preserve numbers/booleans and object keys requested by the goal; do not wrap results in prose. ` +
    `For failures choose ${STATUSES.filter((s) => s !== "SUCCESS").join(", ")} and give error_details. ` +
    `Use only observed RDF facts. Never infer success from a failed or uncertain write.`
  );
}

export function errorResponse(
  type: TaskType,
  details: string,
  status: Status = "UNKNOWN_ERROR",
): FinalAgentResponse {
  return {
    task_type: type,
    status,
    retrieved_data: type === "RETRIEVE" ? [] : null,
    error_details: details,
  };
}

function resultItems(value: unknown): ResultItem[] {
  const values = Array.isArray(value) ? value : [value];
  if (values.some((v) => Array.isArray(v) || v === undefined))
    throw new Error("Nested result arrays are not public results.");
  if (values.some((v) => typeof v === "number" && !Number.isFinite(v)))
    throw new Error("Result numbers must be finite.");
  const kind = (v: unknown) => (v === null ? "null" : typeof v);
  if (new Set(values.map(kind)).size > 1)
    throw new Error("Retrieved items must have the same type.");
  if (values.some((v) => typeof v === "object" && v !== null)) {
    const keys = values.map((v) => JSON.stringify(Object.keys(v).sort()));
    if (new Set(keys).size > 1) throw new Error("Retrieved objects must have the same keys.");
  }
  return values;
}

function answerValue(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, "$1");
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export function finalPage(trace: TaskTrace): string | undefined {
  const value = answerValue(trace.text ?? "");
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "final_url" in value &&
    typeof value.final_url === "string"
  )
    return value.final_url;
  if (typeof value === "string" && /^https?:\/\/\S+$/.test(value)) return value;
  return undefined;
}

/** Task type comes from metadata; statuses and values come exclusively from the agent run. */
export function mapResponse(type: TaskType, trace: TaskTrace): FinalAgentResponse {
  if (trace.outcome !== "answer")
    return errorResponse(
      type,
      trace.outcome === "ask" ? "Agent requested clarification." : "Task step limit reached.",
    );
  const value = answerValue(trace.text ?? "");
  const envelope =
    value && typeof value === "object" && !Array.isArray(value) && "status" in value
      ? value
      : undefined;
  if (envelope && "task_type" in envelope && envelope.task_type !== type)
    return errorResponse(type, "Agent returned a different task type.", "DATA_VALIDATION_ERROR");
  const status = envelope ? String(envelope.status).toUpperCase() : "SUCCESS";
  if (!STATUSES.some((s) => s === status))
    return errorResponse(type, "Invalid final status.", "DATA_VALIDATION_ERROR");
  if (status !== "SUCCESS")
    return errorResponse(
      type,
      envelope && "error_details" in envelope && typeof envelope.error_details === "string"
        ? envelope.error_details
        : "Agent reported failure.",
      status as Status,
    );
  const lastAction = trace.steps.findLast((step) => step.kind === "act");
  if (type === "MUTATE" && lastAction && lastAction.status !== "done")
    return errorResponse(type, "Last action did not complete; success is unverified.");
  try {
    if (
      type === "RETRIEVE" &&
      envelope &&
      (!("retrieved_data" in envelope) || !Array.isArray(envelope.retrieved_data))
    )
      throw new Error("RETRIEVE envelope requires an array.");
    const data =
      type === "RETRIEVE"
        ? resultItems(envelope && "retrieved_data" in envelope ? envelope.retrieved_data : value)
        : null;
    if (!envelope && value === "") throw new Error("Empty answer.");
    return { task_type: type, status: "SUCCESS", retrieved_data: data, error_details: null };
  } catch {
    return errorResponse(
      type,
      "Invalid retrieved_data; expected homogeneous public result items.",
      "DATA_VALIDATION_ERROR",
    );
  }
}
