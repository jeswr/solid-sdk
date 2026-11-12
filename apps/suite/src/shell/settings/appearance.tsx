// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { useT } from "@jeswr/suite-i18n/react";
import { useId } from "react";
import { LanguageSelect } from "../i18n";
import { appRegistry } from "../registry";
import { usePreferences } from "./preferences";

export function AppearanceSettings() {
  const t = useT();
  const languageId = useId();
  const theme = usePreferences("theme");
  const density = usePreferences("density");
  const font = usePreferences("fontScale");
  const motion = usePreferences("motion");
  const colours = usePreferences("appColours");
  const start = usePreferences("startPage");
  return (
    <>
      <fieldset>
        <legend>{t("settings.language")}</legend>
        <label htmlFor={languageId}>
          {t("settings.languageLabel")}
          <LanguageSelect id={languageId} aria-describedby="language-help" />
        </label>
        <p id="language-help">{t("settings.languageHelp")}</p>
      </fieldset>
      <fieldset>
        <legend>{t("appearance.theme")}</legend>
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
                {t(`appearance.${value}`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        {t("appearance.density")}
        <select
          value={density.value}
          onChange={(event) => density.update(event.target.value as typeof density.value)}
        >
          <option value="comfortable">{t("appearance.comfortable")}</option>
          <option value="compact">{t("appearance.compact")}</option>
        </select>
      </label>
      <label>
        {t("appearance.fontSize")}
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
        {t("appearance.motion")}
        <select
          value={motion.value}
          onChange={(event) => motion.update(event.target.value as typeof motion.value)}
        >
          <option value="system">{t("appearance.followSystem")}</option>
          <option value="reduce">{t("appearance.reduce")}</option>
        </select>
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={colours.value}
          onChange={(event) => colours.update(event.target.checked)}
        />
        {t("appearance.colours")}
      </label>
      <label>
        {t("appearance.startPage")}
        <select
          value={start.value}
          onChange={(event) => start.update(event.target.value as typeof start.value)}
        >
          {appRegistry
            .filter((app) => app.status === "first-cut")
            .map((app) => (
              <option key={app.slug} value={app.basePath}>
                {t(`apps.${app.slug}`)}
              </option>
            ))}
        </select>
      </label>
    </>
  );
}
