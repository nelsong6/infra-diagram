import { useState, useMemo, useEffect, useRef } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useSSE } from '../hooks/useSSE'
import CICascadeNodeComponent, {
  type CICascadeData,
  CASCADE_PKG_HEIGHT,
  CASCADE_PKG_PADDING,
  CASCADE_TITLE_HEIGHT,
} from './CICascadeNode'
import CIPackageNodeComponent from './CIPackageNode'
import { edgeStyle, edgeMarker, aggregateHealth, type EdgeHealth } from './ciEdgeStyle'
import type { CIRun, PublishedVersion, DeployedVersion, ConnectionStatus } from '../types/ci'

const nodeTypes = {
  cascade: CICascadeNodeComponent,
  'cascade-pkg': CIPackageNodeComponent,
}

// Layout: layers arranged LEFT→RIGHT (engine → apps). Containers within a
// layer stack vertically. Inside each container the pkg boxes remain TOP
// (consumed) / BOTTOM (provided) for vertical compactness. Edges between
// adjacent layers bezier-curve from a producer's bottom handle over to the
// next layer and into the consumer's top handle.
const NODE_WIDTH = 240
const PKG_WIDTH = 200
const PKG_INSET = (NODE_WIDTH - PKG_WIDTH) / 2
const LAYER_GAP = 100     // horizontal gap between layers (room for the curves)
const NODE_GAP = 50       // vertical gap between stacked nodes in a layer

// Row 3 — middle consumers. All three produce release artifacts (consumed
// by external things: apps, shell wrappers, file-dialog hooks).
const MIDDLE_CONSUMERS = [
  { id: 'fzt-browser', label: 'fzt-browser', providesRelease: true },
  { id: 'fzt-automate', label: 'fzt-automate', providesRelease: true },
  { id: 'fzt-picker', label: 'fzt-picker', providesRelease: true },
] as const

// Row 4 — app consumers (download from fzt-browser release).
const APP_CONSUMERS = [
  { id: 'my-homepage', label: 'my-homepage' },
  { id: 'fzt-showcase', label: 'fzt-showcase' },
] as const

// Edges the cascade must satisfy: producer's release version must equal the
// consumer's pinned version for `field`. Mirrors the check-ci skill — keep the
// two in sync. Consumer key is the simple repo name (matches `useSSE` keying).
const VERIFICATION_EDGES: ReadonlyArray<readonly [string, string, string]> = [
  ['fzt',          'fzt-frontend', 'fzt'],
  ['fzt',          'fzt-terminal', 'fzt'],
  ['fzt-frontend', 'fzt-terminal', 'fztFrontend'],
  ['fzt-terminal', 'fzt-browser',  'fztTerminal'],
  ['fzt-terminal', 'fzt-automate', 'fztTerminal'],
  ['fzt-terminal', 'fzt-picker',   'fztTerminal'],
  ['fzt-browser',  'my-homepage',  'fztBrowser'],
  ['fzt-browser',  'fzt-showcase', 'fztBrowser'],
] as const

const FZT_CASCADE_REPOS = new Set([
  'fzt', 'fzt-frontend', 'fzt-terminal', 'fzt-browser',
  'fzt-automate', 'fzt-picker', 'my-homepage', 'fzt-showcase',
])

type GrammarStatus = 'pass' | 'pending' | 'fail'

interface GrammarResult {
  status: GrammarStatus
  failures: string[]
  // Per-edge health keyed by `${producer}|${consumer}|${field}`. Used to
  // color edges + aggregate to per-node health.
  edgeHealths: Map<string, EdgeHealth>
  // Repos currently running a cascade pipeline. Used by nodeHealth to
  // decide whether incident-edge "active" state propagates to the node
  // (only when the node itself is running — otherwise downstream cascade
  // bleeds amber up to finished producers).
  activeRepos: Set<string>
}

