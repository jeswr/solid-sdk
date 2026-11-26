// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseGoogleTimeline } from "@jeswr/solid-places/timeline";

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    self.postMessage({ data: parseGoogleTimeline(await event.data.text()) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Could not read this file.",
    });
  }
};
