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
import type { CIRun, PublishedVersion, DeployedVersion, ConnectionStatus } from '../types/ci'

const nodeTypes = {
  cascade: CICascadeNodeComponent,
  'cascade-pkg': CIPackageNodeComponent,
}

const NODE_WIDTH = 240
const PKG_WIDTH = 200
const NODE_SPACING = 40
const ROW_GAP = 60
const PKG_INSET = (NODE_WIDTH - PKG_WIDTH) / 2

// Row 3 — middle consumers. Each imports fzt-terminal as a Go module and
// produces its own release artifact (or, for fzt-picker, a local binary that
// no one else consumes — leaf node).
const MIDDLE_CONSUMERS = [
  { id: 'fzt-browser', label: 'fzt-browser', providesRelease: true },
  { id: 'fzt-automate', label: 'fzt-automate', providesRelease: true },
  { id: 'fzt-picker', label: 'fzt-picker', providesRelease: true },
] as const

// Row 4 — app consumers. Download from fzt-browser's release.
const APP_CONSUMERS = [
  { id: 'my-homepage', label: 'my-homepage' },
  { id: 'fzt-showcase', label: 'fzt-showcase' },
] as const

function containerHeight(hasConsumed: boolean, hasProvided: boolean): number {
  let h = CASCADE_TITLE_HEIGHT
  if (hasConsumed) h += CASCADE_PKG_HEIGHT + CASCADE_PKG_PADDING * 2
  if (hasProvided) h += CASCADE_PKG_HEIGHT + CASCADE_PKG_PADDING * 2
  if (!hasProvided) h += CASCADE_PKG_PADDING // extra bottom breathing room
  return h
}

// Row width for a list of N nodes laid out with NODE_SPACING between them.
function rowWidth(count: number): number {
  return count * NODE_WIDTH + (count - 1) * NODE_SPACING
}

// X coordinate for the i-th node in a row of `count` nodes, centered within
// the widest row so every layer's center aligns.
function colX(i: number, count: number, widestRow: number): number {
  const rowW = rowWidth(count)
  const offset = (widestRow - rowW) / 2
  return offset + i * (NODE_WIDTH + NODE_SPACING)
}

function isActive(runs: CIRun[]): boolean {
  return runs.some(r => r.status === 'in_progress' || r.status === 'queued')
}

function edgeStyle(cascading: boolean) {
  return {
    stroke: cascading ? '#f59e0b' : '#334155',
    strokeWidth: cascading ? 2 : 1,
    opacity: cascading ? 1 : 0.4,
  }
}