function edgeKey(producer: string, consumer: string, field: string): string {
  return `${producer}|${consumer}|${field}`
}

function checkGrammar(
  runs: Map<string, CIRun>,
  versions: Map<string, PublishedVersion>,
  deployed: Map<string, DeployedVersion>,
): GrammarResult {
  const activeRepos = new Set<string>()
  const reposWithRuns = new Set<string>()
  for (const run of runs.values()) {
    if (!FZT_CASCADE_REPOS.has(run.repoName)) continue
    reposWithRuns.add(run.repoName)
    if (run.status === 'in_progress' || run.status === 'queued') {
      activeRepos.add(run.repoName)
    }
  }

  const failures: string[] = []
  const edgeHealths = new Map<string, EdgeHealth>()
  // Dedupe "no recent runs" failures so we report each repo once rather than
  // once per incident edge.
  const reportedMissingRuns = new Set<string>()
  const reportMissing = (repo: string) => {
    if (!reportedMissingRuns.has(repo)) {
      failures.push(`no recent runs: ${repo}`)
      reportedMissingRuns.add(repo)
    }
  }

  for (const [producer, consumer, field] of VERIFICATION_EDGES) {
    const key = edgeKey(producer, consumer, field)

    if (activeRepos.has(producer) || activeRepos.has(consumer)) {
      edgeHealths.set(key, 'active')
      continue
    }

    // "No recent runs" on either endpoint is a broken signal — matching
    // versions without CI evidence is not healthy, it's unverified. The
    // API prunes runs older than 2h, so this demotes any endpoint that
    // hasn't had activity in that window.
    if (!reposWithRuns.has(producer)) {
      reportMissing(producer)
      edgeHealths.set(key, 'broken')
      continue
    }
    if (!reposWithRuns.has(consumer)) {
      reportMissing(consumer)
      edgeHealths.set(key, 'broken')
      continue
    }

    const prodVer = versions.get(producer)?.version
    const consVer = deployed.get(consumer)?.versions?.[field]

    if (!prodVer) {
      failures.push(`unknown: ${producer} has no release`)
      edgeHealths.set(key, 'broken')
      continue
    }
    if (!consVer) {
      failures.push(`unknown: ${consumer}.${field} missing (producer ${producer}@${prodVer})`)
      edgeHealths.set(key, 'broken')
      continue
    }
    if (consVer !== prodVer) {
      failures.push(`mismatch: ${producer}@${prodVer} ≠ ${consumer}.${field}@${consVer}`)
      edgeHealths.set(key, 'broken')
      continue
    }
    edgeHealths.set(key, 'healthy')
  }

  const status: GrammarStatus =
    activeRepos.size > 0 ? 'pending'
    : failures.length === 0 ? 'pass'
    : 'fail'
  return { status, failures, edgeHealths, activeRepos }
}

// Aggregate health of all verification edges incident to `repo` (as producer
// or consumer). Worst-state-wins so broken links aren't hidden.
//
// `active` edge states are filtered out unless the repo itself is running —
// otherwise a downstream cascade bleeds amber up to a finished producer and
// contradicts its own success badge (diagrams#7).
function nodeHealth(repo: string, edgeHealths: Map<string, EdgeHealth>, activeRepos: Set<string>): EdgeHealth {
  const incident: EdgeHealth[] = []
  const ownRunIsActive = activeRepos.has(repo)
  for (const [producer, consumer, field] of VERIFICATION_EDGES) {
    if (producer !== repo && consumer !== repo) continue
    const h = edgeHealths.get(edgeKey(producer, consumer, field))
    if (!h) continue
    if (h === 'active' && !ownRunIsActive) continue
    incident.push(h)
  }
  return aggregateHealth(incident)
}

