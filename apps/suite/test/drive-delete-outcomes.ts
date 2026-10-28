// AUTHORED-BY Codex
export const deleteOutcomes = [
  200,
  204,
  404,
  410,
  201,
  202,
  203,
  205,
  206,
  207,
  208,
  226,
  299,
  302,
  304,
  399,
  400,
  401,
  402,
  403,
  405,
  407,
  408,
  409,
  411,
  412,
  415,
  418,
  422,
  423,
  428,
  429,
  451,
  499,
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
  typeof outcome === "number" &&
  ((outcome >= 200 && outcome <= 299 && outcome !== 202) || outcome === 404 || outcome === 410);
export const refusedDelete = (outcome: DeleteOutcome) =>
  typeof outcome === "number" &&
  outcome >= 400 &&
  outcome < 500 &&
  ![404, 408, 410, 429].includes(outcome);

export function unknownDelete(outcome: DeleteOutcome): Response {
  if (outcome === "network") throw new TypeError("Connection lost");
  if (outcome === "aborted") throw new DOMException("Aborted", "AbortError");
  if (outcome === "timed out") throw new DOMException("Timed out", "TimeoutError");
  return new Response(null, { status: outcome });
}
