// AUTHORED-BY Claude Opus 5.5
import { ShareUnavailableError } from "./errors.js";

/** The `@capacitor/share` plugin surface this package uses. */
export interface SharePlugin {
  canShare(): Promise<{ value: boolean }>;
  share(options: {
    title?: string;
    text?: string;
    url?: string;
    files?: string[];
    dialogTitle?: string;
  }): Promise<{ activityType?: string }>;
}

/** The Web Share API subset used as the web fallback. */
export interface WebShare {
  share?(data: { title?: string; text?: string; url?: string }): Promise<void>;
}

export interface ShareContent {
  title?: string;
  text?: string;
  /** Must be `https:`. Share pod resource URLs, never a URL that carries a credential. */
  url?: string;
  /** Native only: `file://` URIs of files in the app's own storage. */
  files?: string[];
}

export interface ShareTargets {
  native?: SharePlugin;
  web?: WebShare;
}

export interface ShareResult {
  /** False when the person dismissed the sheet. */
  completed: boolean;
  activityType?: string;
}

const MAX_TEXT = 10_000;
const MAX_FILES = 20;

function validate(content: ShareContent): void {
  const { title, text, url, files } = content;
  if (title === undefined && text === undefined && url === undefined && !files?.length) {
    throw new TypeError("Nothing to share");
  }
  for (const value of [title, text]) {
    if (value !== undefined && (typeof value !== "string" || value.length > MAX_TEXT)) {
      throw new TypeError("Share title and text must be strings of at most 10 000 characters");
    }
  }
  if (url !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new TypeError("Share url must be an absolute URL");
    }
    if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
      throw new TypeError("Share url must be https without credentials");
    }
  }
  if (files !== undefined) {
    if (files.length > MAX_FILES) throw new TypeError("At most 20 files can be shared");
    for (const file of files) {
      if (typeof file !== "string" || !file.startsWith("file:///")) {
        throw new TypeError("Shared files must be file:/// URIs in app storage");
      }
    }
  }
}

function dismissed(error: unknown): boolean {
  const { name, message } = (error ?? {}) as { name?: unknown; message?: unknown };
  return name === "AbortError" || (typeof message === "string" && /cancel/i.test(message));
}

/**
 * Opens the share sheet: the native one inside the app (Android WebView has no Web Share API),
 * else `navigator.share`. Throws `ShareUnavailableError` when neither works, so the caller can
 * fall back to "Copy link".
 */
export async function share(content: ShareContent, targets: ShareTargets): Promise<ShareResult> {
  validate(content);
  const { native, web } = targets;
  try {
    if (native && (await native.canShare()).value) {
      const { activityType } = await native.share(content);
      return activityType === undefined ? { completed: true } : { completed: true, activityType };
    }
    if (content.files?.length) throw new ShareUnavailableError("Files can only be shared natively");
    if (typeof web?.share !== "function") throw new ShareUnavailableError("No share sheet");
    const { title, text, url } = content;
    await web.share({ title, text, url });
    return { completed: true };
  } catch (error) {
    if (error instanceof ShareUnavailableError) throw error;
    if (dismissed(error)) return { completed: false };
    throw new ShareUnavailableError("The share sheet failed");
  }
}
