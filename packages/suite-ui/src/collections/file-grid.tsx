// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { File } from "lucide-react";
import { type ReactNode, useEffect, useMemo } from "react";
import {
  CollectionPlaceholder,
  CollectionStatus,
  type CollectionSurfaceProps,
  hasCollectionContent,
} from "./collection-state.js";
import { useCollectionMetrics, useCollectionNavigation } from "./use-collection.js";
import { type SelectionModel, useSelection } from "./use-selection.js";

export interface FileGridProps<T> extends CollectionSurfaceProps {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  label: string;
  selection?: SelectionModel;
  onOpen: (item: T) => void;
  onDetails?: (item: T) => void;
  renderPreview?: (item: T) => ReactNode;
  renderMetadata?: (item: T) => ReactNode;
  height?: number;
}

export function FileGrid<T>({
  items,
  getKey,
  getLabel,
  label,
  selection: supplied,
  onOpen,
  onDetails,
  renderPreview,
  renderMetadata,
  height = 440,
  ...surface
}: FileGridProps<T>) {
  const local = useSelection();
  const selection = supplied ?? local;
  const metrics = useCollectionMetrics("grid");
  const columns = Math.max(1, Math.floor((metrics.width + 16) / 216));
  const keys = useMemo(() => items.map(getKey), [items, getKey]);
  const byKey = useMemo(() => new Map(items.map((item) => [getKey(item), item])), [items, getKey]);
  const navigation = useCollectionNavigation({
    keys,
    selection,
    columns,
    scrollToIndex: (index) => virtual.scrollToIndex(index, { align: "auto" }),
    onOpen: (key) => {
      const item = byKey.get(key);
      if (item) onOpen(item);
    },
    onDetails: (key) => {
      const item = byKey.get(key);
      if (item) onDetails?.(item);
    },
  });
  const virtual = useVirtualizer({
    count: Math.ceil(items.length / columns),
    getScrollElement: () => metrics.viewport.current,
    estimateSize: () => metrics.height + 16,
    overscan: 2,
    rangeExtractor: navigation.rangeExtractor,
    initialRect: { width: 0, height },
  });
  useEffect(() => {
    if (metrics.height && columns) virtual.measure();
  }, [virtual, metrics.height, columns]);
  const content = hasCollectionContent(surface.state, items.length);
  return (
    <div className="suite-collection" data-collection="grid">
      <div className="suite-collection-toolbar">
        <button
          type="button"
          disabled={!keys.length || !content}
          onClick={() => selection.toggleAll(keys)}
        >
          {keys.length > 0 && keys.every((key) => selection.selectedKeys.has(key))
            ? "Deselect visible files"
            : "Select all visible files"}
        </button>
        <CollectionStatus state={surface.state} selectedCount={selection.selectedKeys.size} />
      </div>
      <CollectionPlaceholder kind="grid" count={items.length} {...surface} />
      {/* biome-ignore lint/a11y/useSemanticElements: Virtual card grids use the documented ARIA grid pattern, not a data table. */}
      <div
        ref={metrics.viewport}
        hidden={!content}
        className="suite-grid-viewport"
        role="grid"
        aria-label={label}
        aria-multiselectable="true"
        aria-rowcount={Math.ceil(items.length / columns)}
        aria-colcount={columns}
        aria-busy={surface.state?.status === "refreshing"}
        style={{ height: content ? height : 0 }}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: This virtual card grid has no table layout. */}
        <div role="rowgroup" style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((virtualRow) => (
            // biome-ignore lint/a11y/useSemanticElements: Virtual card grid row.
            <div
              role="row"
              tabIndex={-1}
              aria-rowindex={virtualRow.index + 1}
              key={virtualRow.key}
              className="suite-card-row"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {items
                .slice(virtualRow.index * columns, (virtualRow.index + 1) * columns)
                .map((item, index) => {
                  const key = getKey(item);
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: Virtual card grid cell.
                    <div
                      role="gridcell"
                      aria-colindex={index + 1}
                      key={key}
                      {...navigation.itemProps(key)}
                      tabIndex={navigation.itemProps(key).tabIndex}
                      onKeyDown={navigation.itemProps(key).onKeyDown}
                      data-collection-item="true"
                      aria-label={getLabel(item)}
                      aria-selected={selection.selectedKeys.has(key)}
                      className="suite-file-card"
                      style={{ height: metrics.height }}
                      onClick={(event) =>
                        selection.select(key, keys, {
                          range: event.shiftKey,
                          toggle: event.ctrlKey || event.metaKey,
                          additive: event.ctrlKey || event.metaKey,
                        })
                      }
                    >
                      <div className="suite-card-preview" aria-hidden="true">
                        {renderPreview?.(item) ?? <File size={24} strokeWidth={1.5} />}
                      </div>
                      <div className="suite-card-caption">
                        <input
                          type="checkbox"
                          className="suite-selection-checkbox"
                          aria-label={`Select ${getLabel(item)}`}
                          tabIndex={-1}
                          checked={selection.selectedKeys.has(key)}
                          onChange={() => {}}
                          onClick={(event) => {
                            event.stopPropagation();
                            selection.select(key, keys, { range: event.shiftKey, toggle: true });
                          }}
                        />
                        <button
                          className="suite-file-name"
                          type="button"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(item);
                          }}
                        >
                          {getLabel(item)}
                        </button>
                      </div>
                      {renderMetadata && (
                        <div className="suite-card-metadata">{renderMetadata(item)}</div>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
