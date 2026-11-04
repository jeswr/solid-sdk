// AUTHORED-BY Codex GPT-6.1-Sol
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ChatApp } from "@/apps/chat/components/chat-app";
import "@/apps/chat/components/chat.css";
export const metadata: Metadata = { title: "Chat · Solid Suite" };
export default function ChatLayout({ children }: { children: ReactNode }) {
  return <ChatApp>{children}</ChatApp>;
}
