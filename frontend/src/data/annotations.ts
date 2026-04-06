import type { Annotation } from '../types'

export const annotations: Record<string, Annotation> = {
  'plant-agent': {
    nodeId: 'plant-agent',
    title: 'plant-agent',
    body: `The most complex app in the ecosystem. A Raspberry Pi 5 with a camera module takes photos on a schedule, uploads them to Azure Blob Storage via a Cloudflare Tunnel (pi.romaine.life), and the frontend uses Claude Haiku's vision API to identify plants and assess their health.

The frontend uses sql.js/WASM snapshots for anonymous offline viewing — no login required to browse plants and their history. Admin features (adding plants, triggering photos) require Microsoft auth.

Cosmos DB stores plants, events, analyses, chats, and rooms across five containers, all partitioned by userId.`,
    links: [
      { label: 'GitHub', url: 'https://github.com/nelsong6/plant-agent' },
      { label: 'Live', url: 'https://plants.romaine.life' },
    ],
  },

  'kill-me': {
    nodeId: 'kill-me',
    title: 'kill-me',
    body: `A 12-day Synergy workout tracker. Tracks exercises, sets, reps, and weight across a structured program. Uses the shared API backend at /workout and Cosmos DB (WorkoutTrackerDB).

Like plant-agent, it uses sql.js/WASM snapshots so anyone can view workout history without logging in.`,
    links: [
      { label: 'GitHub', url: 'https://github.com/nelsong6/kill-me' },
      { label: 'Live', url: 'https://kill-me.romaine.life' },
    ],
  },

  investing: {
    nodeId: 'investing',
    title: 'investing',
    body: `Portfolio analysis app. Currently imports data from Ameriprise CSV exports. Future: Plaid API integration for automatic account linking.

Uses the shared API at /investing and Cosmos DB (InvestingDB, portfolios container).`,
    links: [
      { label: 'GitHub', url: 'https://github.com/nelsong6/investing' },
      { label: 'Live', url: 'https://investing.romaine.life' },
    ],
  },

  lights: {
    nodeId: 'lights',
    title: 'lights',
    body: `Smart home control for a Hubitat C-8 Pro hub. Communicates directly with the hub's Maker API over the local network (192.168.50.130) — no cloud relay needed.

Has both a public unauthenticated mode and an admin mode (MSAL). Cosmos DB (LightsDB) is provisioned but reserved for future use.`,
    links: [
      { label: 'GitHub', url: 'https://github.com/nelsong6/lights' },
      { label: 'Live', url: 'https://lights.romaine.life' },
    ],
  },

  'my-homepage': {
    nodeId: 'my-homepage',
    title: 'my-homepage',
    body: `A personal bookmark manager with a fzt WASM terminal for navigation. Terminal-based authentication — a CLI tool on the local machine signs a challenge using platform-bound keys (TPM / Secure Enclave), tied to the OS user account. The shared API verifies the signature and issues a 7-day JWT. The CLI hands the JWT to the browser — no login UI in the app.

Backend at /homepage, data in Cosmos DB (HomepageDB, userdata container).`,
    links: [
      { label: 'GitHub', url: 'https://github.com/nelsong6/my-homepage' },
      { label: 'Live', url: 'https://homepage.romaine.life' },
    ],
  },

  'bender-world': {
    nodeId: 'bender-world',
    title: 'bender-world',
    body: `A Q-learning reinforcement learning visualization. Pure frontend — no backend, no database. The algorithm engine is fully decoupled from React in a separate engine/ directory, making it testable and portable.

Uses @tanstack/react-virtual and react-table for performant rendering of large Q-matrices.`,
    links: [
      { label: 'GitHub', url: 'https://github.com/nelsong6/bender-world' },
      { label: 'Live', url: 'https://bender.romaine.life' },
    ],
  },

  'eight-queens': {
    nodeId: 'eight-queens',
    title: 'eight-queens',
    body: `A genetic algorithm visualizer for the classic 8-queens puzzle. Pure frontend, minimal dependencies. Like bender-world, the algorithm engine is cleanly separated from the UI layer.`,
    links: [
      { label: 'GitHub', url: 'https://github.com/nelsong6/eight-queens' },
      { label: 'Live', url: 'https://queens.romaine.life' },
    ],
  },

  dns: {
    nodeId: 'dns',
    title: 'Azure DNS Zone',
    body: `The romaine.life DNS zone in Azure manages CNAME records for all app subdomains. Each Azure Static Web App gets a CNAME record pointing to its default hostname, plus a custom domain with managed certificate.

Created and managed by infra-bootstrap via OpenTofu.`,
  },

  api: {
    nodeId: 'api',
    title: 'Shared API (api.romaine.life)',
    body: `A consolidated Express.js backend running as an always-on Azure Container App (0.25 vCPU / 0.5 Gi). This eliminates the 30+ second cold starts that plague consumption-plan functions.

Each app mounts its route package under a path prefix: /plant, /workout, /homepage, /investing. Two auth flows: MSAL.js redirect (most apps) and device-based challenge/response (my-homepage). Both produce a self-signed JWT with 7-day expiry.

The decision to consolidate was driven by cost — a single always-on container is cheaper than multiple consumption-plan backends, and the latency improvement is dramatic.`,
  },

  cosmos: {
    nodeId: 'cosmos',
    title: 'Azure Cosmos DB',
    body: `A single Cosmos DB account on the free tier (shared across all apps). Each app gets its own database with dedicated containers:

- PlantAgentDB: plants, events, analyses, chats, rooms
- WorkoutTrackerDB: workouts
- HomepageDB: userdata
- InvestingDB: portfolios
- LightsDB: (reserved)

All containers use /userId as the partition key. The free tier provides 1000 RU/s and 25 GB — more than enough for personal apps.`,
  },

  keyvault: {
    nodeId: 'keyvault',
    title: 'Azure Key Vault',
    body: `Stores sensitive values: Cosmos DB connection strings, Anthropic API keys, JWT signing keys. The shared API accesses secrets via the managed identity — no connection strings in code or config.`,
  },

  appconfig: {
    nodeId: 'appconfig',
    title: 'Azure App Configuration',
    body: `Centralized configuration store for feature flags and app settings. Used by the shared API to manage configuration without redeployment.`,
  },

  'managed-identity': {
    nodeId: 'managed-identity',
    title: 'Managed Identity',
    body: `infra-shared-identity — a user-assigned managed identity with pre-assigned RBAC roles for Key Vault, Cosmos DB, App Configuration, and Blob Storage. Eliminates the need for connection strings or API keys in the Container App.`,
  },

  'container-env': {
    nodeId: 'container-env',
    title: 'Container App Environment',
    body: `The Azure Container App Environment that hosts the shared API. Provides networking, logging, and scaling infrastructure. Currently runs a single container app (the shared API).`,
  },

  entra: {
    nodeId: 'entra',
    title: 'Microsoft Entra ID',
    body: `Most apps use MSAL.js (Microsoft Authentication Library) with the redirect flow. After Microsoft sign-in, the shared API issues a self-signed JWT with a 7-day expiry.

my-homepage has migrated to device-based auth (CLI + platform keys) and no longer uses Entra ID.

The admin email (nelson-devops-project@outlook.com) is the only authorized user for write operations.`,
  },

  'raspberry-pi': {
    nodeId: 'raspberry-pi',
    title: 'Raspberry Pi 5',
    body: `A Raspberry Pi 5 running a FastAPI service with a camera module. Takes scheduled plant photos and uploads them to Azure Blob Storage.

Exposed via a Cloudflare Tunnel at pi.romaine.life — no port forwarding, no static IP needed. The tunnel provides HTTPS and DDoS protection for free.`,
  },

  'blob-storage': {
    nodeId: 'blob-storage',
    title: 'Azure Blob Storage',
    body: `Stores plant photos uploaded by the Raspberry Pi. The plant-agent frontend reads photos directly from blob storage for display.`,
  },

  claude: {
    nodeId: 'claude',
    title: 'Claude Haiku API',
    body: `Anthropic's Claude Haiku model, used for vision-based plant identification and health analysis. The plant-agent backend sends plant photos to the API and stores the analysis results in Cosmos DB.

Uses the cheapest Claude model (Haiku) since the vision task is straightforward — identify the plant species and assess health from a photo.`,
  },

  hubitat: {
    nodeId: 'hubitat',
    title: 'Hubitat C-8 Pro',
    body: `A local smart home hub at 192.168.50.130. The lights app communicates directly with the hub's Maker API over the local network — no cloud dependency.

Controls the "Living room - All" group dimmer (device 96) and other devices. The local-only design means lights work even if the internet is down.`,
  },

  'client-devices': {
    nodeId: 'client-devices',
    title: 'Client Devices',
    body: `Local machines (Windows, macOS, Ubuntu) running a CLI auth tool. Each device has a key pair in the platform's secure hardware store (Windows Hello/TPM, macOS Secure Enclave). The private key is bound to the OS user account — it can only be used when logged in as that user.

One-time setup per machine: generate a key pair and register the public key with the API. After that, authentication is automatic — the CLI signs a challenge from the API, proving the user holds the private key without ever transmitting it.`,
  },

  'github-actions': {
    nodeId: 'github-actions',
    title: 'GitHub Actions',
    body: `CI/CD for all repos. Uses OIDC-based Azure auth with federated credentials — no stored secrets. Each repo has workflows for frontend deploy, infrastructure (OpenTofu plan/apply), and linting.`,
  },

  'pipeline-templates': {
    nodeId: 'pipeline-templates',
    title: 'pipeline-templates',
    body: `A shared repo of reusable GitHub Actions workflows. All app repos reference these templates (nelsong6/pipeline-templates@main) instead of duplicating workflow logic.

Includes templates for: tofu-outputs (fetch infrastructure outputs), SWA deployment, OpenTofu plan/apply, and lock file management.`,
    links: [
      { label: 'GitHub', url: 'https://github.com/nelsong6/pipeline-templates' },
    ],
  },

  'infra-bootstrap': {
    nodeId: 'infra-bootstrap',
    title: 'infra-bootstrap',
    body: `The root infrastructure repo. Uses OpenTofu (Terraform) to create all shared resources: Container App Environment, Cosmos DB account, Azure DNS zone, Key Vault, App Configuration, and the managed identity.

Also manages per-app resources: Azure AD app registrations, service principals, GitHub Actions variables, and OIDC federated credentials. Adding a new app means adding it to the for_each map in main.tf.`,
    links: [
      { label: 'GitHub', url: 'https://github.com/nelsong6/infra-bootstrap' },
    ],
  },
}
