// AUTHORED-BY Codex GPT-6.1-Sol
/** The native link followed by the scripted browser after a login/consent POST. */
export async function navigation(response: Response): Promise<URL> {
  const href = (await response.text()).match(/<a href="([^"]+)"/)?.[1];
  if (!href) throw new Error("Missing browser continuation link");
  return new URL(
    href.replace(
      /&(amp|quot|lt|gt|#39);/g,
      (_match, entity: string) =>
        ({ amp: "&", quot: '"', lt: "<", gt: ">", "#39": "'" })[entity] as string,
    ),
  );
}
