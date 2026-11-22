// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import {
  duplicateElements,
  ELEMENT_TYPES,
  LIMITS,
  type Scene,
  serializeScene,
  text,
  updateElements,
} from "@jeswr/excalidraw-scene";
export interface History {
  past: Scene[];
  present: Scene;
  future: Scene[];
  serialised?: string;
}
export function history(scene: Scene): History {
  return { past: [], present: scene, future: [], serialised: serializeScene(scene) };
}
export function commit(state: History, scene: Scene): History {
  if (state.present === scene) return state;
  const serialised = serializeScene(scene);
  if ((state.serialised ?? serializeScene(state.present)) === serialised) return state;
  return {
    past: [...state.past.slice(-49), state.present],
    present: scene,
    future: [],
    serialised,
  };
}
/** Undo restores content but revisions still advance, as required for Excalidraw reconciliation. */
function restored(current: Scene, target: Scene): Scene {
  const existing = new Map(current.elements.map((e) => [e.id, e]));
  const elements = target.elements.map((e) =>
    !(ELEMENT_TYPES as readonly string[]).includes(e.type)
      ? e
      : {
          ...e,
          version: Math.max(e.version, existing.get(e.id)?.version ?? 0) + 1,
          versionNonce: Math.floor(Math.random() * 2147483647),
          updated: Date.now(),
        },
  );
  for (const e of current.elements)
    if (!elements.some((t) => t.id === e.id))
      elements.push({
        ...e,
        isDeleted: true,
        version: e.version + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
        updated: Date.now(),
      });
  return { ...target, elements };
}
export function undo(state: History): History {
  const previous = state.past.at(-1);
  return previous
    ? {
        past: state.past.slice(0, -1),
        present: restored(state.present, previous),
        future: [state.present, ...state.future],
      }
    : state;
}
export function redo(state: History): History {
  const next = state.future[0];
  return next
    ? {
        past: [...state.past, state.present],
        present: restored(state.present, next),
        future: state.future.slice(1),
      }
    : state;
}
export function applyStyle(
  scene: Scene,
  ids: string[],
  patch: Parameters<typeof updateElements>[2],
) {
  return updateElements(scene, ids, patch);
}

/** Check the combined scene before duplication or React state updates. */
export function pasteScene(scene: Scene, copied: Scene): { scene: Scene; ids: string[] } {
  const selected = copied.elements.filter((e) => !e.isDeleted);
  if (scene.elements.length + selected.length > LIMITS.elements)
    throw new TypeError("Too many elements (maximum 5,000)");
  return duplicateElements(
    copied,
    selected.map((e) => e.id),
    24,
    { preview: true },
    { ...scene, files: { ...scene.files, ...copied.files } },
  );
}

/** Re-measure using the stored font, rather than the toolbar's creation defaults. */
export function editText(scene: Scene, id: string, value: string): Scene {
  const original = scene.elements.find((e) => e.id === id);
  if (!original) return scene;
  const replacement = text(original.x, original.y, value, { fontSize: original.fontSize ?? 24 });
  return updateElements(
    scene,
    [id],
    { text: value, originalText: value, width: replacement.width, height: replacement.height },
    { preview: true },
  );
}
