// AUTHORED-BY Codex (GPT-6.1 Sol)

import { entities, type MealPlanData } from "./generated/model.js";

export type { MealPlanData };

function monday(date: Date | undefined): date is Date {
  return (
    date instanceof Date &&
    Number.isFinite(date.getTime()) &&
    date.getUTCDay() === 1 &&
    /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(date.toISOString())
  );
}

/** Keep old name-encoded weeks readable; startDate is authoritative when present. */
function withWeek(data: MealPlanData): MealPlanData {
  const { startDate, ...plain } = data;
  const fromName = /^\d{4}-\d{2}-\d{2}$/.test(data.name)
    ? new Date(`${data.name}T00:00:00Z`)
    : undefined;
  const date = monday(startDate)
    ? startDate
    : monday(fromName) && fromName.toISOString().slice(0, 10) === data.name
      ? fromName
      : undefined;
  return date ? { ...plain, name: date.toISOString().slice(0, 10), startDate: date } : plain;
}

export async function serializeMealPlan(url: string, data: MealPlanData): Promise<string> {
  if (data.startDate !== undefined && !monday(data.startDate))
    throw new TypeError("Choose a Monday at midnight UTC for the meal plan week");
  return entities.MealPlan.serialize(url, withWeek(data));
}

export async function parseMealPlan(
  url: string,
  body: string,
  contentType: string | null = "text/turtle",
): Promise<MealPlanData | undefined> {
  const data = await entities.MealPlan.parseDocument(url, body, contentType);
  return data ? withWeek(data) : undefined;
}
