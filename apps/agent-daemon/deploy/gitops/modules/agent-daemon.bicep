// AUTHORED-BY Codex GPT-6.1-Sol
// A-042: inactive until Jesse approves. Import only from the GitOps dev entrypoint.
targetScope = 'resourceGroup'

@allowed(['dev'])
param environment string = 'dev'

@description('Keep false until Jesse explicitly approves deployment.')
param enabled bool = false

@description('Existing dev ACA environment beside sparq. No environment is created here.')
param managedEnvironmentName string

@description('Existing environment storage registration for a dedicated ReadWrite Azure Files SMB share.')
param credentialStorageName string

@description('Reviewed derived image with its trusted composition preload, pinned by digest.')
@minLength(1)
param imageRef string

@description('Existing RBAC-enabled Key Vault in the state resource group.')
param keyVaultName string
param keyVaultResourceGroup string

@description('Names only, never secret values. API and pod keys are resolved by ACA with the UAMI.')
@minLength(1)
param secretBindings secretBinding[]

type secretBinding = {
  name: string
  environmentVariable: 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY' | 'AGENT_POD_CLIENT_ID' | 'AGENT_POD_CLIENT_SECRET'
}

var appName = 'agent-daemon-${environment}'
var secretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var secretEnvironment = [for binding in secretBindings: {
  name: binding.environmentVariable
  secretRef: binding.name
}]

resource aca 'Microsoft.App/managedEnvironments@2025-01-01' existing = {
  name: managedEnvironmentName
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
  scope: resourceGroup(keyVaultResourceGroup)
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (enabled) {
  name: '${appName}-identity'
  location: resourceGroup().location
  tags: { environment: environment }
}

// Scope access to the named secrets, not every secret in the shared vault.
module secretAccess './secret-access.bicep' = [for binding in secretBindings: if (enabled) {
  name: '${appName}-${uniqueString(binding.name)}'
  scope: resourceGroup(keyVaultResourceGroup)
  params: {
    vaultName: vault.name
    secretName: binding.name
    principalId: identity!.properties.principalId
    roleDefinitionId: secretsUserRole
  }
}]

resource app 'Microsoft.App/containerApps@2025-01-01' = if (enabled) {
  name: appName
  location: resourceGroup().location
  tags: { environment: environment }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity!.id}': {} }
  }
  properties: {
    managedEnvironmentId: aca.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8080
        transport: 'http'
      }
      secrets: [for binding in secretBindings: {
        name: binding.name
        keyVaultUrl: '${vault.properties.vaultUri}secrets/${binding.name}'
        identity: identity!.id
      }]
    }
    template: {
      terminationGracePeriodSeconds: 120
      containers: [{
        name: 'agent-daemon'
        image: imageRef
        // A missing baked host fails closed. No host code is loaded from the Files mount.
        args: ['--import', '/app/host/compose.mjs', '/app/bin/awp-cloud.mjs']
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: concat([
          { name: 'NODE_ENV', value: 'production' }
          { name: 'AGENT_ENVIRONMENT', value: environment }
          { name: 'AGENT_A2A_ENABLED', value: 'true' }
          { name: 'AGENT_A2A_PORT', value: '8080' }
          { name: 'AGENT_CREDENTIAL_DIR', value: '/var/lib/jeswr-agent' }
          { name: 'AZURE_CLIENT_ID', value: identity!.properties.clientId }
        ], secretEnvironment)
        volumeMounts: [{ volumeName: 'credentials', mountPath: '/var/lib/jeswr-agent' }]
        probes: [
          {
            type: 'Startup'
            httpGet: { path: '/readyz', port: 8080, scheme: 'HTTP' }
            periodSeconds: 5
            failureThreshold: 24
          }
          {
            type: 'Readiness'
            httpGet: { path: '/readyz', port: 8080, scheme: 'HTTP' }
            periodSeconds: 10
          }
          {
            type: 'Liveness'
            httpGet: { path: '/livez', port: 8080, scheme: 'HTTP' }
            periodSeconds: 30
          }
        ]
      }]
      // One process owns a durable exclusive lease. ACA revision overlap also fails closed.
      scale: { minReplicas: 1, maxReplicas: 1 }
      volumes: [{
        name: 'credentials'
        storageType: 'AzureFile'
        storageName: credentialStorageName
        mountOptions: 'uid=65532,gid=65532,dir_mode=0700,file_mode=0600,cache=strict,actimeo=0,nosharesock'
      }]
    }
  }
  dependsOn: [secretAccess]
}
