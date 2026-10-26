// AUTHORED-BY Codex GPT-6.1-Sol
import type { BoardViewState } from "./types";
import { BoardError, identifier, requireInput, uniqueStrings } from "./validation";

function record(
  value: unknown,
  allowed: readonly string[],
): asserts value is Record<string, unknown> {
  requireInput(
    value !== null &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype,
    "Expected a plain view-state object",
  );
  requireInput(
    Reflect.ownKeys(value).every((key) => typeof key === "string" && allowed.includes(key)),
    "Unknown view-state key",
  );
}

function validateState(value: unknown): BoardViewState {
  record(value, ["filter", "sort"]);
  requireInput(
    ["manual", "due", "priority", "name"].includes(value.sort as string),
    "Unknown task sort",
  );
  const filter = value.filter;
  record(filter, ["query", "statuses", "labels", "priorities", "project"]);
  const copy: {
    query?: string;
    statuses?: string[];
    labels?: string[];
    priorities?: (1 | 2 | 3 | 4)[];
    project?: string;
  } = {};
  if (Object.hasOwn(filter, "query")) {
    requireInput(typeof filter.query === "string", "Query must be text");
    copy.query = filter.query;
  }
  for (const key of ["statuses", "labels"] as const) {
    if (Object.hasOwn(filter, key)) {
      uniqueStrings(filter[key]);
      copy[key] = [...filter[key]];
    }
  }
  if (Object.hasOwn(filter, "priorities")) {
    const priorities = filter.priorities;
    requireInput(Array.isArray(priorities), "Priorities must be an array");
    requireInput(
      [...priorities].every((item) => [1, 2, 3, 4].includes(item)) &&
        new Set(priorities).size === priorities.length,
      "Priorities must be unique numbers from 1 to 4",
    );
    copy.priorities = [...priorities];
  }
  if (Object.hasOwn(filter, "project")) {
    identifier(filter.project);
    copy.project = filter.project;
  }
  return { filter: copy, sort: value.sort as BoardViewState["sort"] };
}

/** Canonical v1 percent-encoded JSON; safe as a URL segment or query parameter value. */
export function encodeViewState(state: BoardViewState): string {
  return `v1.${encodeURIComponent(JSON.stringify(validateState(state)))}`;
}

/**
 * Accept only strings produced by encodeViewState. This also rejects duplicate JSON members,
 * noncanonical escapes, unknown versions/keys and malformed URI/JSON without dropping data.
 */
export function decodeViewState(encoded: string): BoardViewState {
  try {
    requireInput(typeof encoded === "string" && encoded.startsWith("v1."), "Unknown state version");
    const state = validateState(JSON.parse(decodeURIComponent(encoded.slice(3))));
    requireInput(encodeViewState(state) === encoded, "Noncanonical view-state encoding");
    return state;
  } catch {
    throw new BoardError("invalid-state", "Invalid encoded board view state");
  }
}
