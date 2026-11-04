// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// Run on the compiled dev ARM template; never authenticates or deploys.
import assert from "assert/strict";
import { readFileSync } from "fs";

const dev = JSON.parse(readFileSync(process.argv[2], "utf8"));
assert.equal(dev.parameters.enableAgentDaemon.defaultValue, false);
const deployment = Object.values(dev.resources).find(
  (resource) => resource.type === "Microsoft.Resources/deployments",
);
assert.ok(deployment);
assert.equal(deployment.properties.parameters.environment.value, "dev");
const template = deployment.properties.template;
assert.deepEqual(template.parameters.environment.allowedValues, ["dev"]);
assert.equal(template.parameters.enabled.defaultValue, false);
const resources = Object.values(template.resources);
const app = resources.find((resource) => resource.type === "Microsoft.App/containerApps");
assert.ok(app);
assert.equal(app.condition, "[parameters('enabled')]");
assert.equal(app.identity.type, "UserAssigned");
assert.equal(app.properties.configuration.activeRevisionsMode, "Single");
assert.equal(app.properties.configuration.ingress.allowInsecure, false);
assert.equal(app.properties.configuration.ingress.targetPort, 8080);
assert.deepEqual(app.properties.template.scale, { minReplicas: 1, maxReplicas: 1 });
const volume = app.properties.template.volumes[0];
assert.equal(volume.storageType, "AzureFile");
for (const option of ["uid=65532", "gid=65532", "dir_mode=0700", "file_mode=0600"])
  assert.ok(volume.mountOptions.split(",").includes(option));
const container = app.properties.template.containers[0];
assert.equal(container.volumeMounts[0].mountPath, "/var/lib/jeswr-agent");
assert.deepEqual(container.args, ["--import", "/app/host/compose.mjs", "/app/bin/awp-cloud.mjs"]);
assert.ok(container.env.includes("AGENT_A2A_ENABLED"));
const secretLoop = app.properties.configuration.copy.find((entry) => entry.name === "secrets");
assert.ok(secretLoop.input.keyVaultUrl);
assert.ok(secretLoop.input.identity);
assert.equal(secretLoop.input.value, undefined);
const access = resources.find(
  (resource) =>
    resource.properties?.template?.resources &&
    Object.values(resource.properties.template.resources).some(
      (entry) => entry.type === "Microsoft.Authorization/roleAssignments",
    ),
);
assert.ok(access);
const role = Object.values(access.properties.template.resources).find(
  (resource) => resource.type === "Microsoft.Authorization/roleAssignments",
);
assert.ok(role.scope.includes("Microsoft.KeyVault/vaults/secrets"));
assert.equal(role.properties.principalType, "ServicePrincipal");
assert.equal(template.outputs, undefined);
console.log("Cloud template security checks passed.");
