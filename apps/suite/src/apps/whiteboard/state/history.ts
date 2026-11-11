// AUTHORED-BY Codex (GPT-6.1 Sol)
import { ELEMENT_TYPES, type Scene, serializeScene, updateElements } from "@jeswr/excalidraw-scene";
export interface History {
  past: Scene[];
  present: Scene;
  future: Scene[];
}
export function history(scene: Scene): History {
  return { past: [], present: scene, future: [] };
}
export function commit(state: History, scene: Scene): History {
  if (serializeScene(state.present) === serializeScene(scene)) return state;
  return { past: [...state.past.slice(-49), state.present], present: scene, future: [] };
}
/** Undo restores content but revisions still advance, as required for Excalidraw reconciliation. */
function restored(current: Scene, target: Scene): Scene {
  const existing = new Map(current.elements.map((e) => [e.id, e]));
  const elements = target.elements.map((e) =>
    !(ELEMENT_TYPES as readonly string[]).includes(e.type)
      ? e
      : {
          ...e,
          version: Math.max(e.version ?? 0, existing.get(e.id)?.version ?? 0) + 1,
          versionNonce: Math.floor(Math.random() * 2147483647),
          updated: Date.now(),
        },
  );
  for (const e of current.elements)
    if (!elements.some((t) => t.id === e.id))
      elements.push({
        ...e,
        isDeleted: true,
        version: (e.version ?? 0) + 1,
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
