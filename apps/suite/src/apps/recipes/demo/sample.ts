// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type RecipeData, type RecipeStore, recipeSubject } from "@jeswr/solid-recipe";
import type { PodSession } from "@/lib/session/pod-session";
import { weekDays } from "../lib/recipes";

export const SAMPLE_RECIPES: RecipeData[] = [
  {
    name: "Roasted tomato & butter bean stew",
    image:
      "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=800&q=80",
    description: "A cosy, one-pan supper with lemon, soft beans and a crunchy slice of toast.",
    author: "Rowan Finch (fictional)",
    recipeYield: "4 servings",
    category: "Dinner",
    cuisine: "Mediterranean",
    totalTime: "PT35M",
    prepTime: "PT10M",
    cookTime: "PT25M",
    keywords: ["One pot", "Vegetarian", "Weeknight"],
    favourite: true,
    rating: 5,
    calories: "420 kcal",
    ingredients: [
      "2 tbsp olive oil",
      "1 onion, finely chopped",
      "2 cloves garlic",
      "400 g chopped tomatoes",
      "2 tins butter beans, drained",
      "1/2 lemon",
      "4 slices sourdough",
    ],
    instructions: [
      "Warm the oil in a wide pan. Add the onion and cook gently for 8 minutes.",
      "Stir in the garlic, tomatoes and beans. Simmer for 20 minutes, stirring occasionally.",
      "Finish with lemon juice and a little seasoning. Serve with toasted sourdough.",
    ],
  },
  {
    name: "Lemon & herb traybake",
    image:
      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80",
    description: "Golden potatoes and colourful vegetables, with everything cooked on one tray.",
    author: "Rowan Finch (fictional)",
    recipeYield: "2 servings",
    category: "Dinner",
    cuisine: "British",
    totalTime: "PT50M",
    favourite: false,
    ingredients: [
      "500 g baby potatoes",
      "2 carrots",
      "1 courgette",
      "2 tbsp olive oil",
      "1 lemon",
      "1–2 tsp dried thyme",
    ],
    instructions: [
      "Heat the oven to 200°C. Halve the potatoes and chop the vegetables.",
      "Toss everything with oil, lemon zest and thyme on a large tray.",
      "Roast for 40 minutes, turning halfway, until golden and tender.",
    ],
  },
  {
    name: "Blueberry oat pancakes",
    image:
      "https://images.unsplash.com/photo-1528207776546-365bb710ee93?auto=format&fit=crop&w=800&q=80",
    description: "A slow weekend breakfast, lovely with yoghurt and a handful of berries.",
    author: "Mira Vale (fictional)",
    recipeYield: "8 pancakes",
    category: "Breakfast",
    cuisine: "American",
    totalTime: "PT20M",
    favourite: true,
    ingredients: [
      "1 1/2 cups rolled oats",
      "1 banana",
      "2 eggs",
      "½ cup milk",
      "1 tsp baking powder",
      "100 g blueberries",
    ],
    instructions: [
      "Blend the oats, banana, eggs, milk and baking powder into a thick batter.",
      "Fold in the blueberries. Rest for 5 minutes.",
      "Spoon into a lightly oiled pan. Cook for 2 minutes on each side.",
    ],
  },
  {
    name: "Sesame noodle salad",
    image:
      "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=800&q=80",
    description: "Fresh, crisp and ready in the time it takes to cook the noodles.",
    recipeYield: "2 servings",
    category: "Lunch",
    cuisine: "Asian inspired",
    totalTime: "PT15M",
    favourite: false,
    ingredients: [
      "150 g noodles",
      "1 cucumber",
      "2 spring onions",
      "1 tbsp sesame oil",
      "2 tbsp soy sauce",
      "1 tbsp lime juice",
    ],
    instructions: [
      "Cook the noodles according to the packet, then rinse under cold water.",
      "Slice the cucumber and spring onions. Whisk the dressing ingredients together.",
      "Toss everything together and serve.",
    ],
  },
];
const pending = new WeakMap<typeof fetch, Promise<void>>();
export function ensureSample(
  session: PodSession,
  store: RecipeStore,
  now = new Date(),
): Promise<void> {
  if (session.mode !== "demo") return Promise.resolve();
  const existing = pending.get(session.fetch);
  if (existing) return existing;
  const task = (async () => {
    const current = await store.list();
    if (current.recipes.length) return;
    const saved = [];
    for (const [index, recipe] of SAMPLE_RECIPES.entries())
      saved.push(
        await store.create(
          { ...recipe, created: now, modified: now },
          `sample-recipe-${index}.ttl`,
        ),
      );
    const [stew, traybake, pancakes] = saved;
    if (!stew || !traybake || !pancakes) throw new Error("Missing demo recipes");
    await store.savePlan({
      name: weekDays(now)[0] as string,
      monday: recipeSubject(stew.url),
      wednesday: recipeSubject(traybake.url),
      saturday: recipeSubject(pancakes.url),
    });
  })().catch((error: unknown) => {
    pending.delete(session.fetch);
    throw error;
  });
  pending.set(session.fetch, task);
  return task;
}