function containerHeight(hasConsumed: boolean, hasProvided: boolean): number {
  let h = CASCADE_TITLE_HEIGHT
  if (hasConsumed) h += CASCADE_PKG_HEIGHT + CASCADE_PKG_PADDING * 2
  if (hasProvided) h += CASCADE_PKG_HEIGHT + CASCADE_PKG_PADDING * 2
  if (!hasProvided) h += CASCADE_PKG_PADDING
  return h
}

// y of the CONSUMED pkg inside its container (always the top slot).
const CONSUMED_Y = CASCADE_PKG_PADDING

// y of the PROVIDED pkg inside its container. Sits below the title, with
// the title's position depending on whether there's a consumed pkg above it.
function providedY(hasConsumed: boolean): number {
  if (hasConsumed) {
    return CASCADE_PKG_HEIGHT + CASCADE_PKG_PADDING * 2 + CASCADE_TITLE_HEIGHT + CASCADE_PKG_PADDING
  }
  return CASCADE_TITLE_HEIGHT + CASCADE_PKG_PADDING
}

function buildLayout(
  runsByRepo: Map<string, CIRun[]>,
  versions: Map<string, PublishedVersion>,
  deployed: Map<string, DeployedVersion>,
  edgeHealths: Map<string, EdgeHealth>,
  activeRepos: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Precompute container heights per layer
  const fztH = containerHeight(false, true)
  const feH = containerHeight(true, true)
  const termH = containerHeight(true, true)
  const midH = containerHeight(true, true)  // all middle consumers provide releases
  const appH = containerHeight(true, false)

  // Layer x-offsets (left edges), cumulative
  const layerX = [0, 1, 2, 3, 4].map(i => i * (NODE_WIDTH + LAYER_GAP))

  // Total canvas height to center layers on — the tallest layer wins.
  const midLayerHeight = MIDDLE_CONSUMERS.length * (midH + NODE_GAP) - NODE_GAP
  const appLayerHeight = APP_CONSUMERS.length * (appH + NODE_GAP) - NODE_GAP
  const canvasHeight = Math.max(fztH, feH, termH, midLayerHeight, appLayerHeight)
  const canvasCenterY = canvasHeight / 2

  // For a layer with N nodes of height h, return the y of the i-th node such
  // that the whole stack is vertically centered on canvasCenterY.
  function stackY(i: number, n: number, h: number): number {
    const total = n * (h + NODE_GAP) - NODE_GAP
    const start = canvasCenterY - total / 2
    return start + i * (h + NODE_GAP)
  }

  function cascadeNode(
    id: string,
    label: string,
    runs: CIRun[],
    hasConsumed: boolean,
    hasProvided: boolean,
    x: number,
    y: number,
    h: number,
  ) {
    nodes.push({
      id,
      type: 'cascade',
      position: { x, y },
      style: { width: NODE_WIDTH, height: h },
      data: {
        label,
        runs,
        containerWidth: NODE_WIDTH,
        containerHeight: h,
        hasConsumed,
        hasProvided,
        health: nodeHealth(id, edgeHealths, activeRepos),
      } satisfies CICascadeData,
    })
  }

  function lookupEdgeHealth(producer: string, consumer: string, field: string): EdgeHealth {
    return edgeHealths.get(edgeKey(producer, consumer, field)) ?? 'idle'
  }

  // ── Layer 0: fzt ─────────────────────────────────────────────────
  const fztRuns = runsByRepo.get('fzt') || []
  cascadeNode('fzt', 'fzt', fztRuns, false, true, layerX[0], stackY(0, 1, fztH), fztH)
  nodes.push({
    id: 'pkg-fzt-engine',
    type: 'cascade-pkg',
    parentId: 'fzt',
    extent: 'parent' as const,
    position: { x: PKG_INSET, y: providedY(false) },
    style: { width: PKG_WIDTH },
    data: { label: 'fzt', deployedVersion: versions.get('fzt')?.version, badge: 'go module' },
  })

  // ── Layer 1: fzt-frontend ───────────────────────────────────────
  const feRuns = runsByRepo.get('fzt-frontend') || []
  const feDep = deployed.get('fzt-frontend')
  cascadeNode('fzt-frontend', 'fzt-frontend', feRuns, true, true, layerX[1], stackY(0, 1, feH), feH)
  nodes.push({
    id: 'pkg-fzt-frontend-in',
    type: 'cascade-pkg',
    parentId: 'fzt-frontend',
    extent: 'parent' as const,
    position: { x: PKG_INSET, y: CONSUMED_Y },
    style: { width: PKG_WIDTH },
    data: {
      label: 'fzt',
      deployedVersion: feDep?.versions?.fzt,
      badge: 'go module',
      health: lookupEdgeHealth('fzt', 'fzt-frontend', 'fzt'),
    },
  })
  nodes.push({
    id: 'pkg-fzt-frontend-out',
    type: 'cascade-pkg',
    parentId: 'fzt-frontend',
    extent: 'parent' as const,
    position: { x: PKG_INSET, y: providedY(true) },
    style: { width: PKG_WIDTH },
    data: { label: 'fzt-frontend', deployedVersion: versions.get('fzt-frontend')?.version, badge: 'go module' },
  })
  const feToFrontendHealth = lookupEdgeHealth('fzt', 'fzt-frontend', 'fzt')
  edges.push({
    id: 'pkg-fzt-engine->pkg-fzt-frontend-in',
    source: 'pkg-fzt-engine',
    sourceHandle: 'right-src',
    target: 'pkg-fzt-frontend-in',
    targetHandle: 'left-tgt',
    type: 'default',
    animated: feToFrontendHealth === 'active',
    style: edgeStyle(feToFrontendHealth),
    markerEnd: edgeMarker(feToFrontendHealth),
  })

  // ── Layer 2: fzt-terminal ──────────────────────────────────────
  const termRuns = runsByRepo.get('fzt-terminal') || []
  const termDep = deployed.get('fzt-terminal')
  cascadeNode('fzt-terminal', 'fzt-terminal', termRuns, true, true, layerX[2], stackY(0, 1, termH), termH)
  nodes.push({
    id: 'pkg-fzt-terminal-in',
    type: 'cascade-pkg',
    parentId: 'fzt-terminal',
    extent: 'parent' as const,
    position: { x: PKG_INSET, y: CONSUMED_Y },
    style: { width: PKG_WIDTH },
    data: {
      label: 'fzt-frontend',
      deployedVersion: termDep?.versions?.fztFrontend,
      badge: 'go module',
      health: lookupEdgeHealth('fzt-frontend', 'fzt-terminal', 'fztFrontend'),
    },
  })
  nodes.push({
    id: 'pkg-fzt-terminal-out',
    type: 'cascade-pkg',
    parentId: 'fzt-terminal',
    extent: 'parent' as const,
    position: { x: PKG_INSET, y: providedY(true) },
    style: { width: PKG_WIDTH },
    data: { label: 'fzt-terminal', deployedVersion: versions.get('fzt-terminal')?.version, badge: 'go module' },
  })
  const feToTermHealth = lookupEdgeHealth('fzt-frontend', 'fzt-terminal', 'fztFrontend')
  edges.push({
    id: 'pkg-fzt-frontend-out->pkg-fzt-terminal-in',
    source: 'pkg-fzt-frontend-out',
    sourceHandle: 'right-src',
    target: 'pkg-fzt-terminal-in',
    targetHandle: 'left-tgt',
    type: 'default',
    animated: feToTermHealth === 'active',
    style: edgeStyle(feToTermHealth),
    markerEnd: edgeMarker(feToTermHealth),
  })

  // ── Layer 3: middle consumers (stacked vertically) ─────────────
  for (let i = 0; i < MIDDLE_CONSUMERS.length; i++) {
    const { id, label, providesRelease } = MIDDLE_CONSUMERS[i]
    const runs = runsByRepo.get(id) || []
    const dep = deployed.get(id)
    const h = containerHeight(true, providesRelease)
    cascadeNode(id, label, runs, true, providesRelease, layerX[3], stackY(i, MIDDLE_CONSUMERS.length, h), h)

    const inId = `pkg-${id}-in`
    nodes.push({
      id: inId,
      type: 'cascade-pkg',
      parentId: id,
      extent: 'parent' as const,
      position: { x: PKG_INSET, y: CONSUMED_Y },
      style: { width: PKG_WIDTH },
      data: {
        label: 'fzt-terminal',
        deployedVersion: dep?.versions?.fztTerminal,
        badge: 'go module',
        health: lookupEdgeHealth('fzt-terminal', id, 'fztTerminal'),
      },
    })
    if (providesRelease) {
      nodes.push({
        id: `pkg-${id}-out`,
        type: 'cascade-pkg',
        parentId: id,
        extent: 'parent' as const,
        position: { x: PKG_INSET, y: providedY(true) },
        style: { width: PKG_WIDTH },
        data: {
          label: id,
          deployedVersion: versions.get(id)?.version,
          badge: 'release',
        },
      })
    }
    const termToMidHealth = lookupEdgeHealth('fzt-terminal', id, 'fztTerminal')
    edges.push({
      id: `pkg-fzt-terminal-out->${inId}`,
      source: 'pkg-fzt-terminal-out',
      sourceHandle: 'right-src',
      target: inId,
      targetHandle: 'left-tgt',
      type: 'default',
      animated: termToMidHealth === 'active',
      style: edgeStyle(termToMidHealth),
      markerEnd: edgeMarker(termToMidHealth),
    })
  }

  // ── Layer 4: app consumers (stacked vertically) ───────────────
  for (let i = 0; i < APP_CONSUMERS.length; i++) {
    const { id, label } = APP_CONSUMERS[i]
    const runs = runsByRepo.get(id) || []
    const dep = deployed.get(id)
    cascadeNode(id, label, runs, true, false, layerX[4], stackY(i, APP_CONSUMERS.length, appH), appH)

    const inId = `pkg-${id}-in`
    nodes.push({
      id: inId,
      type: 'cascade-pkg',
      parentId: id,
      extent: 'parent' as const,
      position: { x: PKG_INSET, y: CONSUMED_Y },
      style: { width: PKG_WIDTH },
      data: {
        label: 'fzt-browser',
        deployedVersion: dep?.versions?.fztBrowser,
        badge: 'release',
        health: lookupEdgeHealth('fzt-browser', id, 'fztBrowser'),
      },
    })
    const browserToAppHealth = lookupEdgeHealth('fzt-browser', id, 'fztBrowser')
    edges.push({
      id: `pkg-fzt-browser-out->${inId}`,
      source: 'pkg-fzt-browser-out',
      sourceHandle: 'right-src',
      target: inId,
      targetHandle: 'left-tgt',
      type: 'default',
      animated: browserToAppHealth === 'active',
      style: edgeStyle(browserToAppHealth),
      markerEnd: edgeMarker(browserToAppHealth),
    })
  }

  return { nodes, edges }
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const color = status === 'connected' ? '#22c55e'
    : status === 'connecting' ? '#f59e0b'
    : '#ef4444'
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ backgroundColor: color }}
      title={status}
    />
  )
}

