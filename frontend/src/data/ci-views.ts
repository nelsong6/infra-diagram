import type { RepoPosition, DispatchEdge } from '../components/CIView'

const W = 260
const H = 160

// ── fzt view ────────────────────────────────────────────────
// fzt engine → fzt-terminal → consumers (homepage, showcase, picker)

export const fztLayout: RepoPosition[] = [
  { id: 'fzt', x: W, y: 0 },
  { id: 'fzt-terminal', x: W, y: H },
  { id: 'my-homepage', x: 0, y: H * 2 },
  { id: 'fzt-showcase', x: W, y: H * 2 },
  { id: 'picker', x: W * 2, y: H * 2 },
]

export const fztEdges: DispatchEdge[] = [
  ['fzt', 'fzt-terminal'],
  ['fzt-terminal', 'my-homepage'],
  ['fzt-terminal', 'fzt-showcase'],
]

// ── api view ────────────────────────────────────────────────
// App repos publish route packages → dispatch → api rebuilds

export const apiLayout: RepoPosition[] = [
  { id: 'my-homepage', x: 0, y: 0 },
  { id: 'fzt-terminal', x: W, y: 0 },
  { id: 'infra-diagram', x: W * 2, y: 0 },
  { id: 'kill-me', x: 0, y: H },
  { id: 'plant-agent', x: W, y: H },
  { id: 'investing', x: W * 2, y: H },
  { id: 'house-hunt', x: W * 3, y: H },
  { id: 'api', x: W * 1.5, y: H * 2 },
]

export const apiEdges: DispatchEdge[] = [
  ['my-homepage', 'api'],
  ['fzt-terminal', 'api'],
  ['infra-diagram', 'api'],
  ['kill-me', 'api'],
  ['plant-agent', 'api'],
  ['investing', 'api'],
  ['house-hunt', 'api'],
]

// ── tofu view ───────────────────────────────────────────────
// Infrastructure repos with tofu/ directories

export const tofuLayout: RepoPosition[] = [
  { id: 'infra-bootstrap', x: W, y: 0 },
  { id: 'api', x: 0, y: H },
  { id: 'infra-diagram', x: W, y: H },
  { id: 'house-hunt', x: W * 2, y: H },
  { id: 'landing-page', x: 0, y: H * 2 },
  { id: 'emotions-mcp', x: W, y: H * 2 },
]

export const tofuEdges: DispatchEdge[] = []

// ── overview (all repos) ────────────────────────────────────

export const overviewLayout: RepoPosition[] = [
  { id: 'fzt', x: W * 1.5, y: 0 },
  { id: 'fzt-terminal', x: W * 1.5, y: H },
  { id: 'my-homepage', x: 0, y: H * 2 },
  { id: 'fzt-showcase', x: W * 1.5, y: H * 2 },
  { id: 'infra-diagram', x: W * 3, y: H * 2 },
  { id: 'kill-me', x: 0, y: H * 3 },
  { id: 'plant-agent', x: W, y: H * 3 },
  { id: 'investing', x: W * 2, y: H * 3 },
  { id: 'house-hunt', x: W * 3, y: H * 3 },
  { id: 'api', x: W * 1.5, y: H * 4 },
  { id: 'infra-bootstrap', x: 0, y: H * 5.5 },
  { id: 'picker', x: W, y: H * 5.5 },
  { id: 'landing-page', x: W * 2, y: H * 5.5 },
  { id: 'emotions-mcp', x: W * 3, y: H * 5.5 },
]

export const overviewEdges: DispatchEdge[] = [
  ['fzt', 'fzt-terminal'],
  ['fzt-terminal', 'my-homepage'],
  ['fzt-terminal', 'fzt-showcase'],
  ['fzt-terminal', 'api'],
  ['my-homepage', 'api'],
  ['kill-me', 'api'],
  ['plant-agent', 'api'],
  ['investing', 'api'],
  ['house-hunt', 'api'],
  ['infra-diagram', 'api'],
]
