// AUTHORED-BY Claude Opus 5.5
"use client";
import { Direction } from "radix-ui";

/**
 * Radix's reading-direction context, re-exported so hosts set it without depending on Radix:
 * wrap the app in `<DirectionProvider dir={dir(locale)}>`; menus, popovers and sliders follow it.
 */
export const DirectionProvider: typeof Direction.DirectionProvider = Direction.DirectionProvider;
/** The nearest DirectionProvider's direction ("ltr" without one). */
export const useDirection: typeof Direction.useDirection = Direction.useDirection;