function buildLayout(
  runsByRepo: Map<string, CIRun[]>,
  versions: Map<string, PublishedVersion>,
  deployed: Map<string, DeployedVersion>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // The middle-consumers row is widest (3 nodes). All single-node rows center
  // over its full width; the app-consumers row (2 nodes) also centers over it.
  const widest = rowWidth(MIDDLE_CONSUMERS.length)

  // ── Row 0: fzt (engine) ─────────────────────────────────────────
  const fztRuns = runsByRepo.get('fzt') || []
  const fztActive = isActive(fztRuns)
  const fztH = containerHeight(false, true)
  const fztY = 0
  const fztX = colX(0, 1, widest)

  nodes.push({
    id: 'fzt',
    type: 'cascade',
    position: { x: fztX, y: fztY },
    style: { width: NODE_WIDTH, height: fztH },
    data: {
      label: 'fzt',
      runs: fztRuns,
      containerWidth: NODE_WIDTH,
      containerHeight: fztH,
      hasConsumed: false,
      hasProvided: true,
    } satisfies CICascadeData,
  })

  const fztProvidedY = CASCADE_TITLE_HEIGHT + CASCADE_PKG_PADDING
  nodes.push({
    id: 'pkg-fzt-engine',
    type: 'cascade-pkg',
    parentId: 'fzt',
    extent: 'parent' as const,
    position: { x: PKG_INSET, y: fztProvidedY },
    style: { width: PKG_WIDTH },
    data: { label: 'fzt', deployedVersion: versions.get('fzt')?.version, badge: 'go module' },
  })

  // ── Row 1: fzt-frontend ─────────────────────────────────────────
  const feRuns = runsByRepo.get('fzt-frontend') || []
  const feActive = isActive(feRuns)
  const feDeployed = deployed.get('fzt-frontend')
  const feH = containerHeight(true, true)
  const feY = fztY + fztH + ROW_GAP
  const feX = colX(0, 1, widest)

  nodes.push({
    id: 'fzt-frontend',
    type: 'cascade',
    position: { x: feX, y: feY },
    style: { width: NODE_WIDTH, height: feH },
    data: {
      label: 'fzt-frontend',
      runs: feRuns,
      containerWidth: NODE_WIDTH,
      containerHeight: feH,
      hasConsumed: true,
      hasProvided: true,
    } satisfies CICascadeData,
  })

  nodes.push({
    id: 'pkg-fzt-frontend-in',
    type: 'cascade-pkg',
    parentId: 'fzt-frontend',
    extent: 'parent' as const,
    position: { x: PKG_INSET, y: CASCADE_PKG_PADDING },
    style: { width: PKG_WIDTH },
    data: { label: 'fzt', deployedVersion: feDeployed?.versions?.fzt, badge: 'go module' },
  })

  const fePrvY = CASCADE_PKG_HEIGHT + CASCADE_PKG_PADDING * 2 + CASCADE_TITLE_HEIGHT + CASCADE_PKG_PADDING
  nodes.push({
    id: 'pkg-fzt-frontend-out',
    type: 'cascade-pkg',
    parentId: 'fzt-frontend',
    extent: 'parent' as const,
    position: { x: PKG_INSET, y: fePrvY },
    style: { width: PKG_WIDTH },
    data: { label: 'fzt-frontend', deployedVersion: versions.get('fzt-frontend')?.version, badge: 'go module' },
  })

  // Edge fzt.engine → fzt-frontend.in
  edges.push({
    id: 'pkg-fzt-engine->pkg-fzt-frontend-in',
    source: 'pkg-fzt-engine',
    sourceHandle: 'bottom-src',
    target: 'pkg-fzt-frontend-in',
    targetHandle: 'top-tgt',
    type: 'default',
    animated: fztActive || feActive,
    style: edgeStyle(fztActive || feActive),
  })

  // ── Row 2: fzt-terminal ─────────────────────────────────────────
  const termRuns = runsByRepo.get('fzt-terminal') || []
  const termActive = isActive(termRuns)
  const termDeployed = deployed.get('fzt-terminal')
  const termH = containerHeight(true, true)
  const termY = feY + feH + ROW_GAP
  const termX = colX(0, 1, widest)

  nodes.push({
    id: 'fzt-terminal',
    type: 'cascade',
    position: { x: termX, y: termY },
    style: { width: NODE_WIDTH, height: termH },
    data: {
      label: 'fzt-terminal',
      runs: termRuns,
      containerWidth: NODE_WIDTH,
      containerHeight: termH,
      hasConsumed: true,
      hasProvided: true,
    } satisfies CICascadeData,
  })

  // fzt-terminal consumes fzt-frontend directly (and fzt transitively).
  // Show the direct one as the cascade edge; the pin version below.
  nodes.push({
    id: 'pkg-fzt-terminal-in',
    type: 'cascade-pkg',
    parentId: 'fzt-terminal',
    extent: 'parent' as const,
    position: { x: PKG_INSET, y: CASCADE_PKG_PADDING },
    style: { width: PKG_WIDTH },
    data: {
      label: 'fzt-frontend',
      deployedVersion: termDeployed?.versions?.fztFrontend,
      badge: 'go module',
    },
  })

  const termPrvY = CASCADE_PKG_HEIGHT + CASCADE_PKG_PADDING * 2 + CASCADE_TITLE_HEIGHT + CASCADE_PKG_PADDING
  nodes.push({
    id: 'pkg-fzt-terminal-out',
    type: 'cascade-pkg',
    parentId: 'fzt-terminal',
    extent: 'parent' as const,
    position: { x: PKG_INSET, y: termPrvY },
    style: { width: PKG_WIDTH },
    data: { label: 'fzt-terminal', deployedVersion: versions.get('fzt-terminal')?.version, badge: 'go module' },
  })

  // Edge fzt-frontend.out → fzt-terminal.in
  edges.push({
    id: 'pkg-fzt-frontend-out->pkg-fzt-terminal-in',
    source: 'pkg-fzt-frontend-out',
    sourceHandle: 'bottom-src',
    target: 'pkg-fzt-terminal-in',
    targetHandle: 'top-tgt',
    type: 'default',
    animated: feActive || termActive,
    style: edgeStyle(feActive || termActive),
  })

  // ── Row 3: middle consumers (fzt-browser, fzt-automate, fzt-picker) ─
  const midY = termY + termH + ROW_GAP

  for (let i = 0; i < MIDDLE_CONSUMERS.length; i++) {
    const { id, label, providesRelease } = MIDDLE_CONSUMERS[i]
    const runs = runsByRepo.get(id) || []
    const active = isActive(runs)
    const dep = deployed.get(id)
    const h = containerHeight(true, providesRelease)
    const x = colX(i, MIDDLE_CONSUMERS.length, widest)

    nodes.push({
      id,
      type: 'cascade',
      position: { x, y: midY },
      style: { width: NODE_WIDTH, height: h },
      data: {
        label,
        runs,
        containerWidth: NODE_WIDTH,
        containerHeight: h,
        hasConsumed: true,
        hasProvided: providesRelease,
      } satisfies CICascadeData,
    })

    // Consumed: fzt-terminal (Go module)
    const inId = `pkg-${id}-in`
    nodes.push({
      id: inId,
      type: 'cascade-pkg',
      parentId: id,
      extent: 'parent' as const,
      position: { x: PKG_INSET, y: CASCADE_PKG_PADDING },
      style: { width: PKG_WIDTH },
      data: {
        label: 'fzt-terminal',
        deployedVersion: dep?.versions?.fztTerminal,
        badge: 'go module',
      },
    })

    // Provided: release (if any)
    if (providesRelease) {
      nodes.push({
        id: `pkg-${id}-out`,
        type: 'cascade-pkg',
        parentId: id,
        extent: 'parent' as const,
        position: { x: PKG_INSET, y: termPrvY },
        style: { width: PKG_WIDTH },
        data: {
          label: id,
          deployedVersion: versions.get(id)?.version,
          badge: 'release',
        },
      })
    }

    // Edge fzt-terminal.out → this.in
    edges.push({
      id: `pkg-fzt-terminal-out->${inId}`,
      source: 'pkg-fzt-terminal-out',
      sourceHandle: 'bottom-src',
      target: inId,
      targetHandle: 'top-tgt',
      type: 'default',
      animated: termActive || active,
      style: edgeStyle(termActive || active),
    })
  }

  // ── Row 4: app consumers (my-homepage, fzt-showcase) ────────────
  const appConsumedH = containerHeight(true, false)
  const browserActive = isActive(runsByRepo.get('fzt-browser') || [])
  const appY = midY + containerHeight(true, true) + ROW_GAP

  for (let i = 0; i < APP_CONSUMERS.length; i++) {
    const { id, label } = APP_CONSUMERS[i]
    const runs = runsByRepo.get(id) || []
    const active = isActive(runs)
    const dep = deployed.get(id)
    const x = colX(i, APP_CONSUMERS.length, widest)

    nodes.push({
      id,
      type: 'cascade',
      position: { x, y: appY },
      style: { width: NODE_WIDTH, height: appConsumedH },
      data: {
        label,
        runs,
        containerWidth: NODE_WIDTH,
        containerHeight: appConsumedH,
        hasConsumed: true,
        hasProvided: false,
      } satisfies CICascadeData,
    })

    // Consumed: fzt-browser release assets
    const inId = `pkg-${id}-in`
    nodes.push({
      id: inId,
      type: 'cascade-pkg',
      parentId: id,
      extent: 'parent' as const,
      position: { x: PKG_INSET, y: CASCADE_PKG_PADDING },
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
      sourceHandle: 'bottom-src',
      target: inId,
      targetHandle: 'top-tgt',
      type: 'default',
      animated: browserActive || active,
      style: edgeStyle(browserActive || active),
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
