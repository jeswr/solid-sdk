// AUTHORED-BY Codex GPT-6.1-Sol
// Integration handoff for solid-suite-gitops; dev only, disabled by default.
targetScope = 'resourceGroup'
param enableAgentDaemon bool = false
param managedEnvironmentName string
param credentialStorageName string
param imageRef string
param keyVaultName string
param keyVaultResourceGroup string
param secretBindings array

module daemon './modules/agent-daemon.bicep' = {
  name: 'agent-daemon-dev'
  params: {
    environment: 'dev'
    enabled: enableAgentDaemon
    managedEnvironmentName: managedEnvironmentName
    credentialStorageName: credentialStorageName
    imageRef: imageRef
    keyVaultName: keyVaultName
    keyVaultResourceGroup: keyVaultResourceGroup
    secretBindings: secretBindings
  }
}
