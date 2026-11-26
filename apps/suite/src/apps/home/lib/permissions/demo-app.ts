// AUTHORED-BY Claude Fable 5.2
/**
 * The demo app's two public documents. They live here, outside `lib/demo-pod`, because the
 * native build replaces that folder with inert stand-ins and Permissions still needs the URLs
 * to recognise them. The demo seed builds its files from these same constants.
 */
export const DEMO_APP_ROOT = "https://alice.demo.pod/apps/notenest/";
export const DEMO_APP_CLIENT_ID = `${DEMO_APP_ROOT}client-id.jsonld`;
export const DEMO_APP_LOGO = `${DEMO_APP_ROOT}logo.svg`;
