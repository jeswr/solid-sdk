// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Bounds, Point } from "@jeswr/excalidraw-scene";
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}
export const INITIAL_VIEW: Viewport = { x: 80, y: 80, zoom: 1 };
export function canvasPoint(view: Viewport, x: number, y: number): Point {
  return [(x - view.x) / view.zoom, (y - view.y) / view.zoom];
}
export function zoomAt(view: Viewport, factor: number, point: Point): Viewport {
  const zoom = Math.min(8, Math.max(0.1, view.zoom * factor));
  const p = canvasPoint(view, point[0], point[1]);
  return { zoom, x: point[0] - p[0] * zoom, y: point[1] - p[1] * zoom };
}
export function dragBox(a: Point, b: Point): Bounds {
  return {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    width: Math.abs(a[0] - b[0]),
    height: Math.abs(a[1] - b[1]),
  };
}
