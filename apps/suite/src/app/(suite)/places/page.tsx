// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import { PlacesApp } from "@/apps/places/components/places-app";
import "@/apps/places/components/places.css";
export const metadata: Metadata = { title: "Places · Solid Suite" };
export default function Page() {
  return <PlacesApp />;
}
