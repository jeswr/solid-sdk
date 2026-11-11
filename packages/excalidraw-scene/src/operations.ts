// AUTHORED-BY Codex (GPT-6.1 Sol)
import { elementCentre, localBounds, rotatePoint } from "./geometry.js";
import { validateScene } from "./parse.js";
import {
  DEFAULT_STYLE,
  ELEMENT_TYPES,
  type ElementType,
  LIMITS,
  type Point,
  type Revision,
  type Scene,
  type SceneElement,
} from "./types.js";
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
const randomNonce = () => Math.floor(Math.random() * 2147483647);
export function createElement(
  type: ElementType,
  x: number,
  y: number,
  width = 1,
  height = 1,
  options: Partial<SceneElement> = {},
): SceneElement {
  const element: SceneElement = {
    type,
    id: newId(),
    x,
    y,
    width,
    height,
    angle: 0,
    ...DEFAULT_STYLE,
    fillStyle: "solid",
    strokeStyle: "solid",
    roughness: 0,
    seed: randomNonce(),
    version: 1,
    versionNonce: randomNonce(),
    updated: Date.now(),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    roundness: null,
    boundElements: null,
    link: null,
    locked: false,
    ...(type === "text"
      ? {
          text: "Text",
          originalText: "Text",
          fontSize: 24,
          fontFamily: 2,
          textAlign: "left",
          verticalAlign: "top",
          containerId: null,
          autoResize: true,
          lineHeight: 1.25,
        }
      : {}),
    ...(["line", "arrow", "freedraw"].includes(type)
      ? {
          points: [
            [0, 0],
            [width, height],
          ],
          lastCommittedPoint: null,
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: type === "arrow" ? "arrow" : null,
        }
      : {}),
    ...(type === "freedraw" ? { pressures: [], simulatePressure: true } : {}),
    ...(type === "image" ? { fileId: null, status: "saved", scale: [1, 1] } : {}),
    ...options,
  };
  validateScene({ type: "excalidraw", version: 2, elements: [element], appState: {}, files: {} });
  return element;
}
export const rectangle = (
  x: number,
  y: number,
  w: number,
  h: number,
  style?: Partial<SceneElement>,
) => createElement("rectangle", x, y, w, h, style);
export const ellipse = (
  x: number,
  y: number,
  w: number,
  h: number,
  style?: Partial<SceneElement>,
) => createElement("ellipse", x, y, w, h, style);
export const diamond = (
  x: number,
  y: number,
  w: number,
  h: number,
  style?: Partial<SceneElement>,
) => createElement("diamond", x, y, w, h, style);
export function linear(
  type: "line" | "arrow" | "freedraw",
  x: number,
  y: number,
  points: Point[],
  style?: Partial<SceneElement>,
) {
  if (!Array.isArray(points) || !points.length || points.length > LIMITS.points)
    throw new TypeError("Invalid path point count");
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  return createElement(
    type,
    x,
    y,
    Math.max(0, ...xs) - Math.min(0, ...xs),
    Math.max(0, ...ys) - Math.min(0, ...ys),
    {
      ...style,
      points: points.map((p) => [...p]),
      width: Math.max(0, ...xs) - Math.min(0, ...xs),
      height: Math.max(0, ...ys) - Math.min(0, ...ys),
    },
  );
}
export const line = (x: number, y: number, points: Point[], style?: Partial<SceneElement>) =>
  linear("line", x, y, points, style);
export const arrow = (x: number, y: number, points: Point[], style?: Partial<SceneElement>) =>
  linear("arrow", x, y, points, style);
export const freedraw = (x: number, y: number, points: Point[], style?: Partial<SceneElement>) =>
  linear("freedraw", x, y, points, style);
export function text(x: number, y: number, value: string, style: Partial<SceneElement> = {}) {
  const size = style.fontSize ?? 24;
  return createElement(
    "text",
    x,
    y,
    Math.max(1, ...value.split("\n").map((row) => row.length * size * 0.65)),
    Math.max(1, value.split("\n").length * size * 1.25),
    { ...style, text: value, originalText: value, fontSize: size },
  );
}
export const imageReference = (x: number, y: number, w: number, h: number, fileId: string) =>
  createElement("image", x, y, w, h, { fileId });
function changed(e: SceneElement, patch: Partial<SceneElement>, revision: Revision): SceneElement {
  return {
    ...e,
    ...patch,
    id: e.id,
    type: e.type,
    version: (e.version ?? 0) + 1,
    versionNonce: revision.nonce ?? randomNonce(),
    updated: revision.now ?? Date.now(),
  };
}
export function addElement(scene: Scene, element: SceneElement, revision: Revision = {}): Scene {
  if (scene.elements.length >= LIMITS.elements) throw new TypeError("Too many elements");
  const next = { ...scene, elements: [...scene.elements, element] };
  if (!revision.preview) validateScene(next);
  return next;
}
export function updateElements(
  scene: Scene,
  ids: readonly string[],
  patch: Partial<SceneElement> | ((e: SceneElement) => Partial<SceneElement>),
  revision: Revision = {},
): Scene {
  const selected = new Set(ids);
  const elements = scene.elements.map((e) =>
    selected.has(e.id) && !e.isDeleted
      ? changed(e, typeof patch === "function" ? patch(e) : patch, revision)
      : e,
  );
  const next = { ...scene, elements };
  if (!revision.preview) validateScene(next);
  return next;
}
export const deleteElements = (scene: Scene, ids: readonly string[], revision?: Revision) =>
  updateElements(scene, ids, { isDeleted: true }, revision);
