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
