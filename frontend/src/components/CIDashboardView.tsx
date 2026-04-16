import { useState, useMemo, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Link } from 'react-router-dom'
import { useSSE } from '../hooks/useSSE'
import CIPipelineNodeComponent, { type CINodeData } from './CIPipelineNode'
import type { CIRun, ConnectionStatus } from '../types/ci'

const nodeTypes = { ci: CIPipelineNodeComponent }

// Layout: dispatch flow top-to-bottom
//
//   Row 0: fzt (engine — upstream of everything)
//   Row 1: fzt-terminal (consumes fzt, dispatches to row 2)
//   Row 2: my-homepage, fzt-showcase, infra-diagram (consume fzt-terminal assets)
//   Row 3: kill-me, plant-agent, investing, house-hunt (app repos, dispatch routes to api)
//   Row 4: api (receives dispatches from all app repos above)
//   Row 5: infra-bootstrap, picker, landing-page, emotions-mcp (independent)

const COL_W = 260
const ROW_H = 160

type RepoPosition = { id: string; x: number; y: number }

const LAYOUT: RepoPosition[] = [
  // Row 0 — engine
  { id: 'fzt', x: COL_W * 1.5, y: 0 },

  // Row 1 — ecosystem layer
  { id: 'fzt-terminal', x: COL_W * 1.5, y: ROW_H },

  // Row 2 — fzt-terminal consumers
  { id: 'my-homepage', x: 0, y: ROW_H * 2 },
  { id: 'fzt-showcase', x: COL_W * 1.5, y: ROW_H * 2 },
  { id: 'infra-diagram', x: COL_W * 3, y: ROW_H * 2 },

  // Row 3 — app repos (dispatch routes → api)
  { id: 'kill-me', x: 0, y: ROW_H * 3 },
  { id: 'plant-agent', x: COL_W, y: ROW_H * 3 },
  { id: 'investing', x: COL_W * 2, y: ROW_H * 3 },
  { id: 'house-hunt', x: COL_W * 3, y: ROW_H * 3 },

  // Row 4 — shared API (receives all dispatches)
  { id: 'api', x: COL_W * 1.5, y: ROW_H * 4 },

  // Row 5 — independent repos
  { id: 'infra-bootstrap', x: 0, y: ROW_H * 5.5 },
  { id: 'picker', x: COL_W, y: ROW_H * 5.5 },
  { id: 'landing-page', x: COL_W * 2, y: ROW_H * 5.5 },
  { id: 'emotions-mcp', x: COL_W * 3, y: ROW_H * 5.5 },
]

// Dispatch chain edges (upstream → downstream)
const DISPATCH_CHAINS: [string, string][] = [
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

function buildNodes(layout: RepoPosition[], runsByRepo: Map<string, CIRun[]>): Node[] {
  return layout.map((repo) => ({
    id: repo.id,
    type: 'ci',
    position: { x: repo.x, y: repo.y },
    data: {
      label: repo.id,
      repoName: repo.id,
      runs: runsByRepo.get(repo.id) || [],
    } satisfies CINodeData,
  }))
}

function buildEdges(runsByRepo: Map<string, CIRun[]>): Edge[] {
  return DISPATCH_CHAINS.map(([src, dst]) => {
    const srcRuns = runsByRepo.get(src) || []
    const dstRuns = runsByRepo.get(dst) || []
    const srcActive = srcRuns.some(r => r.status === 'in_progress' || r.status === 'queued')
    const dstActive = dstRuns.some(r => r.status === 'in_progress' || r.status === 'queued')
    const cascading = srcActive || dstActive

    return {
      id: `${src}->${dst}`,
      source: src,
      target: dst,
      sourceHandle: 'bottom-src',
      targetHandle: 'top-tgt',
      type: 'smoothstep',
      animated: cascading,
      style: {
        stroke: cascading ? '#f59e0b' : '#334155',
        strokeWidth: cascading ? 2 : 1,
        opacity: cascading ? 1 : 0.4,
      },
    }
  })
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

export default function CIDashboardView() {
  const [watching, setWatching] = useState(true)
  const { runs, status } = useSSE(watching)

  // Group runs by repo name
  const runsByRepo = useMemo(() => {
    const map = new Map<string, CIRun[]>()
    for (const run of runs.values()) {
      const name = run.repoName
      if (!map.has(name)) map.set(name, [])
      map.get(name)!.push(run)
    }
    return map
  }, [runs])

  const nodes = useMemo(() => buildNodes(LAYOUT, runsByRepo), [runsByRepo])
  const edges = useMemo(() => buildEdges(runsByRepo), [runsByRepo])

  // Watch mode: notify when all active runs complete
  const hasActiveRuns = useMemo(() => {
    for (const run of runs.values()) {
      if (run.status === 'in_progress' || run.status === 'queued') return true
    }
    return false
  }, [runs])

  const prevActive = useMemo(() => ({ current: false }), [])
  useEffect(() => {
    if (prevActive.current && !hasActiveRuns && runs.size > 0) {
      if (Notification.permission === 'granted') {
        new Notification('CI Dashboard', { body: 'All pipelines complete' })
      }
    }
    prevActive.current = hasActiveRuns
  }, [hasActiveRuns, runs.size, prevActive])

  return (
    <div className="w-screen h-screen bg-[#0f172a]">
      {/* Header */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-4">
        <Link
          to="/pipelines"
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          &larr; pipelines
        </Link>
        <h1 className="text-sm font-bold text-slate-300">CI Dashboard</h1>
        <StatusDot status={status} />
      </div>

      {/* Controls */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-3">
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

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 flex gap-3 text-[10px] text-slate-400">
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
        defaultEdgeOptions={{ type: 'smoothstep' }}
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e293b" />
        <Controls className="!bg-slate-800 !border-slate-700 !rounded-lg [&>button]:!bg-slate-800 [&>button]:!border-slate-700 [&>button]:!text-slate-400 [&>button:hover]:!bg-slate-700" />
      </ReactFlow>
    </div>
  )
}
