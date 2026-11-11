// AUTHORED-BY Codex (GPT-6.1 Sol)
export const ELEMENT_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "freedraw",
  "text",
  "image",
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];
export type Point = readonly [number, number];
/** Unknown keys and future element types survive editing and export. */
export interface SceneElement {
  [key: string]: unknown;
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  strokeWidth: number;
  opacity: number;
  version: number;
  versionNonce: number;
  updated: number;
  isDeleted: boolean;
  groupIds: string[];
  points?: Point[];
  text?: string;
  fontSize?: number;
  fileId?: string | null;
}
export interface Scene {
  [key: string]: unknown;
  type: "excalidraw";
  version: 2;
  elements: SceneElement[];
  appState: { [key: string]: unknown; viewBackgroundColor?: string };
  files: Record<string, unknown>;
}
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Revision {
  /** App-owned previews must be validated at commit, before persistence. */
  preview?: boolean;
  now?: number;
  nonce?: number;
}
export const LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  elements: 5000,
  depth: 32,
  nodes: 250000,
  coordinate: 10000000,
  points: 20000,
});
/** Portable scene colours. UI controls resolve suite tokens before passing colours to constructors. */
export const DEFAULT_STYLE = Object.freeze({
  strokeColor: "#202124",
  backgroundColor: "transparent",
  strokeWidth: 2,
  opacity: 100,
});
