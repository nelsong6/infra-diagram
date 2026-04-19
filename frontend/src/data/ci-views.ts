export interface DispatchEdge {
  source: string
  target: string
}

// ── api container view ──────────────────────────────────────
// Host repos that publish route packages to the shared API

export const apiHostRepos = [
  'my-homepage', 'fzt-frontend', 'diagrams',
  'kill-me', 'plant-agent', 'investing', 'house-hunt',
  'llm-explorer',
]

export const routePackageMap: Record<string, string> = {
  'my-homepage': 'my-homepage-routes',
  'fzt-frontend': 'fzt-frontend-routes',
  'diagrams': 'diagrams-routes',
  'kill-me': 'kill-me-routes',
  'plant-agent': 'plant-agent-routes',
  'investing': 'investing-routes',
  'house-hunt': 'house-hunt-routes',
  'llm-explorer': 'llm-explorer-routes',
}

// ── tofu view ───────────────────────────────────────────────
// Infrastructure repos with tofu/ directories

export const tofuRepos = [
  'infra-bootstrap', 'api', 'diagrams',
  'house-hunt', 'landing-page', 'emotions-mcp',
]

export const tofuEdges: DispatchEdge[] = []

// ── overview (all repos) ────────────────────────────────────

export const overviewRepos = [
  'fzt', 'fzt-frontend', 'fzt-terminal', 'fzt-browser', 'fzt-automate',
  'my-homepage', 'fzt-showcase', 'fzt-picker',
  'kill-me', 'plant-agent', 'investing', 'house-hunt',
  'diagrams', 'api', 'llm-explorer',
  'infra-bootstrap', 'landing-page', 'emotions-mcp',
]

export const overviewEdges: DispatchEdge[] = [
  { source: 'fzt', target: 'fzt-frontend' },
  { source: 'fzt-frontend', target: 'fzt-terminal' },
  { source: 'fzt-terminal', target: 'fzt-browser' },
  { source: 'fzt-terminal', target: 'fzt-automate' },
  { source: 'fzt-terminal', target: 'fzt-picker' },
  { source: 'fzt-browser', target: 'my-homepage' },
  { source: 'fzt-browser', target: 'fzt-showcase' },
  { source: 'fzt-terminal', target: 'api' },
  { source: 'my-homepage', target: 'api' },
  { source: 'kill-me', target: 'api' },
  { source: 'plant-agent', target: 'api' },
  { source: 'investing', target: 'api' },
  { source: 'house-hunt', target: 'api' },
  { source: 'diagrams', target: 'api' },
  { source: 'llm-explorer', target: 'api' },
]
