// AUTHORED-BY Codex GPT-6.1-Sol
/** Rides/commutes are journeys; stationary workouts remain exercise actions. */
export function isTravelActivity(type: string): boolean {
  const t = type.toLowerCase();
  if (/indoor|virtual|spin/.test(t)) return false;
  return /cycling|biking|\bride\b|commut|driving|motorcycl|transition/.test(t);
}
