// AUTHORED-BY Claude Fable 5
"use client";

import { cn } from "@jeswr/app-shell";
import { useState } from "react";
import { centerRole, registeredApp, surroundingRoles } from "../document.js";
import type { EcosystemRole, ServiceRegistry } from "../schema.js";
import { StatusDot } from "./status-dot.js";
import { TryLiveButton } from "./try-live.js";
import { type ServiceStatus, useServiceStatuses } from "./use-service-status.js";

export interface EcosystemMapProps {
  registry: ServiceRegistry;
}

function roleHealthPaths(registry: ServiceRegistry, role: EcosystemRole): string[] {
  return role.apps.map((slug) => registeredApp(registry, slug).healthPath);
}

function roleStatus(
  registry: ServiceRegistry,
  role: EcosystemRole,
  statuses: Record<string, ServiceStatus>,
): ServiceStatus | undefined {
  const paths = roleHealthPaths(registry, role);
  if (paths.length === 0) return undefined;
  const resolved = paths.map((path) => statuses[path] ?? "checking");
  if (resolved.includes("live")) return "live";
  if (resolved.every((status) => status === "not-deployed")) return "not-deployed";
  return "checking";
}

/**
 * Interactive ecosystem map: the data subject's own vault at the centre, the value-chain
 * roles around it. Click or focus a node to read its seat; roles with a demo app expose a
 * try-this-live launch with a live-status dot; mapped-but-unbuilt seats say so. Driven
 * entirely by the single service registry.
 */
export function EcosystemMap({ registry }: EcosystemMapProps) {
  const center = centerRole(registry);
  const roles = surroundingRoles(registry);
  const [selectedSlug, setSelectedSlug] = useState(center.slug);
  const allPaths = [center, ...roles].flatMap((role) => roleHealthPaths(registry, role));
  const statuses = useServiceStatuses([...new Set(allPaths)]);
  const selected = [center, ...roles].find((role) => role.slug === selectedSlug) ?? center;
  const selectedStatus = roleStatus(registry, selected, statuses);

  return (
    <div data-ecosystem-map="">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          aria-pressed={selectedSlug === center.slug}
          className={cn(
            "rounded-xl border-2 p-4 text-left transition-colors sm:col-span-2 lg:col-span-3",
            selectedSlug === center.slug
              ? "border-primary bg-primary/5"
              : "border-primary/40 bg-card hover:border-primary",
          )}
          data-map-center=""
          data-map-node={center.slug}
          key={center.slug}
          onClick={() => setSelectedSlug(center.slug)}
          type="button"
        >
          <p className="font-semibold text-card-foreground">
            {center.role}{" "}
            <span className="font-normal text-muted-foreground">— the centre of the ecosystem</span>
          </p>
          <p className="mt-0.5 text-muted-foreground text-sm">modelled on {center.modelledOn}</p>
          <StatusDot
            className="mt-2"
            status={roleStatus(registry, center, statuses) ?? "checking"}
          />
        </button>
        {roles.map((role) => {
          const status = roleStatus(registry, role, statuses);
          const isSelected = selectedSlug === role.slug;
          return (
            <button
              aria-pressed={isSelected}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/60",
              )}
              data-map-node={role.slug}
              data-map-role={role.roleNumber}
              key={role.slug}
              onClick={() => setSelectedSlug(role.slug)}
              type="button"
            >
              {role.roleNumber !== undefined && (
                <p className="text-muted-foreground text-xs">Role {role.roleNumber}</p>
              )}
              <p className="mt-0.5 font-semibold text-card-foreground text-sm">{role.role}</p>
              <p className="mt-0.5 truncate text-muted-foreground text-sm">{role.modelledOn}</p>
              {status === undefined ? (
                <span className="mt-2 inline-block text-muted-foreground text-xs">
                  Mapped seat — no app in this demo
                </span>
              ) : (
                <StatusDot className="mt-2" status={status} />
              )}
            </button>
          );
        })}
      </div>

      <div
        aria-live="polite"
        className="mt-4 rounded-xl border border-border bg-card p-5"
        data-map-detail=""
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-card-foreground">
            {selected.roleNumber !== undefined && (
              <span className="text-muted-foreground">Role {selected.roleNumber} · </span>
            )}
            {selected.role}
          </h3>
          <p className="text-muted-foreground text-sm">{selected.membership}</p>
        </div>
        <p className="mt-1 text-muted-foreground text-sm">modelled on {selected.modelledOn}</p>
        <p className="mt-3 text-card-foreground text-sm">{selected.summary}</p>
        {selected.apps.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {selected.apps.map((slug) => (
              <TryLiveButton
                app={slug}
                key={slug}
                label={`Open ${registeredApp(registry, slug).appName}`}
                registry={registry}
              />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-muted-foreground text-sm" data-map-no-app="">
            This seat is mapped for a later phase; it has no application in this demo.
          </p>
        )}
        {selectedStatus === "not-deployed" && (
          <p className="mt-2 text-muted-foreground text-xs">
            Not deployed in this environment — the seat and its story remain part of the map.
          </p>
        )}
      </div>
    </div>
  );
}
