// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";

import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useId } from "react";
import type { AppSlug, NavigationApp } from "./apps.js";
import { usePreferences } from "./preferences.js";

export function CustomiseRail({ apps }: { apps: readonly NavigationApp[] }) {
  const preferences = usePreferences("rail");
  const description = useId();
  const saved = [...new Set(preferences.value.pinned)];
  const pinned = saved.filter((slug) => apps.some((app) => app.slug === slug)).slice(0, 6);
  const ordered = [
    ...pinned
      .map((slug) => apps.find((app) => app.slug === slug))
      .filter((app) => app !== undefined),
    ...apps.filter((app) => !pinned.includes(app.slug)),
  ];
  function pin(slug: AppSlug, checked: boolean) {
    if (checked && saved.length >= 6) return;
    preferences.update({
      pinned: checked ? [...saved, slug] : saved.filter((item) => item !== slug),
    });
  }
  function move(slug: AppSlug, target: number) {
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
    <section className="suite-customise" aria-label="Customise rail">
      <p id={description}>
        Pin up to 6 apps. Drag to reorder, or use the checkboxes and Move up/down buttons.
      </p>
      <p role="status">
        {saved.length} of 6 apps pinned{preferences.status === "saving" ? " · Saving…" : ""}
      </p>
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
                className="suite-drag"
                draggable
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
    </section>
  );
}
