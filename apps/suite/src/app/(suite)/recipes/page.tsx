// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import { RecipesApp } from "@/apps/recipes/components/recipes-app";
import "@/apps/recipes/components/recipes.css";

export const metadata: Metadata = { title: "Recipes · Solid Suite" };

export default function Page() {
  return <RecipesApp />;
}
