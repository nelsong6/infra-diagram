# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Overview

diagrams is an interactive architecture documentation site (at `diagrams.romaine.life`) for Nelson's Azure app ecosystem at romaine.life. It uses React Flow to visualize how all apps connect to shared infrastructure (Cosmos DB, shared API, DNS, Key Vault, etc.) with per-app filtering and clickable annotations.

**Read `D:/shell-config/setup/claude/CLAUDE.md` for global Claude config, profile dispatch, skills, and memory rules.**

## Tech Stack

- React 19, TypeScript, Vite 8
- Tailwind CSS v4 (`@tailwindcss/postcss`)
- React Flow (`@xyflow/react`) for interactive diagrams
- React Router for URL-based app filtering
- lucide-react for icons

## Project Structure

```
frontend/src/
  components/     React components (DiagramView, AppNode, InfraNode, DetailPanel, AppFilter)
  data/           Architecture data (nodes.ts, edges.ts, annotations.ts)
  types.ts        Shared TypeScript types
  index.css       Tailwind v4 + React Flow dark theme overrides
tofu/             OpenTofu IaC — SWA (Free), DNS CNAME (diagrams.romaine.life), custom domain
.github/workflows/
  full-stack-deploy.yml   Build + deploy frontend to SWA on push to frontend/
  tofu.yml                Plan on PR, apply on merge to tofu/
  lint.yml                ESLint on PR
```

## Views

