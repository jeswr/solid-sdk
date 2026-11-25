// AUTHORED-BY Codex (GPT-6.1 Sol)
import { arrow, emptyScene, rectangle, type Scene, text } from "@jeswr/excalidraw-scene";
import type { WhiteboardRepository } from "../lib/repository";
/** Fictional projects; this runs only for the demo session. */
export function sampleScenes(): { title: string; scene: Scene }[] {
  const project = emptyScene();
  project.appState.viewBackgroundColor = "white";
  project.elements = [
    text(0, 0, "A little room for big ideas", { fontSize: 32 }),
    text(0, 55, "Lark Studio · autumn workshop", { fontSize: 18 }),
    rectangle(0, 120, 200, 120, { backgroundColor: "lightyellow" }),
    text(20, 145, "Gather ideas\nNo idea too small", { fontSize: 20 }),
    rectangle(300, 120, 200, 120, { backgroundColor: "lightcyan" }),
    text(320, 145, "Make a plan\nOne step at a time", { fontSize: 20 }),
    arrow(210, 180, [
      [0, 0],
      [80, 0],
    ]),
  ];
  const garden = emptyScene();
  garden.appState.viewBackgroundColor = "white";
  garden.elements = [
    text(0, 0, "The community garden", { fontSize: 30 }),
    rectangle(0, 80, 210, 150, { backgroundColor: "honeydew" }),
    text(20, 110, "Wildflower patch\nBees welcome", { fontSize: 20 }),
    rectangle(260, 80, 210, 150, { backgroundColor: "lightyellow" }),
    text(280, 110, "Vegetable beds\nShare the harvest", { fontSize: 20 }),
  ];
  return [
    { title: "Autumn workshop", scene: project },
    { title: "Community garden", scene: garden },
  ];
}
const seeds = new WeakMap<object, Promise<void>>();
export function seedSamples(
  repository: WhiteboardRepository,
  seedKey: object = repository,
): Promise<void> {
  const found = seeds.get(seedKey);
  if (found) return found;
  const task = (async () => {
    if ((await repository.list()).length) return;
    for (const sample of sampleScenes()) await repository.create(sample.title, sample.scene);
  })();
  seeds.set(seedKey, task);
  void task.catch(() => seeds.delete(seedKey));
  return task;
}
