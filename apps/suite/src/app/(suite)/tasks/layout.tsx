// AUTHORED-BY Codex GPT-6
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TasksApp } from "@/apps/tasks/components/tasks-app";
import "@/apps/tasks/components/tasks.css";
export const metadata: Metadata = { title: "Tasks · Solid Suite" };
export default function TasksLayout({ children }: { children: ReactNode }) {
  return <TasksApp>{children}</TasksApp>;
}
