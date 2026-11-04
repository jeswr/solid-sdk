// AUTHORED-BY Codex GPT-6.1-Sol
// Isolated, loopback-only CSS 7.2 fixture. No account or real credential provisioning.
import { AppRunner } from "@solid/community-server";
import { ModuleStateBuilder } from "componentsjs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { Server } from "net";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { dirname } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";

const listen = Server.prototype.listen;
const listening = [];
Server.prototype.listen = function loopbackListen(port, ...args) {
  listening.push(
    new Promise((resolve, reject) => {
      this.once("listening", resolve);
      this.once("error", reject);
    }),
  );
  return Reflect.apply(listen, this, [{ port, host: "127.0.0.1" }, ...args]);
};
const [config, port] = process.argv.slice(2);
const cssDirectory = dirname(
  fileURLToPath(import.meta.resolve("@solid/community-server/package.json")),
);
const builder = new ModuleStateBuilder();
const paths = [
  cssDirectory,
  dirname(fileURLToPath(import.meta.resolve("componentsjs/package.json"))),
];
const packageJsons = await builder.buildPackageJsons(paths);
await builder.preprocessPackageJsons(packageJsons);
const moduleState = {
  mainModulePath: cssDirectory,
  nodeModuleImportPaths: [cssDirectory],
  nodeModulePaths: paths,
  packageJsons,
  componentModules: await builder.buildComponentModules(packageJsons),
  contexts: await builder.buildComponentContexts(packageJsons),
  importPaths: await builder.buildComponentImportPaths(packageJsons),
};
const app = await new AppRunner().create({
  loaderProperties: { moduleState, logLevel: "error" },
  config,
  shorthand: { port: Number(port), baseUrl: `http://localhost:${port}/`, loggingLevel: "error" },
});
process.on("SIGTERM", async () => {
  await app.stop();
  process.exit(0);
});
await app.start();
await Promise.all(listening);
process.send({ ready: true });
