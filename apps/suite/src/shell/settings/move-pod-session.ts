// AUTHORED-BY Claude Opus 5.5
"use client";
import { isNativeApp } from "@jeswr/suite-native";

/** The Settings section that hosts the migrator's separate destination session. */
export const MOVE_POD_BASE = "/settings/move-pod/";

/**
 * Why the destination sign-in cannot run here, or null when it can. Native WebViews cannot
 * serve a client document an identity provider can fetch or receive the redirect, and
 * insecure loopback development has no fetchable client document either.
 */
export function movePodUnavailable(): "native" | "insecure" | null {
  if (isNativeApp()) return "native";
  if (typeof location !== "undefined" && location.protocol !== "https:") {
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return "insecure";
  }
  return null;
}

/**
 * End the destination session when the suite signs out. With an account id, only a session
 * that account started is forgotten; without one (sign out of everything), any is.
 */
export async function forgetMovePodDestination(owner?: string): Promise<void> {
  if (typeof location === "undefined" || isNativeApp()) return;
  const { forgetHostBoundConnection } = await import("@jeswr/pod-migrator/connections");
  await forgetHostBoundConnection({
    id: "target",
    origin: location.origin,
    base: MOVE_POD_BASE,
    ...(owner === undefined ? {} : { owner }),
  });
}
