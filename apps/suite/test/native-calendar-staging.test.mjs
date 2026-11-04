// AUTHORED-BY Codex GPT-6.1-Sol
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkWeb } from "../scripts/check-web.mjs";
import { stageCalendarRoutes } from "../scripts/stage-native.mjs";

it("introduces native calendar client references only in the staged app", async () => {
  const root = await mkdtemp(join(tmpdir(), "suite-calendar-stage-"));
  try {
    const relative = "app/(suite)/calendar";
    await cp(new URL("../src/app/(suite)/calendar", import.meta.url), join(root, relative), {
      recursive: true,
    });
    for (const path of ["page.tsx", "[view]/page.tsx"]) {
      const web = await readFile(new URL(`../src/${relative}/${path}`, import.meta.url), "utf8");
      expect(web).not.toContain("native-route");
      expect(web).not.toContain("NativeCalendar");
    }
    await stageCalendarRoutes(root);
    expect(await readFile(join(root, relative, "page.tsx"), "utf8")).toContain(
      "NativeCalendarIndex",
    );
    expect(await readFile(join(root, relative, "[view]/page.tsx"), "utf8")).toContain(
      "NativeCalendarView",
    );
    const chunks = join(root, "chunks");
    await mkdir(chunks);
    await expect(checkWeb(chunks)).rejects.toThrow("Missing web build chunks");
    const chunk = join(chunks, "calendar.js");
    await writeFile(chunk, "CalendarScreen");
    await expect(checkWeb(chunks)).resolves.toBeUndefined();
    for (const component of ["NativeCalendarIndex", "NativeCalendarView"]) {
      await writeFile(chunk, component);
      await expect(checkWeb(chunks)).rejects.toThrow("Native calendar leaked");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
