// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import {
  addElement,
  arrow,
  createElement,
  DEFAULT_STYLE,
  deleteElements,
  diamond,
  duplicateElements,
  ELEMENT_TYPES,
  elementBounds,
  elementsInBox,
  ellipse,
  emptyScene,
  escapeXml,
  freedraw,
  groupElements,
  hitElement,
  hitTest,
  imageReference,
  isColour,
  isRenderable,
  LIMITS,
  line,
  moveElements,
  newId,
  parseScene,
  rectangle,
  reorderElements,
  resizeElement,
  rotatePoint,
  type SceneElement,
  sceneBounds,
  sceneToSvg,
  serializeScene,
  text,
  updateElements,
  validateScene,
} from "../src/index.js";

const board = () =>
  addElement(emptyScene(), rectangle(10, 20, 100, 80, { id: "one", backgroundColor: "white" }));
const encode = (v: unknown) => JSON.stringify(v);
const revision = { now: 1234, nonce: 72 };
describe("bounded lossless JSON", () => {
  it("retains exact source bytes, unknown properties and opaque types", () => {
    const json = ` { "version": 2, "type":"excalidraw", "appState": {"future":true}, "files":{}, "elements":[{"id":"future","type":"future-shape","unknown":{"deep":[1,2]}}], "vendor":"x" }\n`;
    const scene = parseScene(json);
    expect(serializeScene(scene)).toBe(json);
    expect(sceneToSvg(scene)).not.toContain("future-shape");
    const edited = addElement(scene, rectangle(0, 0, 10, 10));
    expect(parseScene(serializeScene(edited)).elements[0]).toEqual(scene.elements[0]);
    expect(edited.vendor).toBe("x");
    scene.vendor = "changed";
    expect(serializeScene(scene)).toContain('"vendor":"changed"');
  });
  it.each(ELEMENT_TYPES)("round trips %s", (type) => {
    const e = createElement(type, 0, 1, 20, 30);
    const scene = addElement(emptyScene(), e);
    expect(parseScene(serializeScene(scene))).toEqual(scene);
  });
  it.each([
    "",
    "{",
    "null",
    "[]",
    '{"type":"excalidraw"}',
    '{"type":"excalidraw","version":3,"elements":[],"appState":{},"files":{}}',
  ])("rejects malformed scene %s", (v) => expect(() => parseScene(v)).toThrow(TypeError));
  it("rejects huge, wide and deeply nested hostile data before use", () => {
    expect(() => parseScene(" ".repeat(LIMITS.bytes + 1))).toThrow("large");
    expect(() => parseScene(`{"value":${"[".repeat(40)}0${"]".repeat(40)}}`)).toThrow("deep");
    expect(() =>
      parseScene(
        encode({
          ...emptyScene(),
          elements: Array.from({ length: 5001 }, (_, i) => ({ id: String(i), type: "future" })),
        }),
      ),
    ).toThrow("elements");
    expect(() => validateScene({ ...emptyScene(), wide: Array(250001).fill(0) })).toThrow(
      "complexity",
    );
    expect(() => parseScene(encode({ ...emptyScene(), unknown: Array(150000).fill([0]) }))).toThrow(
      "complexity",
    );
    expect(() =>
      parseScene(encode({ ...emptyScene(), unknown: "🐧".repeat(LIMITS.bytes / 3) })),
    ).toThrow("large");
  });
  it.each([
    { x: NaN },
    { y: Infinity },
    { width: -1 },
    { height: 1e9 },
    { angle: Infinity },
    { strokeWidth: -1 },
    { opacity: 101 },
    { opacity: -1 },
    { version: 0.5 },
    { versionNonce: -1 },
    { updated: NaN },
    { isDeleted: 0 },
    { groupIds: [5] },
    { groupIds: Array(101).fill("g") },
    { id: "" },
    { type: "" },
    { points: [[1, NaN]] },
    { points: [] },
  ])("rejects invalid element %j", (patch) => {
    const s = board();
    Object.assign(s.elements[0] as object, patch);
    expect(() => validateScene(s)).toThrow(TypeError);
  });
  it.each([
    { text: 7 },
    { fontSize: 0 },
    { fontSize: 1001 },
  ])("rejects invalid text %j", (patch) => {
    const s = addElement(emptyScene(), text(0, 0, "a"));
    Object.assign(s.elements[0] as object, patch);
    expect(() => validateScene(s)).toThrow();
  });
  it("rejects invalid identity, files, flags, background, references and points", () => {
    const e = rectangle(0, 0, 1, 1);
    expect(() => validateScene({ ...emptyScene(), elements: [e, e] })).toThrow();
    expect(() => parseScene(encode({ ...emptyScene(), files: [] }))).toThrow();
    expect(() =>
      validateScene({ ...emptyScene(), appState: { viewBackgroundColor: 42 } }),
    ).toThrow();
    expect(() => createElement("image", 0, 0, 1, 1, { fileId: 42 as unknown as string })).toThrow();
    expect(() => line(0, 0, [[1, 2, 3] as unknown as [number, number]])).toThrow();
    expect(() => freedraw(0, 0, Array(20001).fill([1, 1]))).toThrow();
    expect(() =>
      createElement("rectangle", 0, 0, 1, 1, { points: "x" as unknown as [] }),
    ).toThrow();
  });
  it("handles quoted brackets and escapes in preflight", () => {
    const s = addElement(emptyScene(), text(0, 0, '"\\ [[[ ]]]'));
    expect(parseScene(serializeScene(s))).toEqual(s);
  });
  it("rejects non-JSON values, cycles and in-memory nesting", () => {
    const s = emptyScene();
    s.self = s;
    expect(() => serializeScene(s)).toThrow("cyclic");
    for (const v of [undefined, () => 0, 1n, new Date(), Symbol("x"), Infinity])
      expect(() => validateScene({ ...emptyScene(), unknown: v })).toThrow();
    let deep: unknown = 0;
    for (let i = 0; i < 40; i++) deep = { deep };
    expect(() => validateScene({ ...emptyScene(), deep })).toThrow();
    expect(() => serializeScene({ ...emptyScene(), large: "x".repeat(LIMITS.bytes) })).toThrow(
      "large",
    );
    expect(() => parseScene(null as unknown as string)).toThrow();
    expect(() =>
      parseScene(
        '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{},"n":1e999}',
      ),
    ).toThrow("non-finite");
  });
  it.each([
    "transparent",
    "red",
    "#fff",
    "#11223344",
    "rgb(10 20 30 / 50%)",
    "oklch(0.5 0.1 20)",
  ])("accepts portable colour %s", (c) => expect(isColour(c)).toBe(true));
  it.each([
    "url(x)",
    "var(--x)",
    "red;fill:blue",
    "<script>",
    "x".repeat(101),
    null,
  ])("rejects colour %s", (c) => expect(isColour(c)).toBe(false));
});
describe("immutable editing", () => {
  it("constructs shapes, text, paths and references", () => {
    expect(ellipse(1, 2, 3, 4).type).toBe("ellipse");
    expect(diamond(1, 2, 3, 4).type).toBe("diamond");
    expect(
      line(0, 0, [
        [-10, 0],
        [20, 10],
      ]).width,
    ).toBe(30);
    expect(
      arrow(0, 0, [
        [0, 0],
        [10, 10],
      ]).endArrowhead,
    ).toBe("arrow");
    expect(
      freedraw(0, 0, [
        [0, 0],
        [1, 1],
      ]).simulatePressure,
    ).toBe(true);
    expect(imageReference(0, 0, 5, 5, "file").fileId).toBe("file");
    expect(text(0, 0, "a\nb", { fontSize: 10 }).height).toBe(25);
    expect(newId()).not.toBe(newId());
    expect(DEFAULT_STYLE.opacity).toBe(100);
  });
  it("bumps revision, preserves unknown data and never mutates input", () => {
    const original = board();
    const e = original.elements[0];
    const changed = updateElements(
      original,
      ["one"],
      { vendor: "kept", id: "evil", type: "ellipse" },
      revision,
    );
    expect(changed.elements[0]).toMatchObject({
      id: "one",
      type: "rectangle",
      version: 2,
      versionNonce: 72,
      updated: 1234,
      vendor: "kept",
    });
    expect(original.elements[0]).toBe(e);
    expect(e?.version).toBe(1);
    const moved = moveElements(changed, ["one"], 3, 4);
    expect(moved.elements[0]).toMatchObject({ x: 13, y: 24, version: 3, vendor: "kept" });
    const deleted = deleteElements(moved, ["one"], revision);
    expect(deleted.elements).toHaveLength(1);
    expect(deleted.elements[0]?.isDeleted).toBe(true);
    expect(moveElements(deleted, ["one"], 4, 5).elements[0]).toBe(deleted.elements[0]);
    expect(updateElements(original, ["missing"], { x: 0 }).elements[0]).toBe(e);
    expect(() => addElement(original, e as NonNullable<typeof e>)).toThrow();
  });
  it("resizes paths and text, including zero dimensions", () => {
    const s = addElement(
      emptyScene(),
      arrow(
        0,
        0,
        [
          [0, 0],
          [10, 20],
        ],
        { id: "path" },
      ),
    );
    expect(resizeElement(s, "path", 20, 40).elements[0]?.points?.[1]).toEqual([20, 40]);
    const zero = addElement(emptyScene(), line(0, 0, [[0, 0]], { id: "zero" }));
    expect(resizeElement(zero, "zero", 2, 2).elements[0]?.points).toEqual([[0, 0]]);
    const t = addElement(emptyScene(), text(0, 0, "a", { id: "text" }));
    expect(resizeElement(t, "text", 80, 60).elements[0]?.fontSize).toBe(48);
    expect(() => resizeElement(s, "path", -1, 0)).toThrow();
    expect(() => resizeElement(s, "path", NaN, 1)).toThrow();
  });
  it("groups, ungroups, reorders and duplicates with remapped links", () => {
    let s = addElement(
      board(),
      ellipse(0, 0, 20, 20, {
        id: "two",
        containerId: "one",
        startBinding: { elementId: "one" },
        endBinding: { elementId: "outside" },
        boundElements: [
          { id: "one", type: "text" },
          { id: "outside", type: "text" },
        ],
      }),
    );
    s = groupElements(s, ["one", "two"], "group", revision);
    expect(s.elements[0]?.groupIds).toEqual(["group"]);
    expect(groupElements(s, ["one"], null).elements[0]?.groupIds).toEqual([]);
    expect(groupElements(board(), ["one"]).elements[0]?.groupIds).toHaveLength(1);
    expect(reorderElements(s, ["one"], "front").elements.at(-1)?.id).toBe("one");
    expect(reorderElements(s, ["two"], "back").elements[0]?.id).toBe("two");
    const copy = duplicateElements(s, ["one", "two"], 30, revision);
    const a = copy.scene.elements[2],
      b = copy.scene.elements[3];
    expect(copy.ids).toHaveLength(2);
    expect(a).toMatchObject({ x: 40, y: 50, version: 3 });
    expect(a?.groupIds).toEqual(b?.groupIds);
    expect(a?.groupIds).not.toEqual(["group"]);
    expect(b?.containerId).toBe(a?.id);
    expect(b?.startBinding).toEqual({ elementId: a?.id });
    expect(b?.endBinding).toBe(null);
    expect(b?.boundElements).toEqual([{ id: a?.id, type: "text" }]);
    expect(() =>
      duplicateElements({ ...s, elements: Array(5000).fill(s.elements[0]) }, ["one"]),
    ).toThrow("elements");
    expect(duplicateElements(deleteElements(s, ["one"]), ["one"]).ids).toEqual([]);
    expect(duplicateElements(board(), ["one"]).scene.elements[1]?.x).toBe(34);
  });
});
describe("geometry and safe SVG", () => {
  it("computes rotated bounds, multi-selection and topmost hit", () => {
    expect(rotatePoint([1, 0], [0, 0], Math.PI / 2)[1]).toBeCloseTo(1);
    const s = board();
    expect(elementBounds(s.elements[0] as NonNullable<(typeof s.elements)[0]>)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 80,
    });
    expect(sceneBounds(emptyScene())).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(sceneBounds(s, ["missing"]).width).toBe(1);
    expect(elementsInBox(s, { x: 0, y: 0, width: 200, height: 200 })).toEqual(["one"]);
    expect(elementsInBox(s, { x: 0, y: 0, width: 2, height: 2 })).toEqual([]);
    expect(hitElement(s, [50, 50])?.id).toBe("one");
    expect(hitElement(s, [900, 900])).toBeUndefined();
    const rotated = rectangle(0, 0, 100, 20, { angle: Math.PI / 2 });
    expect(elementBounds(rotated).width).toBeCloseTo(20);
    expect(
      elementBounds(
        line(10, 10, [
          [-10, -20],
          [20, 30],
        ]),
      ),
    ).toEqual({ x: 0, y: -10, width: 30, height: 50 });
    expect(isRenderable(imageReference(0, 0, 1, 1, "x"))).toBe(false);
  });
  it("hits fill, outlines, paths and ignores deleted/unknown", () => {
    expect(hitTest(rectangle(0, 0, 100, 100), [50, 50])).toBe(false);
    expect(hitTest(rectangle(0, 0, 100, 100), [1, 50])).toBe(true);
    expect(hitTest(ellipse(0, 0, 100, 100), [50, 50])).toBe(false);
    expect(hitTest(ellipse(0, 0, 100, 100, { backgroundColor: "red" }), [50, 50])).toBe(true);
    expect(hitTest(ellipse(0, 0, 100, 100), [0, 0])).toBe(false);
    expect(hitTest(diamond(0, 0, 100, 100), [50, 0])).toBe(true);
    expect(hitTest(diamond(0, 0, 100, 100), [50, 50])).toBe(false);
    expect(hitTest(diamond(0, 0, 100, 100, { backgroundColor: "red" }), [50, 50])).toBe(true);
    expect(
      hitTest(
        line(0, 0, [
          [0, 0],
          [100, 100],
        ]),
        [50, 50],
      ),
    ).toBe(true);
    expect(hitTest(line(0, 0, [[0, 0]]), [0, 0])).toBe(true);
    expect(hitTest(text(0, 0, "hello"), [1, 1])).toBe(true);
    expect(hitTest(rectangle(0, 0, 1, 1, { isDeleted: true }), [0, 0])).toBe(false);
    expect(hitTest({ ...rectangle(0, 0, 1, 1), type: "unknown" }, [0, 0])).toBe(false);
  });
  it("escapes hostile text and drops all embedded file/unknown markup", () => {
    let s = emptyScene();
    for (const type of ELEMENT_TYPES) s = addElement(s, createElement(type, 0, 0, 50, 50));
    s = addElement(s, text(10, 80, "<script>&\"'\nsecond", { textAlign: "center" }));
    s.files = { x: { dataURL: "javascript:alert(1)" } };
    const svg = sceneToSvg(s, { background: true });
    expect(svg).toContain("&lt;script&gt;&amp;&quot;&apos;");
    expect(svg).not.toContain("javascript:");
    expect(svg).toContain("polyline");
    expect(svg).toContain("ellipse");
    expect(svg).toContain("polygon");
    expect(escapeXml("\u0001<&")).toBe("&lt;&amp;");
    expect(() => sceneToSvg(s, { padding: -1 })).toThrow();
    s.appState.viewBackgroundColor = "white";
    expect(sceneToSvg(s, { background: true })).toContain('fill="white"');
    expect(
      sceneToSvg(addElement(emptyScene(), text(0, 0, "x", { textAlign: "right", lineHeight: 20 }))),
    ).toBeDefined();
  });
});

