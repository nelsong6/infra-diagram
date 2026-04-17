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
import { edgeStyle, edgeMarker } from './ciEdgeStyle'
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

function isActive(runs: CIRun[]): boolean {
  return runs.some(r => r.status === 'in_progress' || r.status === 'queued')
}

function buildLayout(
  runsByRepo: Map<string, CIRun[]>,
  versions: Map<string, PublishedVersion>,
  deployed: Map<string, DeployedVersion>,
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
      } satisfies CICascadeData,
    })
  }

  // ── Layer 0: fzt ─────────────────────────────────────────────────
  const fztRuns = runsByRepo.get('fzt') || []
  const fztActive = isActive(fztRuns)
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
  const feActive = isActive(feRuns)
  const feDep = deployed.get('fzt-frontend')
  cascadeNode('fzt-frontend', 'fzt-frontend', feRuns, true, true, layerX[1], stackY(0, 1, feH), feH)
  nodes.push({
    id: 'pkg-fzt-frontend-in',
    type: 'cascade-pkg',
    parentId: 'fzt-frontend',
    extent: 'parent' as const,
    position: { x: PKG_INSET, y: CONSUMED_Y },
    style: { width: PKG_WIDTH },
    data: { label: 'fzt', deployedVersion: feDep?.versions?.fzt, badge: 'go module' },
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
  edges.push({
    id: 'pkg-fzt-engine->pkg-fzt-frontend-in',
    source: 'pkg-fzt-engine',
    sourceHandle: 'right-src',
    target: 'pkg-fzt-frontend-in',
    targetHandle: 'left-tgt',
    type: 'default',
    animated: fztActive || feActive,
    style: edgeStyle(fztActive || feActive),
    markerEnd: edgeMarker(fztActive || feActive),
  })

  // ── Layer 2: fzt-terminal ──────────────────────────────────────
  const termRuns = runsByRepo.get('fzt-terminal') || []
  const termActive = isActive(termRuns)
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
  edges.push({
    id: 'pkg-fzt-frontend-out->pkg-fzt-terminal-in',
    source: 'pkg-fzt-frontend-out',
    sourceHandle: 'right-src',
    target: 'pkg-fzt-terminal-in',
    targetHandle: 'left-tgt',
    type: 'default',
    animated: feActive || termActive,
    style: edgeStyle(feActive || termActive),
    markerEnd: edgeMarker(feActive || termActive),
  })

  // ── Layer 3: middle consumers (stacked vertically) ─────────────
  for (let i = 0; i < MIDDLE_CONSUMERS.length; i++) {
    const { id, label, providesRelease } = MIDDLE_CONSUMERS[i]
    const runs = runsByRepo.get(id) || []
    const active = isActive(runs)
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
    edges.push({
      id: `pkg-fzt-terminal-out->${inId}`,
      source: 'pkg-fzt-terminal-out',
      sourceHandle: 'right-src',
      target: inId,
      targetHandle: 'left-tgt',
      type: 'default',
      animated: termActive || active,
      style: edgeStyle(termActive || active),
      markerEnd: edgeMarker(termActive || active),
    })
  }

  // ── Layer 4: app consumers (stacked vertically) ───────────────
  const browserActive = isActive(runsByRepo.get('fzt-browser') || [])
  for (let i = 0; i < APP_CONSUMERS.length; i++) {
    const { id, label } = APP_CONSUMERS[i]
    const runs = runsByRepo.get(id) || []
    const active = isActive(runs)
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
      },
    })
    edges.push({
      id: `pkg-fzt-browser-out->${inId}`,
      source: 'pkg-fzt-browser-out',
      sourceHandle: 'right-src',
      target: inId,
      targetHandle: 'left-tgt',
      type: 'default',
      animated: browserActive || active,
      style: edgeStyle(browserActive || active),
      markerEnd: edgeMarker(browserActive || active),
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

export default function CIFztView() {
  const title = 'CI — fzt'
  const [watching, setWatching] = useState(true)
  const { runs, versions, deployed, status } = useSSE(watching)

  const runsByRepo = useMemo(() => {
    const map = new Map<string, CIRun[]>()
    for (const run of runs.values()) {
      if (!map.has(run.repoName)) map.set(run.repoName, [])
      map.get(run.repoName)!.push(run)
    }
    return map
  }, [runs])

  const { nodes, edges } = useMemo(
    () => buildLayout(runsByRepo, versions, deployed),
    [runsByRepo, versions, deployed],
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
      <div className="absolute top-4 left-4 z-10 flex items-center gap-4">
        <h1 className="text-sm font-bold text-slate-300">{title}</h1>
        <StatusDot status={status} />
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
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e293b" />
        <Controls className="!bg-slate-800 !border-slate-700 !rounded-lg [&>button]:!bg-slate-800 [&>button]:!border-slate-700 [&>button]:!text-slate-400 [&>button:hover]:!bg-slate-700" />
      </ReactFlow>
    </div>
  )
}
