// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { isColour } from "./parse.js";
import { type Bounds, ELEMENT_TYPES, type Point, type Scene, type SceneElement } from "./types.js";
export function isRenderable(e: SceneElement): boolean {
  return (
    !e.isDeleted &&
    e.type !== "image" &&
    (ELEMENT_TYPES as readonly string[]).includes(e.type) &&
    isColour(e.strokeColor) &&
    isColour(e.backgroundColor)
  );
}
export function rotatePoint([x, y]: Point, [cx, cy]: Point, angle: number): Point {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
}
/** Unrotated bounds relative to the element origin, including negative path points. */
export function localBounds(e: SceneElement): Bounds {
  if (!e.points?.length) return { x: 0, y: 0, width: e.width, height: e.height };
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const [px, py] of e.points) {
    x = Math.min(x, px);
    y = Math.min(y, py);
    right = Math.max(right, px);
    bottom = Math.max(bottom, py);
  }
  return { x, y, width: right - x, height: bottom - y };
}
export function elementCentre(e: SceneElement): Point {
  const b = localBounds(e);
  return [e.x + b.x + b.width / 2, e.y + b.y + b.height / 2];
}
export function resizeHandle(e: SceneElement, handle: string): Point {
  const b = localBounds(e);
  return rotatePoint(
    [
      e.x + b.x + (handle.includes("w") ? 0 : b.width),
      e.y + b.y + (handle.includes("n") ? 0 : b.height),
    ],
    elementCentre(e),
    e.angle,
  );
}
export function elementBounds(e: SceneElement): Bounds {
  if (!(ELEMENT_TYPES as readonly string[]).includes(e.type))
    return { x: 0, y: 0, width: 0, height: 0 };
  const centre = elementCentre(e);
  const points: readonly Point[] = e.points?.length
    ? e.points
    : [
        [0, 0],
        [e.width, 0],
        [0, e.height],
        [e.width, e.height],
      ];
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const [px, py] of points) {
    const [rx, ry] = rotatePoint([e.x + px, e.y + py], centre, e.angle);
    x = Math.min(x, rx);
    y = Math.min(y, ry);
    right = Math.max(right, rx);
    bottom = Math.max(bottom, ry);
  }
  return { x, y, width: right - x, height: bottom - y };
}
export function sceneBounds(scene: Scene, ids?: readonly string[]): Bounds {
  const elements = scene.elements.filter((e) => isRenderable(e) && (!ids || ids.includes(e.id)));
  if (!elements.length) return { x: 0, y: 0, width: 1, height: 1 };
  const boxes = elements.map(elementBounds);
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}
export function elementsInBox(scene: Scene, box: Bounds): string[] {
  return scene.elements
    .filter((e) => {
      if (!isRenderable(e)) return false;
      const b = elementBounds(e);
      return (
        b.x >= box.x &&
        b.y >= box.y &&
        b.x + b.width <= box.x + box.width &&
        b.y + b.height <= box.y + box.height
      );
    })
    .map((e) => e.id);
}
function distanceToSegment([x, y]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const length = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = length
    ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length))
    : 0;
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}
export function hitTest(e: SceneElement, point: Point, tolerance = 6): boolean {
  if (!isRenderable(e)) return false;
  const p = rotatePoint(point, elementCentre(e), -e.angle);
  const x = p[0] - e.x,
    y = p[1] - e.y;
  const t = Math.max(0, tolerance) + e.strokeWidth / 2;
  if (e.points)
    return e.points.some(
      (v, i, all) => distanceToSegment([x, y], all[Math.max(0, i - 1)] as Point, v) <= t,
    );
  if (x < -t || y < -t || x > e.width + t || y > e.height + t) return false;
  if (e.type === "text") return true;
  const rx = Math.max(e.width / 2, 0.001),
    ry = Math.max(e.height / 2, 0.001);
  if (e.type === "ellipse") {
    const norm = Math.hypot((x - rx) / rx, (y - ry) / ry);
    return (
      norm <= 1 + t / Math.min(rx, ry) &&
      (e.backgroundColor !== "transparent" || norm >= 1 - t / Math.min(rx, ry))
    );
  }
  if (e.type === "diamond") {
    const norm = Math.abs(x - rx) / rx + Math.abs(y - ry) / ry;
    return (
      norm <= 1 + t / Math.min(rx, ry) &&
      (e.backgroundColor !== "transparent" || norm >= 1 - t / Math.min(rx, ry))
    );
  }
  return (
    e.backgroundColor !== "transparent" ||
    Math.min(Math.abs(x), Math.abs(y), Math.abs(x - e.width), Math.abs(y - e.height)) <= t
  );
}
export function hitElement(scene: Scene, point: Point, tolerance = 6): SceneElement | undefined {
  return [...scene.elements].reverse().find((e) => hitTest(e, point, tolerance));
}
