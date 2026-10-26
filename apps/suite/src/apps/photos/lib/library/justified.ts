// AUTHORED-BY Codex GPT-6.1-Sol

export interface JustifiedOptions {
  targetRowHeight: number;
  /** Horizontal and vertical spacing in the same units as width; defaults to zero. */
  gap?: number;
}

export interface LayoutItem {
  /** Index into the input aspect ratios; order is preserved. */
  index: number;
  left: number;
  width: number;
}

export interface LayoutRow {
  top: number;
  height: number;
  justified: boolean;
  items: LayoutItem[];
}

export interface JustifiedLayout {
  width: number;
  height: number;
  rows: LayoutRow[];
}

function assertPositive(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("Layout dimensions and aspect ratios must be finite and positive");
  }
}

/**
 * Greedy, O(n) layout using display-oriented width/height ratios. Close a row
 * when its width at the target height reaches the container. Completed rows
 * fill the width; the trailing row is left aligned and never enlarged above
 * the target. A gap too wide for another item forces a row break. Coordinates
 * are fractional, without cropping, padding or trailing vertical gap.
 */
export function layoutJustifiedRows(
  aspectRatios: readonly number[],
  width: number,
  { targetRowHeight, gap = 0 }: JustifiedOptions,
): JustifiedLayout {
  assertPositive(width);
  assertPositive(targetRowHeight);
  if (!Number.isFinite(gap) || gap < 0) throw new RangeError("Gap must be finite and non-negative");
  for (const ratio of aspectRatios) assertPositive(ratio);

  const rows: LayoutRow[] = [];
  let pending: { index: number; ratio: number }[] = [];
  let sum = 0;
  let totalHeight = 0;
  const emitRow = (justified: boolean) => {
    const fittedHeight = (width - gap * (pending.length - 1)) / sum;
    const height = justified ? fittedHeight : Math.min(targetRowHeight, fittedHeight);
    assertPositive(height);
    const top = rows.length === 0 ? 0 : totalHeight + gap;
    let left = 0;
    const items = pending.map(({ index, ratio }) => {
      const itemWidth = height * ratio;
      assertPositive(itemWidth);
      const item = { index, left, width: itemWidth };
      left += itemWidth + gap;
      return item;
    });
    totalHeight = top + height;
    assertPositive(totalHeight);
    rows.push({ top, height, justified, items });
    pending = [];
    sum = 0;
  };

  for (const [index, ratio] of aspectRatios.entries()) {
    if (pending.length > 0 && width - gap * pending.length <= 0) emitRow(true);
    pending.push({ index, ratio });
    sum += ratio;
    if (sum * targetRowHeight + gap * (pending.length - 1) >= width) emitRow(true);
  }
  if (pending.length > 0) emitRow(false);
  return { width, height: totalHeight, rows };
}
