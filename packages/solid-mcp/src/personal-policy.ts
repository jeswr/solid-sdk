// AUTHORED-BY Codex GPT-6.1-Sol
import { isSpecialCategory } from "@jeswr/pkg-memory";
import { toolText } from "./tool.js";

export const PD = "https://w3id.org/dpv/pd#";
// Never echo owner-supplied category IRIs: those can themselves contain data.
const categoryNames = new Set([
  "Contact",
  "PhysicalAddress",
  "HomeLocation",
  "EmailAddress",
  "TelephoneNumber",
  "Preference",
  "SocialNetwork",
  "MedicalHealth",
  "Genetic",
  "MentalHealth",
  "Financial",
]);
export function purposeDenied(categories: string[]) {
  const names = [
    ...new Set(
      categories.length
        ? categories.map((category) => {
            if (!category) return "uncategorized";
            const name = category.startsWith(PD) ? category.slice(PD.length) : "";
            return categoryNames.has(name) ? name : "unsupported category";
          })
        : ["uncategorized"],
    ),
  ].sort();
  return { ...toolText(`purpose denied: ${names.join(", ")}`), isError: true };
}
export function specialCategories(categories: string[]): string[] {
  // Financial data is explicitly sensitive in MCP DESIGN §4 as well.
  return [
    ...new Set(
      categories.filter((category) => isSpecialCategory(category) || category === `${PD}Financial`),
    ),
  ].sort();
}
