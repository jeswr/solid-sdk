// AUTHORED-BY GPT-6.1 Sol
import { createAppPodAuth } from "@jeswr/app-session";

export const getPodAuth = createAppPodAuth({
  base: import.meta.env.BASE_URL,
  dev: import.meta.env.DEV,
});