- **`/`** — Main infrastructure diagram (React Flow) showing apps, shared infra, external services, CI/CD
- **`/:app`** — Filtered view highlighting a single app's path through infrastructure
- **`/pipelines`** — Pipeline dependency diagram showing cross-repo CI/CD chains (fzt → my-homepage/fzt-showcase → api) with the dispatch/artifact flow and the lockfile gap issue node
- **`/ci`** — Live CI dashboard (all repos). Push-based via GitHub App webhooks + SSE
- **`/ci/fzt`** — fzt asset cascade post-split. Direct go.mod edges: `fzt` → `fzt-frontend`/`fzt-terminal`/`fzt-browser`/`fzt-automate`/`fzt-picker` (every consumer direct-imports `fzt`), `fzt-frontend` → `fzt-terminal`, `fzt-terminal` → `fzt-browser`/`fzt-automate`/`fzt-picker`. Release-artifact edges: `fzt-browser` → `my-homepage`/`fzt-showcase` (web bundle downloaded via `gh release download` in each consumer's deploy workflow, not a go.mod require). Horizontal layer-to-layer flow; packages stacked vertically inside each container. The `check-ci` skill encodes this graph for API-side verification. A small cascade grammar badge under the title mirrors that skill — green when every edge has matching producer/consumer versions, yellow if any cascade pipeline is in progress, red on unknown/mismatch with the failing edges listed in a hover tooltip.
- **`/ci/api`** — Route dispatch chain: host repos at top, API container box below with route package boxes inside. Manual layout (no ELK). Shows version comparison between published and deployed package versions. The `check-ci-api` skill encodes this view's grammar (no unknowns, no mismatches, no orphaned deployed packages) for API-side verification. A small cascade grammar badge under the title mirrors that skill — green when every host's published package version matches the api's deployed version with no orphans, yellow if any host or api pipeline is in progress, red on unknown/mismatch/orphan with the failures listed in a hover tooltip. Same visual language as the `/ci/fzt` badge.
- **`/ci/tofu`** — Infrastructure repos: infra-bootstrap, api, diagrams, house-hunt, landing-page, emotions-mcp

CI dashboard uses ELK (elkjs) for automatic node positioning and edge routing. Nodes are bottom-aligned per layer with dynamic heights. Webhook events from the `romaine-life-app` GitHub App flow through `api.romaine.life/ci/webhook` → SSE → browser. Cold start backfills from the GitHub API.

## Routes (`backend/routes/`)

`createCIRoutes({ webhookSecret, githubAppId, githubAppPrivateKey, installedPackages })` returns an Express Router mounted at `/ci/*` in this app's own backend. Handles GitHub webhook events + SSE stream for the CI dashboard.

All state is in-memory (lost on API restart). Five Maps: `runs` (pipeline runs keyed by `repo/runId`), `versions` (latest GitHub release per repo), `packageVersions` (latest published route package version per repo), `deployedVersions` (live deployed version per repo), `versionErrors` (backfill failures per repo). Runs older than 2 hours are pruned on each webhook event.

### Auth

GitHub API calls (backfill, npm registry) use GitHub App installation tokens generated from `github-app-id` and `github-app-private-key` Key Vault secrets (the `romaine-life-app` GitHub App — secrets are tagged with the app name for discoverability). Tokens are generated once per backfill cycle via native `crypto.createSign` (RS256 JWT → installation access token). No PAT.

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/webhook` | GitHub App webhook receiver. HMAC-verified (`x-hub-signature-256`). Handles `workflow_run` events (pipeline status) and `release` events (published versions). Broadcasts to SSE clients. Filters out Dependabot runs. |
| GET | `/events` | SSE stream. Sends `init` (full snapshot including `packageVersions` and `versionErrors`), then `update` (run changes), `version` (releases), `packageVersion` (route package publishes), `deployed` (deploy reports). Triggers cold-start backfill on first connection. 30s keepalive. |
| GET | `/status` | JSON snapshot of current runs + connected client count. |
| GET | `/versions` | JSON snapshot of releases, packages, and deployed versions. |
| POST | `/published` | Source repos POST `{ repoName, version }` after publishing a route package. Stored in `packageVersions`, broadcast as `packageVersion` SSE event. |
| POST | `/deployed` | Deploy report endpoint. Consumer sites POST `{ site, repo, versions }` after deploy to register their live versions. |

### Cold-start backfill

On first SSE connection, two backfill functions run in parallel:

- `backfillFromGitHub()` — fetches the 5 most recent `main`-branch runs per repo from the GitHub API (14 repos).
- `backfillVersions()` — fetches latest GitHub release per repo, latest route package version per publisher from the GitHub Packages API (`/users/nelsong6/packages/npm/{name}/versions`), and `version.json` from each frontend site URL. Failures are recorded in `versionErrors` and surfaced on dashboard nodes.

Both use shared Promises to prevent concurrent SSE connections from racing. The `installedPackages` option pre-populates the API's deployed route package versions from its `package-lock.json` at startup (no network call needed).

### Monitored repos

`fzt`, `fzt-frontend`, `fzt-terminal`, `fzt-browser`, `fzt-automate`, `fzt-picker`, `my-homepage`, `fzt-showcase`, `kill-me`, `plant-agent`, `investing`, `house-hunt`, `diagrams`, `api`, `infra-bootstrap`, `landing-page`, `emotions-mcp`, `llm-explorer`.

When a new app joins the dashboard, two lists must be updated: `REPOS` + `ROUTE_PACKAGES` in `backend/routes/ci.js` (for backfill), AND `apiHostRepos` + `routePackageMap` + `overviewRepos` + `overviewEdges` in `frontend/src/data/ci-views.ts` (for dashboard rendering). A deployed package without a host row on `/ci/api` is a silent orphan caught by the `check-ci-api` skill.

`SITE_URLS` in `ci.js` is separate — only include a repo there if it actually serves `/version.json`. Sites that don't (like `landing-page`) will produce persistent `version error` entries on the dashboard if included.

## Navigation

`NavSidebar` component — persistent collapsible right-side panel with route list grouped by section. Present on all pages. Footer fetches `/version.json` (written at deploy time by `full-stack-deploy.yml`) and renders the 7-char SHA linked to the GitHub commit plus a relative timestamp ticking every 60s. The footer hides if `/version.json` 404s (dev mode); `frontend/public/version.json` is gitignored so dev fixtures don't get committed.

## Architecture Data

All diagram content lives in `src/data/`:

- **nodes.ts** — Every box on the diagram (apps, shared infra, external services, CI/CD). Each node has a `category` and `apps[]` array that drives filtering.
- **edges.ts** — Connections between nodes with color-coded styles per category.
- **annotations.ts** — Click-to-read narrative text for each node. This is where the "why" lives — not just what exists, but why it's architected that way.
- **pipeline-nodes.ts** — Nodes for the `/pipelines` view (repos, workflows, artifacts, issues).
- **pipeline-edges.ts** — Edges for the `/pipelines` view with color-coded styles: amber (dispatch), blue (internal), purple (artifact), red dashed (broken).

To add a new app or infra component: add a node in nodes.ts, wire edges in edges.ts, write an annotation in annotations.ts. The diagram updates automatically.

## Commands

- `npm run dev` — Dev server on port 5505
- `npm run build` — TypeScript check + Vite production build
- `npm run lint` — ESLint

## Change Log

### 2026-04-15

1. **Route package documentation** -- Expanded the CLAUDE.md "Route Package" section from a one-liner to a full reference: route table, in-memory state model (3 Maps), cold-start backfill mechanics, and monitored repo list. Motivated by the package growing beyond a quick summary.
2. **Fixed cold-start backfill race condition** (`packages/routes/ci.js`) -- The `backfilled` boolean flag was set synchronously before async fetches completed. A second SSE client connecting mid-backfill skipped it entirely and got an empty `init` snapshot. Fix: replaced the boolean with a shared Promise (`backfillPromise`) so concurrent callers all await the same fetch.
3. **Fixed backfill over-pruning** (`packages/routes/ci.js`) -- The 2-hour run cutoff ran immediately after backfill, deleting all fetched runs during quiet periods (no pushes in 2+ hours). Removed post-backfill pruning — webhook events still prune on arrival, which is the appropriate trigger.
4. **Added missing-token warning** (`packages/routes/ci.js`) -- `console.warn` when `githubToken` is not configured, making the silent backfill skip visible in API logs.
5. **API container view for `/ci/api`** -- Redesigned the API CI view from a flat node layout to a two-tier container layout. Host repos at the top, a large dashed-border API container below spanning all hosts, with route package boxes inside. Straight edges from each host to its package. Manual positioning (no ELK) since the layout is deterministic. New components: `CIApiContainerView`, `CIContainerNode`, `CIPackageNode`. Package deployed versions shown when available via the `/ci/deployed` endpoint.
6. **Picker edge in fzt view** -- Added `['fzt-terminal', 'picker']` to `fztEdges` so picker is no longer an island on `/ci/fzt`. Depicts the consumer relationship (picker uses the fzt-automate binary from fzt-terminal releases).
