# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Overview

infra-diagram is an interactive architecture documentation site for Nelson's Azure app ecosystem at romaine.life. It uses React Flow to visualize how all apps connect to shared infrastructure (Cosmos DB, shared API, DNS, Key Vault, etc.) with per-app filtering and clickable annotations.

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
tofu/             OpenTofu IaC — SWA (Free), DNS CNAME (docs.romaine.life), custom domain
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
- **`/ci/fzt`** — fzt asset cascade: fzt → fzt-terminal → my-homepage, fzt-showcase, picker
- **`/ci/api`** — Route dispatch chain: app repos → api
- **`/ci/tofu`** — Infrastructure repos: infra-bootstrap, api, infra-diagram, house-hunt, landing-page, emotions-mcp

CI dashboard uses ELK (elkjs) for automatic node positioning and edge routing. Nodes are bottom-aligned per layer with dynamic heights. Webhook events from the `romaine-life-app` GitHub App flow through `api.romaine.life/ci/webhook` → SSE → browser. Cold start backfills from the GitHub API.

## Route Package

`packages/routes/` publishes `@nelsong6/infra-diagram-routes` to GitHub Packages. Mounted at `/ci` in the shared API. Entry point: `index.js` re-exports `createCIRoutes({ webhookSecret, githubToken })`.

All state is in-memory (lost on API restart). Three Maps: `runs` (pipeline runs keyed by `repo/runId`), `versions` (latest published version per repo), `deployedVersions` (live deployed version per repo). Runs older than 2 hours are pruned on each webhook event and after backfill.

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/webhook` | GitHub App webhook receiver. HMAC-verified (`x-hub-signature-256`). Handles `workflow_run` events (pipeline status) and `release` events (published versions). Broadcasts to SSE clients. Filters out Dependabot runs. |
| GET | `/events` | SSE stream. Sends `init` (full snapshot), then `update` (run changes), `version` (releases), `deployed` (deploy reports). Triggers cold-start backfill on first connection. 30s keepalive. |
| GET | `/status` | JSON snapshot of current runs + connected client count. |
| GET | `/versions` | JSON snapshot of published + deployed versions. |
| POST | `/deployed` | Deploy report endpoint. Consumer sites POST `{ site, repo, versions }` after deploy to register their live versions. |

### Cold-start backfill

On first SSE connection, `backfillFromGitHub()` fetches the 5 most recent `main`-branch runs per repo from the GitHub API (14 repos). Requires `githubToken`. The `backfilled` flag prevents re-fetching. Backfill runs are not broadcast — they populate `runs` silently and are included in the `init` snapshot sent to the triggering client.

### Monitored repos

`fzt`, `fzt-terminal`, `my-homepage`, `fzt-showcase`, `kill-me`, `plant-agent`, `investing`, `house-hunt`, `infra-diagram`, `api`, `infra-bootstrap`, `picker`, `landing-page`, `emotions-mcp`.

## Navigation

`NavSidebar` component — persistent collapsible right-side panel with route list grouped by section. Present on all pages.

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
