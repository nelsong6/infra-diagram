export interface DispatchEdge {
  source: string
  target: string
}

// ── tofu view ───────────────────────────────────────────────
// Infrastructure repos with tofu/ directories

export const tofuRepos = [
  'infra-bootstrap', 'diagrams',
  'house-hunt', 'landing-page', 'emotions-mcp',
]

export const tofuEdges: DispatchEdge[] = []

// ── overview (all repos) ────────────────────────────────────

export const overviewRepos = [
  'fzt', 'fzt-frontend', 'fzt-terminal', 'fzt-browser', 'fzt-automate',
  'my-homepage', 'fzt-showcase', 'fzt-picker',
  'kill-me', 'plant-agent', 'investing', 'house-hunt',
  'diagrams', 'llm-explorer',
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
]
