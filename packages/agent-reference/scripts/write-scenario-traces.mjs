// AUTHORED-BY Codex GPT-6
import {
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
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
  if (
    previous &&
    (previous.what !== view.what ||
      previous.jsonld !== view.jsonld ||
      previous.turtle !== view.turtle)
  )
    throw new Error(`Conflicting linked view ${key}`);
  if (!previous) views.set(key, view);
}

const groupId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const traceFilename = /^[a-zA-Z0-9_-]+\.json$/;

export function withExclusiveFileLock(target, action, waitMs = 0) {
  const lockPath = `${target}.lock`;
  const deadline = performance.now() + waitMs;
  const waiter = waitMs ? new Int32Array(new SharedArrayBuffer(4)) : undefined;
  let lock;
  while (lock === undefined) {
    try {
      lock = openSync(lockPath, "wx");
    } catch (error) {
      const remaining = deadline - performance.now();
      if (error.code !== "EEXIST" || !waiter || remaining <= 0) throw error;
      Atomics.wait(waiter, 0, 0, Math.min(25, remaining));
    }
  }
  try {
    return action();
  } finally {
    try {
      closeSync(lock);
    } finally {
      rmSync(lockPath);
    }
  }
}

export class ScenarioTraceWriter {
  #files = new Set();
  #removed = new Set();
  #views = new Map();
  #stage;
  #reference;
  #stagedViews;

  constructor(directory, scenario, configuration) {
    if (
      typeof scenario !== "string" ||
      typeof configuration !== "string" ||
      !groupId.test(scenario) ||
      !groupId.test(configuration)
    )
      throw new Error(`Invalid trace group ${scenario} / ${configuration}`);
    if (!lstatSync(directory).isDirectory()) throw new Error("traces must be a regular directory");
    this.directory = realpathSync(directory);
    this.scenario = scenario;
    this.configuration = configuration;
    this.#reference = `linked/${scenario}--${configuration}.json`;
    this.#stage = mkdtempSync(join(this.directory, ".scenario-"));
  }

  write(file, trace) {
    if (!traceFilename.test(file) || this.#files.has(file) || this.#removed.has(file))
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

  remove(file) {
    if (!traceFilename.test(file) || file === "index.json" || this.#files.has(file))
      throw new Error(`Invalid trace filename to remove ${file}`);
    this.#removed.add(file);
  }

  // Release a finished group's view strings while the rest of the corpus runs.
  stageViews() {
    if (!this.#views.size) return;
    this.#stagedViews = join(this.#stage, ".views.json");
    writeFileSync(this.#stagedViews, sortedTable(this.#views));
    this.#views.clear();
  }

  publish() {
    if (!this.#files.size && !this.#removed.size) return;
    const linked = join(this.directory, "linked");
    try {
      mkdirSync(linked);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (!lstatSync(linked).isDirectory() || realpathSync(linked) !== linked)
      throw new Error("traces/linked must be a regular directory inside traces");
    const target = join(this.directory, this.#reference);
    withExclusiveFileLock(target, () => this.#publishLocked(target));
  }

  #publishLocked(target) {
    const stat = lstatSync(target, { throwIfNoEntry: false });
    if (stat && (!stat.isFile() || realpathSync(target) !== target))
      throw new Error(`${this.#reference} must be a regular file inside traces/linked`);
    const prior = stat ? traceLinkedTableSchema.parse(readJson(target)) : {};
    const views = this.#stagedViews
      ? new Map(Object.entries(readJson(this.#stagedViews)))
      : this.#views;
    for (const file of this.#removed) {
      const entry = lstatSync(join(this.directory, file), { throwIfNoEntry: false });
      if (entry && !entry.isFile()) throw new Error(`${file} must be a regular trace file`);
    }
    // Keep keys still used by branches outside this write, including recorded paths.
    if (stat) {
      for (const entry of readdirSync(this.directory, { withFileTypes: true })) {
        const file = entry.name;
        if (
          !file.startsWith(`${this.scenario}--`) ||
          !file.endsWith(`--${this.configuration}.json`) ||
          this.#files.has(file) ||
          this.#removed.has(file)
        )
          continue;
        if (!entry.isFile()) throw new Error(`${file} must be a regular trace file`);
        const trace = readJson(join(this.directory, file));
        if (trace.linkedTable !== this.#reference) continue;
        for (const event of trace.events)
          for (const key of event.linked ?? []) addView(views, key, prior[key]);
      }
    }
    const writeTable = (views) => {
      const staged = join(this.#stage, ".table.json");
      writeFileSync(staged, sortedTable(views));
      renameSync(staged, target);
    };
    if (this.#files.size && views.size) {
      // Publish the union first so that even an interrupted run leaves every visible
      // trace resolvable. Drop the superseded keys after replacing the trace files.
      const combined = new Map(views);
      for (const [key, view] of Object.entries(prior)) addView(combined, key, view);
      writeTable(combined);
    }
    for (const file of this.#files) renameSync(join(this.#stage, file), join(this.directory, file));
    for (const file of this.#removed) rmSync(join(this.directory, file), { force: true });
    if (views.size) writeTable(views);
    else rmSync(target, { force: true });
  }

  [Symbol.dispose]() {
    rmSync(this.#stage, { recursive: true, force: true });
  }
}
