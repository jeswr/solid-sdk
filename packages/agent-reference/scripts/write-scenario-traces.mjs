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

export class ScenarioTraceWriter {
  #files = new Set();
  #views = new Map();
  #stage;
  #reference;

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
    if (!this.#files.size) return;
    const linked = join(this.directory, "linked");
    try {
      mkdirSync(linked);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (!lstatSync(linked).isDirectory() || realpathSync(linked) !== linked)
      throw new Error("traces/linked must be a regular directory inside traces");
    const target = join(this.directory, this.#reference);
    const lockPath = `${target}.lock`;
    const lock = openSync(lockPath, "wx");
    try {
      this.#publishLocked(target);
    } finally {
      try {
        closeSync(lock);
      } finally {
        rmSync(lockPath);
      }
    }
  }

  #publishLocked(target) {
    const stat = lstatSync(target, { throwIfNoEntry: false });
    if (stat && (!stat.isFile() || realpathSync(target) !== target))
      throw new Error(`${this.#reference} must be a regular file inside traces/linked`);
    const prior = stat ? traceLinkedTableSchema.parse(readJson(target)) : {};
    // Keep keys still used by branches outside this write, including recorded paths.
    if (stat) {
      for (const entry of readdirSync(this.directory, { withFileTypes: true })) {
        const file = entry.name;
        if (
          !file.startsWith(`${this.scenario}--`) ||
          !file.endsWith(`--${this.configuration}.json`) ||
          this.#files.has(file)
        )
          continue;
        if (!entry.isFile()) throw new Error(`${file} must be a regular trace file`);
        const trace = readJson(join(this.directory, file));
        if (trace.linkedTable !== this.#reference) continue;
        for (const event of trace.events)
          for (const key of event.linked ?? []) addView(this.#views, key, prior[key]);
      }
    }
    const writeTable = (views) => {
      const staged = join(this.#stage, ".table.json");
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
