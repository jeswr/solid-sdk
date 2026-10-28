// AUTHORED-BY Codex
export const deleteOutcomes = [
  200,
  204,
  404,
  410,
  201,
  202,
  205,
  302,
  400,
  401,
  403,
  408,
  409,
  412,
  429,
  500,
  501,
  502,
  503,
  504,
  507,
  599,
  "network",
  "aborted",
  "timed out",
] as const;
export type DeleteOutcome = (typeof deleteOutcomes)[number];
export const terminalDelete = (outcome: DeleteOutcome) =>
  outcome === 200 || outcome === 204 || outcome === 404 || outcome === 410;

export function unknownDelete(outcome: DeleteOutcome): Response {
  if (outcome === "network") throw new TypeError("Connection lost");
  if (outcome === "aborted") throw new DOMException("Aborted", "AbortError");
  if (outcome === "timed out") throw new DOMException("Timed out", "TimeoutError");
  return new Response(null, { status: outcome });
}
