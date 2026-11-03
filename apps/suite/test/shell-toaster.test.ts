// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { ownsToaster } from "../src/shell/settings/preferences";

describe("shell toast region", () => {
  it.each([
    "/tasks",
    "/tasks/inbox",
    "/drive/my",
    "/docs",
    "/dev/components",
    "/money/budget",
    "/home",
    "/home/media",
    "/permissions",
    "/connect",
  ])("defers to the app's own toaster on %s", (path) => expect(ownsToaster(path)).toBe(true));
  it.each([
    "/calendar",
    "/photos",
    "/settings",
    "/taskslist",
    "/homework",
    "/",
  ])("mounts the shell toaster on %s", (path) => expect(ownsToaster(path)).toBe(false));
});