export function moveElements(
  scene: Scene,
  ids: readonly string[],
  dx: number,
  dy: number,
  revision?: Revision,
) {
  return updateElements(scene, ids, (e) => ({ x: e.x + dx, y: e.y + dy }), revision);
}
export function resizeElement(
  scene: Scene,
  id: string,
  width: number,
  height: number,
  revision: Revision = {},
): Scene {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0)
    throw new TypeError("Invalid dimensions");
  return updateElements(
    scene,
    [id],
    (e) => ({
      width,
      height,
      ...(e.points
        ? {
            points: e.points.map(
              ([x, y]) =>
                [
                  e.width ? (x * width) / e.width : x,
                  e.height ? (y * height) / e.height : y,
                ] as Point,
            ),
          }
        : {}),
      ...(e.type === "text"
        ? {
            fontSize: Math.min(
              1000,
              Math.max(1, (e.fontSize ?? 24) * (e.height ? height / e.height : 1)),
            ),
          }
        : {}),
    }),
    revision,
  );
}
export function reorderElements(
  scene: Scene,
  ids: readonly string[],
  direction: "front" | "back",
  revision: Revision = {},
): Scene {
  const selected = new Set(ids);
  const rest = scene.elements.filter((e) => !selected.has(e.id));
  const chosen = scene.elements
    .filter((e) => selected.has(e.id))
    .map((e) => changed(e, { index: null }, revision));
  const next = {
    ...scene,
    elements: direction === "front" ? [...rest, ...chosen] : [...chosen, ...rest],
  };
  if (!revision.preview) validateScene(next);
  return next;
}
export function groupElements(
  scene: Scene,
  ids: readonly string[],
  groupId: string | null = newId(),
  revision?: Revision,
) {
  return updateElements(
    scene,
    ids,
    (e) => ({ groupIds: groupId === null ? [] : [...e.groupIds, groupId] }),
    revision,
  );
}
export function duplicateElements(
  scene: Scene,
  ids: readonly string[],
  offset = 24,
  revision: Revision = {},
  destination: Scene = scene,
): { scene: Scene; ids: string[] } {
  const chosen = scene.elements.filter((e) => ids.includes(e.id) && !e.isDeleted);
  if (destination.elements.length + chosen.length > LIMITS.elements)
    throw new TypeError("Too many elements");
  const mapping = new Map(chosen.map((e) => [e.id, newId()]));
  const groups = new Map(chosen.flatMap((e) => e.groupIds ?? []).map((g) => [g, newId()]));
  const copies = chosen.map((e) => {
    const copy = JSON.parse(JSON.stringify(e)) as SceneElement;
    if (!(ELEMENT_TYPES as readonly string[]).includes(e.type))
      return { ...copy, id: mapping.get(e.id) as string };
    for (const key of ["startBinding", "endBinding"]) {
      const binding = copy[key] as { elementId?: string } | null;
      if (binding)
        copy[key] = mapping.has(binding.elementId ?? "")
          ? { ...binding, elementId: mapping.get(binding.elementId as string) }
          : null;
    }
    copy.boundElements = Array.isArray(copy.boundElements)
      ? copy.boundElements
          .filter((b: { id: string }) => mapping.has(b.id))
          .map((b: { id: string }) => ({ ...b, id: mapping.get(b.id) }))
      : null;
    copy.containerId =
      typeof copy.containerId === "string" ? (mapping.get(copy.containerId) ?? null) : null;
    return {
      ...changed(
        copy,
        {
          x: e.x + offset,
          y: e.y + offset,
          groupIds: e.groupIds.map((g) => groups.get(g) as string),
          index: null,
        },
        revision,
      ),
      id: mapping.get(e.id) as string,
      seed: randomNonce(),
    };
  });
  const next = { ...destination, elements: [...destination.elements, ...copies] };
  if (!revision.preview) validateScene(next);
  return { scene: next, ids: copies.map((e) => e.id) };
}

/** Resize around the opposite rotated handle, using point bounds for linear elements. */
export function resizeFromHandle(
  scene: Scene,
  id: string,
  handle: string,
  point: Point,
  revision: Revision = {},
): Scene {
  const e = scene.elements.find((e) => e.id === id);
  if (!e) return scene;
  const b = localBounds(e),
    centre = elementCentre(e);
  const p = rotatePoint(point, centre, -e.angle);
  const anchor: Point = [
    e.x + b.x + (handle.includes("w") ? b.width : 0),
    e.y + b.y + (handle.includes("n") ? b.height : 0),
  ];
  const width = Math.abs(p[0] - anchor[0]),
    height = Math.abs(p[1] - anchor[1]);
  const scaled = resizeElement(scene, id, width, height, { ...revision, preview: true });
  const resized = scaled.elements.find((item) => item.id === id) as SceneElement;
  const rb = localBounds(resized);
  const nextCentre = rotatePoint([(p[0] + anchor[0]) / 2, (p[1] + anchor[1]) / 2], centre, e.angle);
  return updateElements(
    scaled,
    [id],
    { x: nextCentre[0] - rb.x - rb.width / 2, y: nextCentre[1] - rb.y - rb.height / 2 },
    revision,
  );
}
