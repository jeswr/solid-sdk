// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";

import { Grid2X2, MoreHorizontal, Plus, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useRef, useState } from "react";
import { IconButton } from "../components/ui/icon-button.js";
import { AppGrid } from "./app-grid.js";
import { type AppSlug, type NavigationApp, suiteApps } from "./apps.js";
import { CustomiseRail } from "./customise-rail.js";
import { usePreferences } from "./preferences.js";
import { LauncherSkeleton, NavigationErrorState } from "./states.js";

export interface AppLauncherProps {
  currentApp: AppSlug;
  apps?: readonly NavigationApp[];
  trigger?: "brand" | "more" | "tab" | "button";
}
export function AppLauncher({
  currentApp,
  apps = suiteApps,
  trigger = "button",
}: AppLauncherProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [customise, setCustomise] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const preferences = usePreferences("rail");
  const available = apps.filter((app) => app.status !== "backlog");
  const backlog =
    process.env.NEXT_PUBLIC_SHOW_BACKLOG_APPS === "1"
      ? apps.filter((app) => app.status === "backlog")
      : [];
  const matching = available.filter((app) =>
    app.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  const comingSoon = backlog.filter((app) =>
    app.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  const configurable = [...available, ...backlog];
  const actions = available.flatMap((app) => app.create ?? []);
  const close = () => {
    setOpen(false);
    setFilter("");
    setCustomise(false);
  };
  const typeFilter = (key: string) => {
    setFilter((value) => value + key);
    input.current?.focus();
  };
  return (
    <Popover.Root
      modal
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setFilter("");
          setCustomise(false);
        }
      }}
    >
      <Popover.Trigger asChild>
        <IconButton
          variant="ghost"
          type="button"
          data-slot="app-launcher-trigger"
          className={
            trigger === "brand"
              ? "suite-rail-button suite-brand"
              : trigger === "more"
                ? "suite-rail-button"
                : trigger === "tab"
                  ? "suite-tab size-auto"
                  : "suite-action size-auto"
          }
          label={trigger === "brand" || trigger === "button" ? "Apps" : "More apps"}
        >
          {trigger === "brand" ? (
            <span className="suite-app-icon suite-brand-mark">
              <svg viewBox="0 0 40 40" className="suite-app-hex" aria-hidden="true">
                <polygon points="20,4 34,12 34,28 20,36 6,28 6,12" />
              </svg>
              <Grid2X2
                size={16}
                strokeWidth={1.75}
                className="suite-app-glyph size-4"
                aria-hidden="true"
              />
            </span>
          ) : trigger === "more" || trigger === "tab" ? (
            <MoreHorizontal size={20} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Grid2X2 size={20} strokeWidth={1.75} aria-hidden="true" />
          )}
          {(trigger === "tab" || trigger === "button") && (
            <span>{trigger === "tab" ? "More" : "Apps"}</span>
          )}
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="suite-launcher"
          side={trigger === "tab" ? "top" : "right"}
          align="start"
          sideOffset={8}
          collisionPadding={8}
          aria-label="Apps"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <header className="suite-launcher-heading">
            <h2>Apps</h2>
            <Popover.Close asChild>
              <IconButton
                variant="ghost"
                size="icon-sm"
                type="button"
                data-slot="navigation-icon-button"
                className="suite-icon-button"
                label="Close apps"
              >
                <X size={20} aria-hidden="true" />
              </IconButton>
            </Popover.Close>
          </header>
          <label className="suite-filter" htmlFor={id}>
            Filter apps
          </label>
          <input
            ref={input}
            id={id}
            data-slot="app-launcher-filter"
            className="suite-filter-input"
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.currentTarget
                  .closest('[role="dialog"]')
                  ?.querySelector<HTMLAnchorElement>('[role="grid"] a')
                  ?.focus();
              }
            }}
          />
          {preferences.status === "loading" ? (
            <LauncherSkeleton />
          ) : preferences.error ? (
            <NavigationErrorState error={preferences.error} retry={preferences.retry} />
          ) : (
            <>
              {preferences.status === "refreshing" && (
                <div
                  className="suite-refresh"
                  role="status"
                  aria-label="Refreshing app preferences"
                />
              )}
              {available.length === 0 && backlog.length === 0 ? (
                <div className="suite-navigation-state">
                  <p>No apps available</p>
                  <button
                    type="button"
                    data-slot="navigation-action"
                    className="suite-action"
                    onClick={preferences.retry}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  {preferences.value.pinned.length === 0 && (
                    <div className="suite-navigation-state">
                      <p>No apps pinned yet</p>
                      <button
                        type="button"
                        data-slot="navigation-action"
                        className="suite-action"
                        onClick={() => setCustomise(true)}
                      >
                        Choose apps
                      </button>
                    </div>
                  )}
                  <p role="status" className="suite-sr-only">
                    {matching.length + comingSoon.length} apps found
                  </p>
                  {matching.length > 0 && (
                    <AppGrid
                      apps={matching}
                      currentApp={currentApp}
                      label="Available apps"
                      close={close}
                      typeFilter={typeFilter}
                    />
                  )}
                  {matching.length + comingSoon.length === 0 && (
                    <div className="suite-navigation-state">
                      <p>No results for &apos;{filter}&apos;</p>
                      <button
                        type="button"
                        data-slot="navigation-action"
                        className="suite-action"
                        onClick={() => {
                          setFilter("");
                          input.current?.focus();
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                  {backlog.length > 0 && (
                    <details className="suite-coming-soon">
                      <summary>Coming soon</summary>
                      {comingSoon.length > 0 ? (
                        <AppGrid
                          apps={comingSoon}
                          currentApp={currentApp}
                          label="Coming soon apps"
                          close={close}
                          typeFilter={typeFilter}
                        />
                      ) : (
                        <p>No coming-soon apps match this filter.</p>
                      )}
                    </details>
                  )}
                </>
              )}
            </>
          )}
          {actions.length > 0 && (
            <section className="suite-create" aria-label="Create">
              <h3>Create</h3>
              <div>
                {actions.map((action) => (
                  <button
                    type="button"
                    key={action.id}
                    data-slot="navigation-action"
                    className="suite-action"
                    onClick={() => {
                      action.onSelect();
                      close();
                    }}
                  >
                    <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                    {action.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          <footer className="suite-launcher-footer">
            <button
              type="button"
              data-slot="navigation-text-button"
              className="suite-text-button"
              aria-expanded={customise}
              aria-controls={`${id}-customise`}
              disabled={preferences.status === "loading" || Boolean(preferences.error)}
              onClick={() => setCustomise((value) => !value)}
            >
              Customise rail
            </button>
          </footer>
          {customise && (
            <div id={`${id}-customise`}>
              <CustomiseRail apps={configurable} />
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
