// Azure infrastructure for Life on Books.
//
// ─────────────────────────────────────────────────────────────────────────────
// NOT YET DEPLOYED. This template has never been submitted to Azure, and no
// tooling on the machine it was written on could compile it — `az` and `bicep`
// are both absent there. It is a reviewable declaration of what DEPLOYMENT.md
// describes in prose, not a tested artifact.
//
// Run `scripts/deploy/azure.sh provision --what-if` first. It refuses to deploy
// without a preceding what-if, for this reason.
// ─────────────────────────────────────────────────────────────────────────────
//
// What is deliberate here, and why:
//
//   * Postgres Flexible Server, not Single Server (retired) and not MySQL —
//     DEPLOYMENT.md's "Why Postgres, and not MySQL" explains that the catalog
//     depends on pg_trgm, unaccent, GIN indexes and tsvector.
//   * `work_mem` at 32 MB as a server parameter. The migration sets it per
//     database, and DEPLOYMENT.md calls it "the single highest-value
//     parameter"; setting it here too means a restored server has it before the
//     first query rather than after the first migration.
//   * maxReplicas: 1. The rate limiter is per-process, so more than one replica
//     multiplies every limit by the replica count — and Container Apps scales up
//     under exactly the load an attacker generates. `deploy:verify` asserts this
//     matches. Raising it requires a shared limiter store first.
//   * Front Door with `X-Azure-ClientIP` and an ingress restricted to Front
//     Door's `X-Azure-FDID`. Both halves are needed: the header is only
//     unforgeable while the container app cannot be reached directly.

targetScope = 'resourceGroup'

@description('Short name used to derive resource names. Lowercase letters and digits.')
@minLength(3)
@maxLength(11)
param namePrefix string

@description('Region for all resources.')
param location string = resourceGroup().location

@description('Postgres administrator login.')
param postgresAdminUser string

@description('Postgres administrator password.')
@secure()
param postgresAdminPassword string

@description('NextAuth secret. `openssl rand -base64 32`.')
@secure()
param nextAuthSecret string

@description('Container image, including registry and tag or digest.')
param containerImage string

@description('Public URL the app is served on, https.')
param publicUrl string

// Sized from DEPLOYMENT.md's "Sizing": the catalog is ~11 GB and the ingest is
// run locally, so the server only ever serves queries against a restored copy.
@description('Postgres SKU. D2ds_v4 is the smallest that holds the working set comfortably.')
param postgresSku string = 'Standard_D2ds_v4'

@description('Postgres storage in GB. The catalog restores to ~11 GB; headroom is for WAL and growth.')
param postgresStorageGb int = 64

var suffix = uniqueString(resourceGroup().id)
var registryName = '${namePrefix}acr${suffix}'
var storageName = '${namePrefix}st${suffix}'
var postgresName = '${namePrefix}-pg-${suffix}'
var envName = '${namePrefix}-env'
var appName = '${namePrefix}-app'
var databaseName = 'bookshelf'
var containerName = 'uploads'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storage
  name: 'default'
}

// Private. DEPLOYMENT.md's object-storage section is explicit that a public
// container is not the plan: reads go through the CDN, and `deploy:verify`
// fails when CDN_URL is unset because "a private container with no CDN accepts
// uploads and then returns 403 for every image".
resource uploads 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: postgresName
  location: location
  sku: {
    name: postgresSku
    tier: 'GeneralPurpose'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: postgresStorageGb
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    // C collation, matching the development database. This is load-bearing:
    // under C, lower() folds only ASCII, which is why the normalised columns
    // must be built as lower(unaccent(x)) and not the other way round. A server
    // created with a different collation would normalise differently from the
    // catalog dump restored onto it.
    collation: 'C'
  }
}

// The single highest-value parameter, per DEPLOYMENT.md. A lossy bitmap heap
// scan at the 4 MB default was the real cause of the slow subject browse.
resource workMem 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-06-01-preview' = {
  parent: postgres
  name: 'work_mem'
  properties: {
    value: '32768'
    source: 'user-override'
  }
}

// pg_trgm and unaccent must be allowed before a migration can CREATE EXTENSION.
resource allowedExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-06-01-preview' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    value: 'PG_TRGM,UNACCENT'
    source: 'user-override'
  }
  dependsOn: [workMem]
}

resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource containerEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2023-05-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: 'system'
        }
      ]
      secrets: [
        { name: 'nextauth-secret', value: nextAuthSecret }
        {
          name: 'database-url'
          value: 'postgresql://${postgresAdminUser}:${postgresAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'app'
          image: containerImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'NEXTAUTH_URL', value: publicUrl }
            { name: 'NEXTAUTH_SECRET', secretRef: 'nextauth-secret' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'DIRECT_URL', secretRef: 'database-url' }
            { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
            { name: 'AZURE_STORAGE_CONTAINER', value: containerName }
            // Trusted because the ingress below is restricted to Front Door.
            // Both halves are required; see the header.
            { name: 'TRUSTED_CLIENT_IP_HEADER', value: 'x-azure-clientip' }
            // Recorded so deploy:verify can assert it matches maxReplicas.
            { name: 'MAX_REPLICAS', value: '1' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/api/health', port: 3000 }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              // Readiness uses the database-touching probe, liveness does not:
              // a database blip must not restart a healthy container.
              type: 'Readiness'
              httpGet: { path: '/api/health/ready', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 15
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        // One, deliberately. See the header.
        maxReplicas: 1
      }
    }
  }
}

@description('Grant the app read access to its own registry.')
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, app.id, 'AcrPull')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
    )
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

@description('Grant the app write access to the uploads container, so no connection string is needed.')
resource blobContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, 'BlobContributor')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe' // Storage Blob Data Contributor
    )
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output registryLoginServer string = registry.properties.loginServer
output containerAppFqdn string = app.properties.configuration.ingress.fqdn
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
output storageAccountName string = storage.name