describe("streamed imports and renderer branches", () => {
  it("bounds streamed bytes, decodes split UTF-8, rejects malformed UTF-8 and cancels overflow", async () => {
    const { parseSceneStream } = await import("../src/index.js");
    const json = serializeScene(addElement(emptyScene(), text(0, 0, "🐧")));
    const bytes = new TextEncoder().encode(json);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    expect(serializeScene(await parseSceneStream(stream))).toBe(json);
    await expect(parseSceneStream(null)).rejects.toThrow("Missing");
    let cancelled = false;
    await expect(
      parseSceneStream(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(LIMITS.bytes + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
    ).rejects.toThrow("large");
    expect(cancelled).toBe(true);
    await expect(
      parseSceneStream(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([255]));
            c.close();
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      parseSceneStream(
        new ReadableStream({
          start(c) {
            c.error(new Error("network"));
          },
        }),
      ),
    ).rejects.toThrow("network");
  });
  it("renders safe fragments, stroke styles and arrow head variants", async () => {
    const { sceneToSvgContent } = await import("../src/index.js");
    let s = addElement(emptyScene(), rectangle(0, 0, 10, 10, { strokeStyle: "dashed" }));
    s = addElement(s, ellipse(20, 0, 10, 10, { strokeStyle: "dotted" }));
    s = addElement(
      s,
      arrow(
        0,
        0,
        [
          [0, 0],
          [20, 20],
        ],
        { endArrowhead: null },
      ),
    );
    s = addElement(s, arrow(0, 0, [[0, 0]], { endArrowhead: "arrow" }));
    s = addElement(s, text(0, 0, "x", { textAlign: "right", lineHeight: 1.5 }));
    const fragment = sceneToSvgContent(s);
    expect(fragment).not.toContain("<svg");
    expect(fragment).toContain('stroke-dasharray="8 6"');
    expect(fragment).toContain('stroke-dasharray="2 5"');
    expect(fragment).toContain('text-anchor="end"');
    expect(escapeXml("\t\n\r\u0000")).toBe("\t\n\r");
  });
});

it("keeps opaque future elements opaque during duplication and ignores their geometry", () => {
  const s = parseScene(
    '{"type":"excalidraw","version":2,"elements":[{"id":"future","type":"future","payload":{"a":1}}],"appState":{},"files":{}}',
  );
  const result = duplicateElements(s, ["future"]);
  expect(result.scene.elements[1]?.payload).toEqual({ a: 1 });
  expect(elementBounds(s.elements[0] as NonNullable<(typeof s.elements)[0]>)).toEqual({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
});

it("makes malformed Unicode safe for XML and data URI thumbnails", () => {
  expect(escapeXml("\ud800\ufffe\uffff🐧")).toBe("\ufffd\ufffd\ufffd🐧");
  const s = addElement(emptyScene(), text(0, 0, "\ud800"));
  expect(() => encodeURIComponent(sceneToSvg(s))).not.toThrow();
});

it("rejects malformed hexadecimal colours", () => {
  expect(isColour("#12345")).toBe(false);
  expect(isColour("#1234567")).toBe(false);
});

// AUTHORED-BY Codex (GPT-6.1 Sol)
describe("review import and geometry regressions", () => {
  it("defaults missing legacy timestamps without changing untouched bytes", () => {
    const element = { ...rectangle(0, 0, 10, 10) } as Record<string, unknown>;
    delete element.updated;
    const json = JSON.stringify({ ...emptyScene(), elements: [element] });
    const parsed = parseScene(json);
    expect(parsed.elements[0]?.updated).toBe(0);
    expect(serializeScene(parsed)).toBe(json);
  });
  it.each([
    "hsl(120deg 50% 50%)",
    "lab(50% 40 30)",
    "hwb(90 10% 10%)",
    "color-mix(in srgb, red, blue)",
    "url(https://evil.example)",
    'red" onload="evil()',
  ])("preserves unsupported paint %s and omits it from SVG", (colour) => {
    const input = JSON.stringify({
      ...emptyScene(),
      appState: { viewBackgroundColor: colour },
      elements: [{ ...rectangle(0, 0, 10, 10), strokeColor: colour }],
    });
    const parsed = parseScene(input);
    expect(serializeScene(parsed)).toBe(input);
    expect(sceneToSvg(parsed, { background: true })).not.toContain(colour);
    expect(isRenderable(parsed.elements[0] as SceneElement)).toBe(false);
  });
  it("imports BOM-prefixed text and streamed UTF-8", async () => {
    const { parseSceneStream } = await import("../src/index.js");
    const source = `\uFEFF${JSON.stringify(emptyScene())}`;
    expect(serializeScene(parseScene(source))).toBe(source);
    const stream = new Response(source).body;
    expect(serializeScene(await parseSceneStream(stream))).toBe(source);
  });
  it("matches Excalidraw point-centred rotation for a negative-point arrow", async () => {
    const { elementCentre, resizeHandle, resizeFromHandle } = await import("../src/index.js");
    // Relative points (0,0), (-100,-50), rotated 90 degrees around world (150,175).
    const e = arrow(
      200,
      200,
      [
        [0, 0],
        [-100, -50],
      ],
      { id: "rotated", angle: Math.PI / 2 },
    );
    expect(elementCentre(e)).toEqual([150, 175]);
    const b = elementBounds(e);
    expect(b.x).toBeCloseTo(125);
    expect(b.y).toBeCloseTo(125);
    expect(b.width).toBeCloseTo(50);
    expect(b.height).toBeCloseTo(100);
    expect(hitTest(e, [125, 225], 0)).toBe(true);
    expect(hitTest(e, [175, 125], 0)).toBe(true);
    expect(hitTest(e, [225, 125], 0)).toBe(false);
    expect(sceneToSvg(addElement(emptyScene(), e))).toContain("rotate(90 -50 -25)");
    const fixed = resizeHandle(e, "nw");
    const resized = resizeFromHandle(addElement(emptyScene(), e), e.id, "se", [75, 325])
      .elements[0] as SceneElement;
    const after = resizeHandle(resized, "nw");
    expect(after[0]).toBeCloseTo(fixed[0]);
    expect(after[1]).toBeCloseTo(fixed[1]);
    expect(resizeHandle(resized, "se")[0]).toBeCloseTo(75);
    expect(resizeHandle(resized, "se")[1]).toBeCloseTo(325);
  });
});

it("exercises complexity caps on JSON text, wide objects and aggregate pending values", () => {
  expect(() => parseScene(`[${"0,".repeat(LIMITS.nodes + 1)}0]`)).toThrow("complexity");
  expect(() =>
    validateScene(Object.fromEntries(Array.from({ length: LIMITS.nodes + 1 }, (_, i) => [i, 0]))),
  ).toThrow("complexity");
  expect(() => validateScene(Array.from({ length: 10000 }, () => Array(30).fill(0)))).toThrow(
    "complexity",
  );
  for (const patch of [{ strokeColor: null }, { backgroundColor: 7 }])
    expect(() =>
      validateScene({ ...emptyScene(), elements: [{ ...rectangle(0, 0, 1, 1), ...patch }] }),
    ).toThrow("colour");
});

it("covers app-owned previews, optional bindings, and degenerate resizing", async () => {
  const { resizeFromHandle, resizeHandle, localBounds } = await import("../src/index.js");
  const preview = { preview: true };
  const s = board();
  expect(addElement(s, rectangle(0, 0, 1, 1), preview).elements).toHaveLength(2);
  expect(reorderElements(s, ["one"], "back", preview).elements).toHaveLength(1);
  expect(duplicateElements(s, ["one"], 0, preview).ids).toHaveLength(1);
  expect(resizeFromHandle(s, "missing", "nw", [0, 0])).toBe(s);
  const box = s.elements[0] as NonNullable<(typeof s.elements)[0]>;
  const resized = resizeFromHandle(s, "one", "nw", [0, 0], preview).elements[0] as typeof box;
  expect(resizeHandle(resized, "se")).toEqual(resizeHandle(box, "se"));
  expect(localBounds({ ...box, points: [] }).width).toBe(100);
  const unbound = addElement(
    emptyScene(),
    rectangle(0, 0, 1, 1, {
      id: "unbound",
      startBinding: {},
      endBinding: { elementId: "unbound" },
      containerId: "outside",
    }),
  );
  expect(duplicateElements(unbound, ["unbound"]).scene.elements[1]?.containerId).toBe(null);
  const degenerate = addElement(emptyScene(), { ...text(0, 0, "x", { id: "text" }), height: 0 });
  expect(resizeElement(degenerate, "text", 20, 40).elements[0]?.fontSize).toBe(24);
  // Runtime fallback for a legacy caller that constructs text without fontSize.
  expect(
    resizeElement(
      {
        ...degenerate,
        elements: degenerate.elements.map((e) => {
          const v = { ...e };
          delete v.fontSize;
          return v;
        }),
      },
      "text",
      20,
      40,
    ).elements[0]?.fontSize,
  ).toBe(24);
});

it("excludes non-rendered items from box selections", () => {
  expect(
    elementsInBox(addElement(emptyScene(), imageReference(0, 0, 10, 10, "image")), {
      x: -20,
      y: -20,
      width: 100,
      height: 100,
    }),
  ).toEqual([]);
});

it("bounds transient additions before rendering", () => {
  const e = rectangle(0, 0, 1, 1);
  expect(() =>
    addElement({ ...emptyScene(), elements: Array(5000).fill(e) }, e, { preview: true }),
  ).toThrow("elements");
});

it("starts revisions when explicitly editing an opaque future element without version fields", () => {
  const s = parseScene(
    '{"type":"excalidraw","version":2,"appState":{},"files":{},"elements":[{"id":"future","type":"future"}]}',
  );
  expect(updateElements(s, ["future"], { vendor: "edited" }).elements[0]?.version).toBe(1);
});
