// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  addElement,
  createElement,
  deleteElements,
  duplicateElements,
  type ElementType,
  elementsInBox,
  groupElements,
  hitElement,
  isColour,
  isRenderable,
  linear,
  moveElements,
  type Point,
  reorderElements,
  resizeElement,
  type Scene,
  type SceneElement,
  sceneBounds,
  sceneToSvg,
  sceneToSvgContent,
  serializeScene,
  text,
  updateElements,
} from "@jeswr/excalidraw-scene";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  IconButton,
  Textarea,
  toast,
} from "@jeswr/suite-ui";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Circle,
  Copy,
  Diamond,
  Eraser,
  Group,
  Hand,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  Ungroup,
} from "lucide-react";
import { type PointerEvent, useEffect, useRef, useState } from "react";
import { downloadBoard, scenePng } from "../lib/export";
import type { Board, BoardAccess } from "../lib/repository";
import { canvasPoint, dragBox, INITIAL_VIEW, type Viewport, zoomAt } from "../lib/viewport";
import { BoardAutosave, type SaveState } from "../state/autosave";
import { commit, history, redo, undo } from "../state/history";

type Tool = "select" | "hand" | "eraser" | Exclude<ElementType, "image">;
const TOOLS = [
  { id: "select", label: "Select", key: "V", icon: MousePointer2 },
  { id: "hand", label: "Hand", key: "H", icon: Hand },
  { id: "rectangle", label: "Rectangle", key: "R", icon: Square },
  { id: "ellipse", label: "Ellipse", key: "O", icon: Circle },
  { id: "diamond", label: "Diamond", key: "D", icon: Diamond },
  { id: "arrow", label: "Arrow", key: "A", icon: ArrowRight },
  { id: "line", label: "Line", key: "L", icon: Minus },
  { id: "freedraw", label: "Pen", key: "P", icon: Pencil },
  { id: "text", label: "Text", key: "T", icon: Type },
  { id: "eraser", label: "Eraser", key: "E", icon: Eraser },
] as const;
const PALETTE = [
  { name: "Ink", token: "--foreground" },
  { name: "Ocean", token: "--primary" },
  { name: "Leaf", token: "--success" },
  { name: "Berry", token: "--chart-4" },
  { name: "Coral", token: "--destructive" },
  { name: "Sunshine", token: "--warning" },
];
interface Gesture {
  kind: "draw" | "move" | "box" | "pan" | "resize" | "erase";
  start: Point;
  screen: Point;
  scene: Scene;
  view: Viewport;
  ids: string[];
  element?: SceneElement;
  points: Point[];
  handle?: string;
}
export function BoardEditor({
  board,
  repository,
  onBack,
  onChange,
  retain,
  onCopy,
  hasDraft,
}: {
  board: Board;
  repository: BoardAccess;
  onBack: () => void;
  onChange: (b: Board, replace?: boolean) => void;
  retain: (b: Board, pending: boolean) => void;
  onCopy: (scene: Scene) => void;
  hasDraft: boolean;
}) {
  const [state, setState] = useState(() => history(board.scene)),
    [preview, setPreview] = useState<Scene | null>(null),
    [selection, setSelection] = useState<string[]>([]),
    [tool, setTool] = useState<Tool>("select"),
    [view, setView] = useState(INITIAL_VIEW),
    [saveStatus, setSaveStatus] = useState<SaveState>("saved"),
    [remote, setRemote] = useState<Board | null>(null),
    [conflict, setConflict] = useState<Scene | null>(null),
    [marquee, setMarquee] = useState<ReturnType<typeof dragBox> | null>(null),
    [textEntry, setTextEntry] = useState<{ point: Point; value: string; id?: string } | null>(null);
  const [stroke, setStroke] = useState("--foreground"),
    [fill, setFill] = useState("none"),
    [width, setWidth] = useState(2),
    [opacity, setOpacity] = useState(100);
  const root = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null),
    clipboard = useRef<Scene | null>(null),
    pointers = useRef(new Map<number, Point>()),
    pinch = useRef<{ distance: number; point: Point; view: Viewport } | null>(null);
  const callbacks = useRef({ onChange, retain, onCopy });
  callbacks.current = { onChange, retain, onCopy };
  const current = useRef(state);
  current.current = state;
  const [writer] = useState(
    () =>
      new BoardAutosave(repository, board, (status, saved) => {
        setSaveStatus(status);
        const pending = status !== "saved";
        callbacks.current.retain({ ...saved, scene: current.current.present }, pending);
        callbacks.current.onChange({
          ...saved,
          scene: pending ? current.current.present : saved.scene,
        });
        if (status === "error")
          toast.error("Couldn't save. Your board is kept in this browser; retry or export a copy.");
        if (status === "conflict") {
          setConflict(current.current.present);
          void repository
            .read(board.descriptor)
            .then(setRemote, () =>
              toast.error("Couldn't load the other version. Your drawing is still safe here."),
            );
        }
      }),
  );
  const initialBoard = useRef(board);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!hasDraft) return;
    }
    if (!initialBoard.current.descriptor) {
      const draft = { ...initialBoard.current, scene: state.present };
      callbacks.current.retain(draft, true);
      callbacks.current.onChange(draft);
      return;
    }
    writer.update(state.present);
  }, [state.present, writer, hasDraft]);
  useEffect(() => {
    const flush = () => {
      void writer.flush(true);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const retry = () => {
      void writer.retry();
    };
    addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    addEventListener("online", retry);
    return () => {
      removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
      removeEventListener("online", retry);
      writer.dispose();
    };
  }, [writer]);
  useEffect(() => {
    const canvas = root.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const point: Point = [event.clientX - rect.left, event.clientY - rect.top];
      if (event.ctrlKey || event.metaKey)
        setView((value) => zoomAt(value, Math.exp(-event.deltaY * 0.01), point));
      else setView((value) => ({ ...value, x: value.x - event.deltaX, y: value.y - event.deltaY }));
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, []);
  const scene = preview ?? state.present;
  const edit = (next: Scene) => {
    setState((s) => commit(s, next));
    setPreview(null);
  };
  const colour = (token: string) => {
    if (token === "none") return "transparent";
    const value = root.current ? getComputedStyle(root.current).getPropertyValue(token).trim() : "";
    return isColour(value) ? value : "black";
  };
  const style = (): Partial<SceneElement> => ({
    strokeColor: colour(stroke),
    backgroundColor: colour(fill),
    strokeWidth: width,
    opacity,
  });
  const changeStyle = (patch: Partial<SceneElement>) => {
    if (selection.length) edit(updateElements(state.present, selection, patch));
  };
  const selected = scene.elements.filter((e) => selection.includes(e.id) && !e.isDeleted),
    bounds = selected.length ? sceneBounds(scene, selection) : null;
  const duplicate = () => {
    const copy = duplicateElements(state.present, selection);
    edit(copy.scene);
    setSelection(copy.ids);
  };
  const copy = () => {
    clipboard.current = {
      ...state.present,
      elements: state.present.elements.filter((e) => selection.includes(e.id) && !e.isDeleted),
    };
  };
  const paste = () => {
    const copied = clipboard.current;
    if (!copied) return;
    const combined = {
      ...state.present,
      files: { ...state.present.files, ...copied.files },
      elements: [...state.present.elements],
    };
    const temp = duplicateElements(
      copied,
      copied.elements.map((e) => e.id),
    );
    edit({
      ...combined,
      elements: [
        ...combined.elements,
        ...temp.scene.elements.filter((e) => temp.ids.includes(e.id)),
      ],
    });
    setSelection(temp.ids);
  };
  const screen = (event: { clientX: number; clientY: number }): Point => {
    const box = root.current?.getBoundingClientRect();
    return [event.clientX - (box?.left ?? 0), event.clientY - (box?.top ?? 0)];
  };
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    root.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const s = screen(event);
    pointers.current.set(event.pointerId, s);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b)
        pinch.current = {
          distance: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])),
          point: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
          view,
        };
      gesture.current = null;
      setPreview(null);
      return;
    }
    const p = canvasPoint(view, ...s);
    const base: Gesture = {
      kind: "draw",
      start: p,
      screen: s,
      scene: state.present,
      view,
      ids: selection,
      points: [[0, 0]],
    };
    const handle = (event.target as Element).closest("[data-resize]")?.getAttribute("data-resize");
    if (handle && selected[0]) {
      gesture.current = { ...base, kind: "resize", element: selected[0], handle };
      return;
    }
    if (tool === "hand" || event.button === 1) {
      gesture.current = { ...base, kind: "pan" };
      return;
    }
    if (tool === "text") {
      setTextEntry({ point: p, value: "" });
      return;
    }
    const hit = hitElement(state.present, p, 6 / view.zoom);
    if (tool === "eraser") {
      gesture.current = { ...base, kind: "erase" };
      if (hit) setPreview(deleteElements(state.present, [hit.id]));
      return;
    }
    if (tool === "select") {
      if (hit) {
        const group = hit.groupIds.at(-1);
        const hitIds = group
          ? state.present.elements
              .filter(
                (e) => isRenderable(e) && Array.isArray(e.groupIds) && e.groupIds.includes(group),
              )
              .map((e) => e.id)
          : [hit.id];
        const ids = event.shiftKey
          ? selection.includes(hit.id)
            ? selection.filter((id) => !hitIds.includes(id))
            : [...new Set([...selection, ...hitIds])]
          : selection.includes(hit.id)
            ? selection
            : hitIds;
        setSelection(ids);
        gesture.current = { ...base, kind: "move", ids };
      } else {
        if (!event.shiftKey) setSelection([]);
        gesture.current = { ...base, kind: "box", ids: event.shiftKey ? selection : [] };
      }
      return;
    }
    gesture.current = { ...base, element: createElement(tool, p[0], p[1], 1, 1, style()) };
  };
  const motion = (event: PointerEvent<HTMLDivElement>) => {
    const s = screen(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, s);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) {
        const pi = pinch.current;
        const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const zoomed = zoomAt(
          pi.view,
          Math.hypot(a[0] - b[0], a[1] - b[1]) / pi.distance,
          pi.point,
        );
        setView({
          ...zoomed,
          x: zoomed.x + mid[0] - pi.point[0],
          y: zoomed.y + mid[1] - pi.point[1],
        });
      }
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const p = canvasPoint(g.view, ...s),
      dx = p[0] - g.start[0],
      dy = p[1] - g.start[1];
    if (g.kind === "pan") {
      setView({ ...g.view, x: g.view.x + s[0] - g.screen[0], y: g.view.y + s[1] - g.screen[1] });
      return;
    }
    if (g.kind === "move") {
      setPreview(moveElements(g.scene, g.ids, dx, dy));
      return;
    }
    if (g.kind === "box") {
      const box = dragBox(g.start, p);
      setMarquee(box);
      setSelection([...new Set([...g.ids, ...elementsInBox(g.scene, box)])]);
      return;
    }
    if (g.kind === "erase") {
      const hit = hitElement(preview ?? g.scene, p, 6 / view.zoom);
      if (hit) setPreview(deleteElements(preview ?? g.scene, [hit.id]));
      return;
    }
    if (g.kind === "resize" && g.element) {
      const e = g.element;
      const left = g.handle?.includes("w"),
        top = g.handle?.includes("n");
      const anchor: Point = [left ? e.x + e.width : e.x, top ? e.y + e.height : e.y];
      const box = dragBox(anchor, p);
      let next = resizeElement(g.scene, e.id, box.width, box.height);
      next = updateElements(next, [e.id], { x: box.x, y: box.y });
      setPreview(next);
      return;
    }
    if (g.element) {
      let e = g.element;
      if (["line", "arrow", "freedraw"].includes(e.type)) {
        g.points =
          e.type === "freedraw"
            ? [...g.points, [dx, dy] as Point]
            : [
                [0, 0],
                [dx, dy],
              ];
        if (g.points.length > 19000) return;
        e = linear(e.type as "line" | "arrow" | "freedraw", g.start[0], g.start[1], g.points, {
          ...e,
          points: g.points,
          width: Math.abs(dx),
          height: Math.abs(dy),
        });
      } else e = { ...e, ...dragBox(g.start, p) };
      setPreview(addElement(g.scene, e));
      setSelection([e.id]);
    }
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      gesture.current = null;
      return;
    }
    const g = gesture.current;
    gesture.current = null;
    setMarquee(null);
    if (preview) {
      edit(preview);
      if (g?.kind === "draw") setTool("select");
    }
  };
  const zoom = (factor: number) =>
    setView((v) =>
      zoomAt(v, factor, [
        (root.current?.clientWidth ?? 600) / 2,
        (root.current?.clientHeight ?? 500) / 2,
      ]),
    );
  const exportFile = (format: "svg" | "png" | "excalidraw") => {
    void (async () => {
      const blob =
        format === "png"
          ? await scenePng(state.present)
          : new Blob(
              [
                format === "svg"
                  ? sceneToSvg(state.present, { background: true })
                  : serializeScene(state.present),
              ],
              { type: format === "svg" ? "image/svg+xml" : "application/json" },
            );
      await downloadBoard(blob, board.title, format);
    })().catch(() => toast.error("Couldn't export this board. Try another format."));
  };
  return (
    <div className="wb-editor">
      <header className="wb-editor-head">
        <div className="wb-editor-title">
          <IconButton label="All boards" variant="ghost" onClick={onBack}>
            <ArrowLeft size={19} />
          </IconButton>
          <h2>{board.title}</h2>
          <span role="status" className="wb-save">
            {
              {
                saved: "Saved",
                pending: "Unsaved changes",
                saving: "Saving…",
                error: "Kept in this browser",
                conflict: "Changed in another tab",
              }[saveStatus]
            }
          </span>
          {saveStatus === "error" && (
            <Button size="sm" variant="outline" onClick={() => void writer.retry()}>
              Retry save
            </Button>
          )}
        </div>
        <div className="wb-exports">
          <Button size="sm" variant="outline" onClick={() => exportFile("excalidraw")}>
            .excalidraw
          </Button>
          <Button size="sm" variant="outline" onClick={() => exportFile("svg")}>
            SVG
          </Button>
          <Button size="sm" variant="outline" onClick={() => exportFile("png")}>
            PNG
          </Button>
        </div>
      </header>
      <div className="wb-toolbar" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map(({ id, label, key, icon: Icon }) => (
          <IconButton
            key={id}
            label={`${label} (${key})`}
            aria-pressed={tool === id}
            variant={tool === id ? "secondary" : "ghost"}
            onClick={() => setTool(id)}
          >
            <Icon size={19} aria-hidden="true" />
          </IconButton>
        ))}
        <span className="wb-tool-divider" />
        <IconButton
          label="Undo"
          variant="ghost"
          disabled={!state.past.length}
          onClick={() => setState(undo)}
        >
          <Undo2 size={18} />
        </IconButton>
        <IconButton
          label="Redo"
          variant="ghost"
          disabled={!state.future.length}
          onClick={() => setState(redo)}
        >
          <Redo2 size={18} />
        </IconButton>
      </div>
      <div className="wb-properties">
        <label>
          Stroke
          <select
            aria-label="Stroke colour"
            value={stroke}
            onChange={(e) => {
              setStroke(e.target.value);
              changeStyle({ strokeColor: colour(e.target.value) });
            }}
          >
            {PALETTE.map((c) => (
              <option value={c.token} key={c.token}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fill
          <select
            aria-label="Fill colour"
            value={fill}
            onChange={(e) => {
              setFill(e.target.value);
              changeStyle({ backgroundColor: colour(e.target.value) });
            }}
          >
            <option value="none">None</option>
            {PALETTE.map((c) => (
              <option value={c.token} key={c.token}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Width
          <select
            aria-label="Stroke width"
            value={width}
            onChange={(e) => {
              setWidth(Number(e.target.value));
              changeStyle({ strokeWidth: Number(e.target.value) });
            }}
          >
            {[1, 2, 4, 8].map((w) => (
              <option value={w} key={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label>
          Opacity
          <input
            aria-label="Opacity"
            type="range"
            min="10"
            max="100"
            step="10"
            value={opacity}
            onChange={(e) => {
              setOpacity(Number(e.target.value));
              changeStyle({ opacity: Number(e.target.value) });
            }}
          />
        </label>
        {selected[0] && selected.length === 1 && (
          <label>
            Size{" "}
            <input
              aria-label="Shape width"
              type="number"
              min="1"
              max="10000"
              value={Math.round(selected[0].width)}
              onChange={(event) => {
                const element = selected[0];
                const value = Number(event.target.value);
                if (element && value > 0 && value <= 10000)
                  edit(resizeElement(state.present, element.id, value, element.height));
              }}
            />
            <span aria-hidden="true">×</span>
            <input
              aria-label="Shape height"
              type="number"
              min="1"
              max="10000"
              value={Math.round(selected[0].height)}
              onChange={(event) => {
                const element = selected[0];
                const value = Number(event.target.value);
                if (element && value > 0 && value <= 10000)
                  edit(resizeElement(state.present, element.id, element.width, value));
              }}
            />
          </label>
        )}
        <div className="wb-selection-actions">
          <IconButton
            label="Duplicate selection"
            variant="ghost"
            disabled={!selection.length}
            onClick={duplicate}
          >
            <Copy size={17} />
          </IconButton>
          <IconButton
            label="Group selection"
            variant="ghost"
            disabled={selection.length < 2}
            onClick={() => edit(groupElements(state.present, selection))}
          >
            <Group size={17} />
          </IconButton>
          <IconButton
            label="Ungroup selection"
            variant="ghost"
            disabled={!selection.length}
            onClick={() => edit(groupElements(state.present, selection, null))}
          >
            <Ungroup size={17} />
          </IconButton>
          <IconButton
            label="Bring to front"
            variant="ghost"
            disabled={!selection.length}
            onClick={() => edit(reorderElements(state.present, selection, "front"))}
          >
            <ArrowUp size={17} />
          </IconButton>
          <IconButton
            label="Send to back"
            variant="ghost"
            disabled={!selection.length}
            onClick={() => edit(reorderElements(state.present, selection, "back"))}
          >
            <ArrowDown size={17} />
          </IconButton>
          <IconButton
            label="Delete selection"
            variant="ghost"
            disabled={!selection.length}
            onClick={() => {
              edit(deleteElements(state.present, selection));
              setSelection([]);
            }}
          >
            <Trash2 size={17} />
          </IconButton>
        </div>
      </div>
      {scene.elements.some((element) => !element.isDeleted && !isRenderable(element)) && (
        <p className="wb-import-note" role="status">
          Some shapes and images cannot be previewed here. Your .excalidraw file keeps them.
        </p>
      )}
      <div
        ref={root}
        role="application"
        aria-label="Whiteboard canvas"
        aria-describedby="wb-help"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the application canvas receives drawing shortcuts and has an accessible shape list.
        tabIndex={0}
        className={`wb-canvas wb-tool-${tool}`}
        style={{ backgroundColor: scene.appState.viewBackgroundColor }}
        onPointerDown={begin}
        onPointerMove={motion}
        onPointerUp={finish}
        onPointerCancel={() => {
          gesture.current = null;
          pointers.current.clear();
          pinch.current = null;
          setPreview(null);
          setMarquee(null);
        }}
        onDoubleClick={(event) => {
          const hit = hitElement(state.present, canvasPoint(view, ...screen(event)));
          if (hit?.type === "text")
            setTextEntry({ point: [hit.x, hit.y], value: hit.text ?? "", id: hit.id });
        }}
        onKeyDown={(event) => {
          const key = event.key.toLowerCase(),
            mod = event.metaKey || event.ctrlKey;
          if (mod && key === "z") {
            event.preventDefault();
            setState(event.shiftKey ? redo : undo);
            return;
          }
          if (mod && key === "a") {
            event.preventDefault();
            setSelection(state.present.elements.filter(isRenderable).map((e) => e.id));
            return;
          }
          if (mod && key === "c") {
            event.preventDefault();
            copy();
            return;
          }
          if (mod && key === "v") {
            event.preventDefault();
            paste();
            return;
          }
          if (mod && key === "d") {
            event.preventDefault();
            duplicate();
            return;
          }
          if (key === "delete" || key === "backspace") {
            event.preventDefault();
            edit(deleteElements(state.present, selection));
            setSelection([]);
            return;
          }
          if (key === "escape") {
            setSelection([]);
            setTool("select");
            return;
          }
          if (key === "+" || key === "=") {
            event.preventDefault();
            zoom(1.2);
            return;
          }
          if (key === "-") {
            event.preventDefault();
            zoom(1 / 1.2);
            return;
          }
          if (key === "0") {
            event.preventDefault();
            setView(INITIAL_VIEW);
            return;
          }
          if (key === "enter" && !["select", "hand", "eraser"].includes(tool)) {
            event.preventDefault();
            const point = canvasPoint(
              view,
              (root.current?.clientWidth ?? 600) / 2,
              (root.current?.clientHeight ?? 400) / 2,
            );
            if (tool === "text") setTextEntry({ point, value: "" });
            else {
              const element = createElement(
                tool as ElementType,
                point[0],
                point[1],
                140,
                80,
                style(),
              );
              edit(addElement(state.present, element));
              setSelection([element.id]);
              setTool("select");
            }
            return;
          }
          const arrows: Record<string, Point> = {
            arrowleft: [-1, 0],
            arrowright: [1, 0],
            arrowup: [0, -1],
            arrowdown: [0, 1],
          };
          const delta = arrows[key];
          if (delta) {
            event.preventDefault();
            edit(
              moveElements(
                state.present,
                selection,
                delta[0] * (event.shiftKey ? 10 : 1),
                delta[1] * (event.shiftKey ? 10 : 1),
              ),
            );
            return;
          }
          if (!mod) {
            const chosen = TOOLS.find((t) => t.key.toLowerCase() === key);
            if (chosen) {
              event.preventDefault();
              setTool(chosen.id);
            }
          }
        }}
      >
        <svg
          className="wb-svg"
          role="img"
          aria-label="Drawing and selected shapes"
          width="100%"
          height="100%"
        >
          <title>{board.title}</title>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml lint/style/useNamingConvention: only the validated, escaped DOM-free SDK SVG emitter supplies this fragment. */}
            <g dangerouslySetInnerHTML={{ __html: sceneToSvgContent(scene) }} />
            {bounds && (
              <g className="wb-selection">
                <rect
                  x={bounds.x - 4 / view.zoom}
                  y={bounds.y - 4 / view.zoom}
                  width={bounds.width + 8 / view.zoom}
                  height={bounds.height + 8 / view.zoom}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={1.5 / view.zoom}
                  strokeDasharray={`${4 / view.zoom} ${3 / view.zoom}`}
                />
                {selected.length === 1 &&
                  ["nw", "ne", "sw", "se"].map((h) => (
                    <rect
                      key={h}
                      data-resize={h}
                      x={(h.includes("w") ? bounds.x : bounds.x + bounds.width) - 5 / view.zoom}
                      y={(h.includes("n") ? bounds.y : bounds.y + bounds.height) - 5 / view.zoom}
                      width={10 / view.zoom}
                      height={10 / view.zoom}
                      fill="var(--surface)"
                      stroke="var(--primary)"
                      strokeWidth={1.5 / view.zoom}
                    />
                  ))}
              </g>
            )}
            {marquee && (
              <rect
                {...marquee}
                fill="var(--primary-soft)"
                fillOpacity="0.4"
                stroke="var(--primary)"
                strokeWidth={1 / view.zoom}
              />
            )}
          </g>
        </svg>
        {!scene.elements.some(isRenderable) && (
          <div className="wb-canvas-hint" aria-hidden="true">
            <strong>A blank canvas. A fresh start.</strong>
            <span>Choose a tool above, then drag to draw.</span>
          </div>
        )}
      </div>
      <footer className="wb-editor-foot">
        <p id="wb-help">
          V select · H pan · drag or Enter to draw · Shift for more shapes · ⌘/Ctrl Z undo
        </p>
        <div className="wb-zoom">
          <IconButton label="Zoom out" size="icon-sm" variant="ghost" onClick={() => zoom(1 / 1.2)}>
            <Minus size={16} />
          </IconButton>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Reset zoom"
            onClick={() => setView(INITIAL_VIEW)}
          >
            {Math.round(view.zoom * 100)}%
          </Button>
          <IconButton label="Zoom in" size="icon-sm" variant="ghost" onClick={() => zoom(1.2)}>
            <Plus size={16} />
          </IconButton>
        </div>
      </footer>
      <div className="wb-sr-only">
        <h3>Shapes on this board</h3>
        <ul>
          {scene.elements.filter(isRenderable).map((e, index) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => {
                  setSelection([e.id]);
                  root.current?.focus();
                }}
              >
                {index + 1}. {e.type === "text" ? e.text : e.type} at {Math.round(e.x)},{" "}
                {Math.round(e.y)}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Dialog open={textEntry !== null} onOpenChange={(open) => !open && setTextEntry(null)}>
        <DialogContent>
          <DialogTitle>{textEntry?.id ? "Edit text" : "Add text"}</DialogTitle>
          <DialogDescription>Words, notes or a bright idea.</DialogDescription>
          <label htmlFor="wb-text">Text</label>
          <Textarea
            id="wb-text"
            value={textEntry?.value ?? ""}
            onChange={(e) => setTextEntry((t) => (t ? { ...t, value: e.target.value } : null))}
            autoFocus
          />
          <DialogFooter>
            <Button
              onClick={() => {
                if (textEntry?.value.trim()) {
                  if (textEntry.id) {
                    const replacement = text(...textEntry.point, textEntry.value, style());
                    edit(
                      updateElements(state.present, [textEntry.id], {
                        text: replacement.text ?? "",
                        originalText: replacement.text ?? "",
                        width: replacement.width,
                        height: replacement.height,
                      }),
                    );
                  } else
                    edit(
                      addElement(state.present, text(...textEntry.point, textEntry.value, style())),
                    );
                }
                setTextEntry(null);
                setTool("select");
              }}
            >
              Save text
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={conflict !== null}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogTitle>This board changed elsewhere</DialogTitle>
          <DialogDescription>
            We loaded the other version. Keep your drawing as a separate board, or reload the
            version from your pod.
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!remote}
              onClick={() => {
                if (remote) {
                  callbacks.current.retain(board, false);
                  callbacks.current.onChange(remote, true);
                  setConflict(null);
                  onBack();
                }
              }}
            >
              Reload board
            </Button>
            <Button
              onClick={() => {
                if (conflict) {
                  callbacks.current.retain(board, false);
                  if (remote) callbacks.current.onChange(remote, true);
                  callbacks.current.onCopy(conflict);
                  setConflict(null);
                  onBack();
                }
              }}
            >
              Keep my copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
