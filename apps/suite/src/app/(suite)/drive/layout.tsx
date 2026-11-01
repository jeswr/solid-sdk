// AUTHORED-BY Claude Opus 5.5
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DriveApp } from "@/apps/drive/components/drive-app";
import "@/apps/drive/components/drive.css";

export const metadata: Metadata = { title: "Drive · Solid Suite" };

export default function DriveLayout({ children }: { children: ReactNode }) {
  return <DriveApp>{children}</DriveApp>;
}
