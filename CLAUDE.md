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

## Architecture Data

All diagram content lives in `src/data/`:

- **nodes.ts** — Every box on the diagram (apps, shared infra, external services, CI/CD). Each node has a `category` and `apps[]` array that drives filtering.
- **edges.ts** — Connections between nodes with color-coded styles per category.
- **annotations.ts** — Click-to-read narrative text for each node. This is where the "why" lives — not just what exists, but why it's architected that way.

To add a new app or infra component: add a node in nodes.ts, wire edges in edges.ts, write an annotation in annotations.ts. The diagram updates automatically.

## Commands

- `npm run dev` — Dev server on port 5505
- `npm run build` — TypeScript check + Vite production build
- `npm run lint` — ESLint

## Change Log

### 2026-04-02

- Created the infra-diagram repo — an interactive architecture documentation site for all romaine.life apps. Motivated by wanting self-documenting, instructional frontends that go beyond static GitHub diagrams. Built with React 19, TypeScript, Vite 8, React Flow, Tailwind v4, React Router, and lucide-react.
- Data model: 7 app nodes, 7 shared infra nodes (DNS, API, Cosmos DB, Key Vault, App Config, managed identity, Container App Env), 5 external service nodes (Entra ID, Raspberry Pi, Blob Storage, Claude Haiku, Hubitat), 3 CI/CD nodes (GitHub Actions, pipeline-templates, infra-bootstrap). Each node carries a category and apps[] array for filtering.
- App filtering: click an app name to highlight its path through infrastructure, dimming unrelated nodes to 15% opacity. URL-routed at /:app for shareability.
- Detail panel: click any node for narrative annotations explaining the "why" behind architectural decisions (e.g., why a single always-on Container App instead of consumption-plan functions, why Cloudflare Tunnel for the Pi).
- Dark slate theme with category color coding: purple (apps), blue (shared), orange (external), green (infra).
- Added OpenTofu infrastructure: Azure SWA (Free tier), DNS CNAME record (`docs.romaine.life`), custom domain with managed certificate. Frontend-only — no backend, database, or auth resources.
- Added CI/CD workflows following the pipeline-templates pattern: `full-stack-deploy.yml` (build + deploy on push to `frontend/`), `tofu.yml` (plan/apply), `lint.yml` (ESLint on PR).
- Added to infra-bootstrap app module `for_each` list — creates GitHub repo, Azure AD app registration, OIDC credentials, and GitHub Actions variables.
- Deployed live at `docs.romaine.life`.
