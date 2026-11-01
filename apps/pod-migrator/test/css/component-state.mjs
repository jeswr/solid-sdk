// AUTHORED-BY Codex GPT-6
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** Register only CSS 7.2's own components and its Components.js context.
 * Automatic discovery walks up into the pnpm workspace and mixes unrelated
 * CSS/Comunica majors, attempting remote JSON-LD context loads offline. All
 * components used by the shipped memory configs belong to the CSS module. */
export async function cssComponentState(cssDirectory) {
  const requireCss = createRequire(join(cssDirectory, "package.json"));
  const { ModuleStateBuilder } = requireCss("componentsjs");
  const builder = new ModuleStateBuilder();
  const paths = [cssDirectory, dirname(requireCss.resolve("componentsjs/package.json"))];
  const packageJsons = await builder.buildPackageJsons(paths);
  await builder.preprocessPackageJsons(packageJsons);
  return {
    mainModulePath: cssDirectory,
    nodeModuleImportPaths: [cssDirectory],
    nodeModulePaths: paths,
    packageJsons,
    componentModules: await builder.buildComponentModules(packageJsons),
    contexts: await builder.buildComponentContexts(packageJsons),
    importPaths: await builder.buildComponentImportPaths(packageJsons),
  };
}
