// AUTHORED-BY Codex GPT-6.1-Sol
export interface WorkBudget {
  remaining: number;
}
export type Edit = "equal" | "insert" | "delete";

export function spend(budget: WorkBudget, amount = 1): void {
  budget.remaining -= amount;
  if (budget.remaining < 0) throw new RangeError("Document diff work limit exceeded");
}

/** Myers O((N+M)D), with a shared work bound also bounding the O(D²) backtrack trace. */
export function myers(
  before: readonly string[],
  after: readonly string[],
  budget: WorkBudget,
): Edit[] {
  if (before.length === 0) {
    spend(budget, after.length);
    return after.map(() => "insert");
  }
  if (after.length === 0) {
    spend(budget, before.length);
    return before.map(() => "delete");
  }
  const trace: Map<number, number>[] = [];
  let frontier = new Map<number, number>([[1, 0]]);
  for (let depth = 0; ; depth++) {
    trace.push(frontier);
    const next = new Map<number, number>();
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      spend(budget);
      const down = frontier.get(diagonal + 1) ?? 0;
      const right = frontier.get(diagonal - 1) ?? 0;
      let x = diagonal === -depth || (diagonal !== depth && right < down) ? down : right + 1;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        spend(budget);
        x++;
        y++;
      }
      next.set(diagonal, x);
      if (x >= before.length && y >= after.length) {
        return backtrack(trace, before.length, after.length);
      }
    }
    frontier = next;
  }
}

function backtrack(trace: Map<number, number>[], x: number, y: number): Edit[] {
  const edits: Edit[] = [];
  for (let depth = trace.length - 1; depth >= 0; depth--) {
    const frontier = trace[depth] as Map<number, number>;
    const diagonal = x - y;
    const down = frontier.get(diagonal + 1) ?? 0;
    const right = frontier.get(diagonal - 1) ?? 0;
    const previousDiagonal =
      diagonal === -depth || (diagonal !== depth && right < down) ? diagonal + 1 : diagonal - 1;
    // The chosen predecessor was visited at the previous depth (or is the depth-zero seed).
    const previousX = frontier.get(previousDiagonal) as number;
    const previousY = previousX - previousDiagonal;
    while (x > previousX && y > previousY) {
      edits.push("equal");
      x--;
      y--;
    }
    if (depth > 0) {
      if (x === previousX) {
        edits.push("insert");
        y--;
      } else {
        edits.push("delete");
        x--;
      }
    }
  }
  return edits.reverse();
}
