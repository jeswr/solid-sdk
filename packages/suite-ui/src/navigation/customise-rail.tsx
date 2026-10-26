// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";

import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useId } from "react";
import type { AppSlug, NavigationApp } from "./apps.js";
import { usePreferences } from "./preferences.js";

export function CustomiseRail({ apps }: { apps: readonly NavigationApp[] }) {
  const preferences = usePreferences("rail");
  const description = useId();
  // Edits made while the account's preferences are loading or failed would be
  // written over a value the user has not seen, so the panel is read-only then.
  const writable = preferences.status !== "loading" && !preferences.error;
  const saved = [...new Set(preferences.value.pinned)];
  const pinned = saved.filter((slug) => apps.some((app) => app.slug === slug)).slice(0, 6);
  const ordered = [
    ...pinned
      .map((slug) => apps.find((app) => app.slug === slug))
      .filter((app) => app !== undefined),
    ...apps.filter((app) => !pinned.includes(app.slug)),
  ];
  function pin(slug: AppSlug, checked: boolean) {
    if (!writable) return;
    if (checked && saved.length >= 6) return;
    preferences.update({
      pinned: checked ? [...saved, slug] : saved.filter((item) => item !== slug),
    });
  }
  function move(slug: AppSlug, target: number) {
    if (!writable) return;
    if (pinned.indexOf(slug) === target) return;
    const next = saved.filter((item) => item !== slug);
    if (!saved.includes(slug) && saved.length >= 6) return;
    const targetSlug = pinned[target];
    // Translate the visible position into the saved list so hidden pins survive edits.
    const targetIndex = targetSlug === undefined ? saved.length : saved.indexOf(targetSlug);
    next.splice(targetIndex, 0, slug);
    preferences.update({ pinned: next });
  }
  return (
    <section
      className="suite-customise"
      aria-label="Customise rail"
      aria-disabled={writable ? undefined : true}
    >
      <p id={description}>
        Pin up to 6 apps. Drag to reorder, or use the checkboxes and Move up/down buttons.
      </p>
      <p role="status">
        {writable
          ? `${saved.length} of 6 apps pinned${preferences.status === "saving" ? " · Saving…" : ""}`
          : "Rail settings are unavailable until your app preferences load"}
      </p>
      <fieldset className="suite-customise-list" disabled={!writable}>
        <legend className="suite-sr-only">Pinned apps</legend>
        <ul aria-describedby={description}>
          {ordered.map((app) => {
            const index = pinned.indexOf(app.slug);
            return (
              <li
                key={app.slug}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const slug = event.dataTransfer.getData("text/plain");
                  if (apps.some((item) => item.slug === slug))
                    move(slug as AppSlug, index < 0 ? pinned.length : index);
                }}
              >
                <button
                  type="button"
                  data-slot="customise-rail-drag"
                  className="suite-drag"
                  draggable={writable}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", app.slug);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  aria-label={`Drag ${app.name} to pin or reorder`}
                  title={`Drag ${app.name} to pin or reorder`}
                  tabIndex={-1}
                  aria-hidden="true"
                >
                  <GripVertical size={16} aria-hidden="true" />
                </button>
                <label>
                  <input
                    type="checkbox"
                    data-slot="customise-rail-checkbox"
                    checked={index >= 0}
                    disabled={index < 0 && saved.length >= 6}
                    onChange={(event) => pin(app.slug, event.target.checked)}
                  />
                  {app.name}
                </label>
                {index >= 0 && (
                  <span className="suite-reorder">
                    <button
                      type="button"
                      data-slot="navigation-icon-button"
                      className="suite-icon-button"
                      title={`Move ${app.name} up`}
                      aria-label={`Move ${app.name} up`}
                      disabled={index === 0}
                      onClick={() => move(app.slug, index - 1)}
                    >
                      <ArrowUp size={16} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      data-slot="navigation-icon-button"
                      className="suite-icon-button"
                      title={`Move ${app.name} down`}
                      aria-label={`Move ${app.name} down`}
                      disabled={index === pinned.length - 1}
                      onClick={() => move(app.slug, index + 1)}
                    >
                      <ArrowDown size={16} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
    </section>
  );
}
