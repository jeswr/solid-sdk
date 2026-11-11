// AUTHORED-BY Claude Opus 5.5
/**
 * Drag-and-drop vocabulary (06-tasks §4.4). Components translate dnd-kit
 * collisions into a `DropTarget`; `planDrop` maps it onto one `DropPlan`
 * that the state layer writes. Everything here is pure and DOM-free.
 */

import type { BoardGrouping, Swimlane } from "../board/swimlanes";
import type { TaskView } from "../views/types";

/** Where a row is rendered: a project section, or a smart-view day group. */
export type DropContainer =
  | {
      readonly kind: "section";
      readonly projectUrl: string;
      readonly sectionId?: string | undefined;
      readonly lane?: Swimlane | undefined;
    }
  /** Overdue/Later groups carry no day: rows there drag out, never in. */
  | { readonly kind: "day"; readonly dayKey?: string | undefined };

/** Left half of a row reorders (before/after); its right half nests (child). */
export type Placement = "before" | "after" | "child";

export type DropTarget =
  | {
      readonly kind: "task";
      readonly url: string;
      readonly container: DropContainer;
      readonly placement: Placement;
    }
  /** A list section header (start), a board column body or a section's add row (end). */
  | {
      readonly kind: "section";
      readonly projectUrl: string;
      readonly sectionId?: string | undefined;
      readonly at: "start" | "end";
      readonly lane?: Swimlane | undefined;
    }
  | { readonly kind: "day"; readonly dayKey: string }
  | { readonly kind: "project"; readonly projectUrl: string };

export interface PositionPatch {
  readonly url: string;
  readonly position: number;
}

export type DropPlan =
  | { readonly kind: "none" }
  | {
      readonly kind: "position";
      readonly url: string;
      readonly projectUrl: string;
      readonly sectionId: string | undefined;
      readonly parentId: string | undefined;
      readonly sectionChanged: boolean;
      readonly parentChanged: boolean;
      readonly position: number;
      /** Applied to the remaining siblings before the moved row (positions.ts contract). */
      readonly renumber: readonly PositionPatch[];
      /** 1-based slot among the destination siblings, for announcements. */
      readonly index: number;
      readonly lane?: Swimlane | undefined;
    }
  | { readonly kind: "reschedule"; readonly url: string; readonly dayKey: string }
  | { readonly kind: "project"; readonly url: string; readonly projectUrl: string };

/** What a listing knows beyond its visible rows. */
export interface PlanOptions {
  readonly groupRowsBy?: BoardGrouping | undefined;
  /** Board cards share one ordering level per section and retain their RDF parent links. */
  readonly flat?: boolean | undefined;
  /**
   * Every task of the project, closed ones included (visible rows hide them
   * when show-completed is off); nesting checks children against these.
   * Defaults to the visible rows.
   */
  readonly all?: readonly TaskView[] | undefined;
  /**
   * False when the list is sorted by due date, priority or name: rows show no
   * manual order, so only section and project moves apply (06-tasks §4.4).
   */
  readonly manual?: boolean | undefined;
}

/** Minimal naming context for announcements; StoredProject satisfies it via `projectNames`. */
export interface ProjectName {
  readonly url: string;
  readonly title: string;
  readonly sections: readonly {
    readonly id: string;
    readonly name: string;
    readonly wipLimit?: number | undefined;
  }[];
}
