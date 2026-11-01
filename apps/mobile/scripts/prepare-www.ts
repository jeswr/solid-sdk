// AUTHORED-BY Claude Opus 5.5
import { prepareNative } from "../src/www.ts";

prepareNative(new URL("../", import.meta.url), process.env);
