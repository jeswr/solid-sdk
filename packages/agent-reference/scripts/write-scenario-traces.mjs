// AUTHORED-BY Codex GPT-6
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  // biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
} from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { traceFileSchema, traceLinkedTableSchema } from "../dist/trace/schema.js";

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const sortedTable = (views) =>
  json(Object.fromEntries([...views.keys()].sort().map((key) => [key, views.get(key)])));

function addView(views, key, view) {
  if (!view) throw new Error(`Missing linked view ${key}`);
  const previous = views.get(key);
  if (previous && (previous.what !== view.what || previous.jsonld !== view.jsonld))
    throw new Error(`Conflicting linked view ${key}`);
  // Equivalent graphs can have different Turtle statement orders.
  if (!previous || view.turtle < previous.turtle) views.set(key, view);
}

export class ScenarioTraceWriter {
  #files = new Set();
  #views = new Map();
  #stage;
  #reference;

  constructor(directory, scenario) {
    if (!/^[a-zA-Z0-9_-]+$/.test(scenario)) throw new Error(`Invalid scenario ID ${scenario}`);
    this.directory = directory;
    this.scenario = scenario;
    this.#reference = `linked/${scenario}.json`;
    this.#stage = mkdtempSync(join(directory, ".scenario-"));
  }

  write(file, trace) {
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(file) || this.#files.has(file))
      throw new Error(`Invalid or duplicate trace filename ${file}`);
    const { linked, ...plain } = trace;
    if (
      linked !== undefined ||
      plain.linkedTable !== undefined ||
      trace.events.some((event) => event.linked !== undefined)
    )
      traceFileSchema.parse(trace);
    if (linked) {
      const keys = new Set(trace.events.flatMap((event) => event.linked ?? []));
      for (const key of keys) addView(this.#views, key, linked[key]);
      if (keys.size) plain.linkedTable = this.#reference;
    }
    const bytes = json(plain);
    writeFileSync(join(this.#stage, file), bytes);
    this.#files.add(file);
    return bytes;
  }

  publish() {
    const target = join(this.directory, this.#reference);
    const hasPrior = existsSync(target);
    const prior = hasPrior ? traceLinkedTableSchema.parse(readJson(target)) : {};
    // A configuration-only run can leave other branches and configurations pointing at
    // this table. Keep exactly the keys those traces still use.
    if (hasPrior) {
      for (const file of readdirSync(this.directory)) {
        if (
          !file.startsWith(`${this.scenario}--`) ||
          !file.endsWith(".json") ||
          this.#files.has(file)
        )
          continue;
        const trace = readJson(join(this.directory, file));
        if (trace.linkedTable !== this.#reference) continue;
        for (const event of trace.events)
          for (const key of event.linked ?? []) addView(this.#views, key, prior[key]);
      }
    }
    const writeTable = (views) => {
      const staged = join(this.#stage, "table.json");
      mkdirSync(join(this.directory, "linked"), { recursive: true });
      writeFileSync(staged, sortedTable(views));
      renameSync(staged, target);
    };
    if (this.#views.size) {
      // Publish the union first so that even an interrupted run leaves every visible
      // trace resolvable. Drop the superseded keys after replacing the trace files.
      const combined = new Map(this.#views);
      for (const [key, view] of Object.entries(prior)) addView(combined, key, view);
      writeTable(combined);
    }
    for (const file of this.#files) renameSync(join(this.#stage, file), join(this.directory, file));
    if (this.#views.size) writeTable(this.#views);
    else rmSync(target, { force: true });
  }

  [Symbol.dispose]() {
    rmSync(this.#stage, { recursive: true, force: true });
  }
}
