// AUTHORED-BY Codex GPT-6.1-Sol
targetScope = 'resourceGroup'
param vaultName string
param secretName string
param principalId string
param roleDefinitionId string

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: vaultName }
resource secret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  parent: vault
  name: secretName
}
resource access 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(secret.id, principalId, roleDefinitionId)
  scope: secret
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: roleDefinitionId
  }
}
