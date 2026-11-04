// AUTHORED-BY Claude Opus 5.5
/**
 * Native shells cannot save through a `blob:` download anchor: the iOS navigation guard cancels
 * it and Android's WebView has no download listener. Instead the file is staged in the app's
 * share-out cache and handed to the platform share sheet, which offers "Save to Files" on iOS and
 * save or send targets on Android.
 */

/** Matches suite-native's DEFAULT_SHARE_STAGING_LIMITS.maxFileBytes; kept here so the web build never loads that package. */
export const NATIVE_SAVE_LIMIT = 100 * 1024 * 1024;

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/** The bare media type, without parameters; anything else becomes application/octet-stream. */
export function saveMimeType(contentType: string | undefined): string {
  const bare = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  return bare.length <= 255 && MIME.test(bare) ? bare : "application/octet-stream";
}

/** Resolves false when the person dismissed the share sheet. */
export async function saveNatively(
  blob: Blob,
  name: string,
  contentType?: string,
): Promise<boolean> {
  const [{ shareStagingPlugin, sharePlugin }, { shareFiles }] = await Promise.all([
    import("@jeswr/suite-native/capacitor"),
    import("@jeswr/suite-native"),
  ]);
  const result = await shareFiles(
    [{ blob, name, mimeType: saveMimeType(contentType) }],
    { title: name },
    { staging: shareStagingPlugin, native: sharePlugin },
  );
  return result.completed;
}
