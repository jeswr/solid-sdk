// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { RdfIO } from "../../src/apps/tasks/lib/model/io";
import { TaskStore } from "../../src/apps/tasks/lib/model/store";

// Start CSS with @css:config/file-root.json and a disposable root, then run:
// SST_TASKS_CSS_URL=http://localhost:34815/ pnpm --filter @jeswr/app-suite exec vitest run --config vitest.css.config.ts
const endpoint = process.env.SST_TASKS_CSS_URL;
if (!endpoint) throw new Error("Set SST_TASKS_CSS_URL to a disposable, writable CSS root.");

it.each([
  false,
  true,
])("creates, adopts and compensates on CSS (omit PUT ETags: %s)", async (omitEtags) => {
  const storage = new URL(`regression-${crypto.randomUUID()}/`, endpoint).href;
  let failFinalization: string | undefined;
  let failDeletion: string | undefined;
  const transport: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (init?.method === "PUT" && headers.has("If-Match")) {
      expect(String(input).endsWith("/")).toBe(false);
      if (String(input) === failFinalization) {
        failFinalization = undefined;
        return new Response(null, { status: 503 });
      }
    }
    if (init?.method === "DELETE" && String(input) === failDeletion)
      return new Response(null, { status: 503 });
    const response = await fetch(input, init);
    if (omitEtags && init?.method === "PUT" && response.ok) {
      const withoutValidator = new Headers(response.headers);
      withoutValidator.delete("ETag");
      return new Response(response.body, { status: response.status, headers: withoutValidator });
    }
    return response;
  };
  const io = new RdfIO(transport);
  await io.container(storage);
  const options = { storage, webId: `${storage}profile#me`, fetch: transport, typeIndex: false };
  const creator = new TaskStore(options);
  const inbox = await creator.bootstrapInbox();
  const adopted = await new TaskStore(options).bootstrapInbox();
  expect(adopted.tracker.id).toBe(inbox.tracker.id);
  const task = await creator.createTask(adopted, {
    title: "CSS task",
    state: "open",
    dueDate: new Date("2026-10-25T12:00:00Z"),
    recurrence: { frequency: "DAILY" },
    reminders: [{ offset: "-PT15M" }],
  });
  expect((await creator.readTask(task.url)).task.title).toBe("CSS task");
  expect(task.etag).toBeTruthy();
  const updated = await creator.updateTask(task, (item) => {
    item.recurrence = { frequency: "WEEKLY" };
    item.reminders = [{ offset: "-PT30M" }];
  });
  const read = await creator.readTask(updated.url);
  expect(read.task.recurrence?.frequency).toBe("WEEKLY");
  expect(read.task.reminders).toMatchObject([{ offset: "-PT30M" }]);
  failFinalization = `${creator.projects}failed.ttl`;
  await expect(creator.createProject("Failed")).rejects.toMatchObject({ status: 503 });
  expect(await io.optional(`${creator.projects}failed.ttl`)).toBeUndefined();
  expect(await io.optional(`${creator.projects}failed/`)).toBeUndefined();
  expect((await creator.createProject("Failed")).url).toBe(`${creator.projects}failed.ttl`);
  expect((await creator.createProject("Unrelated")).tracker.title).toBe("Unrelated");

  const recoveryStorage = new URL("recovery/", storage).href;
  await io.container(recoveryStorage);
  const recoveryOptions = { ...options, storage: recoveryStorage };
  const interrupted = new TaskStore(recoveryOptions);
  failFinalization = `${interrupted.projects}inbox.ttl`;
  failDeletion = `${interrupted.projects}inbox/`;
  await expect(interrupted.bootstrapInbox()).rejects.toThrow(AggregateError);
  expect(await io.optional(`${interrupted.projects}inbox.ttl`)).toBeDefined();
  failDeletion = undefined;
  const restarted = new TaskStore(recoveryOptions);
  const recovered = await restarted.bootstrapInbox();
  expect(recovered.url).toBe(`${interrupted.projects}inbox.ttl`);
  expect(
    (await restarted.createTask(recovered, { title: "Recovered", state: "open" })).task.title,
  ).toBe("Recovered");
});
