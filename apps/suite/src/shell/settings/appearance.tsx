// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { appRegistry } from "../registry";
import { usePreferences } from "./preferences";

export function AppearanceSettings() {
  const theme = usePreferences("theme");
  const density = usePreferences("density");
  const font = usePreferences("fontScale");
  const motion = usePreferences("motion");
  const colours = usePreferences("appColours");
  const start = usePreferences("startPage");
  return (
    <>
      <fieldset>
        <legend>Theme</legend>
        <div className="settings-choice-row">
          {(["system", "light", "dark"] as const).map((value) => (
            <label className="settings-theme" key={value}>
              <span className="settings-theme-preview" data-preview={value} aria-hidden="true" />
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={theme.value === value}
                  onChange={() => theme.update(value)}
                />
                {value === "system" ? "System" : value === "light" ? "Light" : "Dark"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        Density
        <select
          value={density.value}
          onChange={(event) => density.update(event.target.value as typeof density.value)}
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <label>
        UI font size
        <select
          value={font.value}
          onChange={(event) => font.update(event.target.value as typeof font.value)}
        >
          {["90", "100", "110"].map((value) => (
            <option key={value} value={value}>
              {value}%
            </option>
          ))}
        </select>
      </label>
      <label>
        Reduce motion
        <select
          value={motion.value}
          onChange={(event) => motion.update(event.target.value as typeof motion.value)}
        >
          <option value="system">Follow system</option>
          <option value="reduce">Reduce</option>
        </select>
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={colours.value}
          onChange={(event) => colours.update(event.target.checked)}
        />
        Show app colours on rail
      </label>
      <label>
        Start page
        <select
          value={start.value}
          onChange={(event) => start.update(event.target.value as typeof start.value)}
        >
          {appRegistry
            .filter((app) => app.status === "first-cut")
            .map((app) => (
              <option key={app.slug} value={app.basePath}>
                {app.name}
              </option>
            ))}
        </select>
      </label>
    </>
  );
}