function GrammarBadge({ result }: { result: GrammarResult }) {
  const { status, failures } = result
  const color = status === 'pass' ? '#22c55e'
    : status === 'pending' ? '#f59e0b'
    : '#ef4444'
  const label = status === 'pass' ? 'cascade ok'
    : status === 'pending' ? 'cascade running'
    : `cascade broken (${failures.length})`
  const tooltip = status === 'pass'
    ? 'All edges: producer release version equals consumer pinned version.'
    : status === 'pending'
    ? 'A cascade pipeline is in progress — re-checking once it completes.'
    : failures.join('\n')
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-slate-700 bg-slate-900/60 text-[10px] text-slate-300 cursor-help"
      title={tooltip}
    >
      <span
        className={`inline-block w-2 h-2 rounded-full ${status === 'pending' ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  )
}

interface CIFztViewProps {
  // When provided, skips SSE and renders the supplied data instead. Used by
  // the test view (CIFztTestView) to drive the dashboard with controllable
  // fixture state.
  injected?: {
    runs: Map<string, CIRun>
    versions: Map<string, PublishedVersion>
    deployed: Map<string, DeployedVersion>
  }
  titleOverride?: string
}

export default function CIFztView({ injected, titleOverride }: CIFztViewProps = {}) {
  const title = titleOverride ?? 'CI — fzt'
  const [watching, setWatching] = useState(true)
  const sse = useSSE(watching && !injected)
  const runs = injected?.runs ?? sse.runs
  const versions = injected?.versions ?? sse.versions
  const deployed = injected?.deployed ?? sse.deployed
  const status = injected ? 'connected' as const : sse.status

  const runsByRepo = useMemo(() => {
    const map = new Map<string, CIRun[]>()
    for (const run of runs.values()) {
      if (!map.has(run.repoName)) map.set(run.repoName, [])
      map.get(run.repoName)!.push(run)
    }
    return map
  }, [runs])

  const grammar = useMemo(
    () => checkGrammar(runs, versions, deployed),
    [runs, versions, deployed],
  )

  const { nodes, edges } = useMemo(
    () => buildLayout(runsByRepo, versions, deployed, grammar.edgeHealths, grammar.activeRepos),
    [runsByRepo, versions, deployed, grammar.edgeHealths, grammar.activeRepos],
  )

  const hasActiveRuns = useMemo(() => {
    for (const run of runs.values()) {
      if (run.status === 'in_progress' || run.status === 'queued') return true
    }
    return false
  }, [runs])

  const prevActive = useRef(false)
  useEffect(() => {
    if (prevActive.current && !hasActiveRuns && runs.size > 0) {
      if (Notification.permission === 'granted') {
        new Notification('CI Dashboard', { body: `${title}: all pipelines complete` })
      }
    }
    prevActive.current = hasActiveRuns
  }, [hasActiveRuns, runs.size])

  return (
    <div className="w-screen h-screen bg-[#0f172a]">
      <div className="absolute top-4 left-4 z-10 flex flex-col items-start gap-2">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold text-slate-300">{title}</h1>
          <StatusDot status={status} />
        </div>
        <GrammarBadge result={grammar} />
      </div>

      <div className="absolute top-4 right-16 z-10 flex items-center gap-3">
        <button
          onClick={() => {
            if (Notification.permission === 'default') {
              Notification.requestPermission()
            }
          }}
          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
          title="Enable browser notifications"
        >
          notifications
        </button>
        <button
          onClick={() => setWatching(w => !w)}
          className={`text-xs px-3 py-1 rounded-md border transition-colors ${
            watching
              ? 'border-green-700 text-green-400 bg-green-900/20 hover:bg-green-900/40'
              : 'border-slate-700 text-slate-400 bg-slate-800 hover:bg-slate-700'
          }`}
        >
          {watching ? 'watching' : 'paused'}
        </button>
      </div>

      <div className="absolute bottom-4 left-24 z-10 flex gap-3 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#22c55e' }} /> success
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#38bdf8' }} /> running
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#f59e0b' }} /> queued
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#ef4444' }} /> failed
        </span>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e293b" />
        <Controls className="!bg-slate-800 !border-slate-700 !rounded-lg [&>button]:!bg-slate-800 [&>button]:!border-slate-700 [&>button]:!text-slate-400 [&>button:hover]:!bg-slate-700" />
      </ReactFlow>
    </div>
  )
}
