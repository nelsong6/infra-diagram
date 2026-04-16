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
import CICascadeNodeComponent, { type CICascadeData } from './CICascadeNode'
import type { CIRun, PublishedVersion, DeployedVersion, ConnectionStatus } from '../types/ci'

const nodeTypes = { cascade: CICascadeNodeComponent }

const NODE_WIDTH = 240
const NODE_SPACING = 40
const ROW_GAP = 60

const CONSUMER_REPOS = ['my-homepage', 'fzt-showcase', 'picker'] as const

function buildLayout(
  runsByRepo: Map<string, CIRun[]>,
  versions: Map<string, PublishedVersion>,
  deployed: Map<string, DeployedVersion>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const consumerCount = CONSUMER_REPOS.length
  const totalConsumerWidth = consumerCount * NODE_WIDTH + (consumerCount - 1) * NODE_SPACING
  const centerX = (totalConsumerWidth - NODE_WIDTH) / 2

  // ── fzt (top — publishes engine, no consumed) ──
  const fztRuns = runsByRepo.get('fzt') || []
  const fztActive = fztRuns.some(r => r.status === 'in_progress' || r.status === 'queued')

  nodes.push({
    id: 'fzt',
    type: 'cascade',
    position: { x: centerX, y: 0 },
    style: { width: NODE_WIDTH },
    data: {
      label: 'fzt',
      runs: fztRuns,
      provided: { label: 'engine', version: versions.get('fzt')?.version },
    } satisfies CICascadeData,
  })

  // ── fzt-terminal (middle — consumes fzt engine, publishes releases) ──
  const fztTermRuns = runsByRepo.get('fzt-terminal') || []
  const fztTermActive = fztTermRuns.some(r => r.status === 'in_progress' || r.status === 'queued')
  const fztTermDeployed = deployed.get('fzt-terminal')

  // Estimate fzt node height: title ~52px, provided ~48px
  const fztNodeHeight = 100
  const fztTermY = fztNodeHeight + ROW_GAP

  nodes.push({
    id: 'fzt-terminal',
    type: 'cascade',
    position: { x: centerX, y: fztTermY },
    style: { width: NODE_WIDTH },
    data: {
      label: 'fzt-terminal',
      runs: fztTermRuns,
      consumed: { label: 'fzt', version: fztTermDeployed?.versions?.fzt },
      provided: { label: 'release', version: versions.get('fzt-terminal')?.version },
    } satisfies CICascadeData,
  })

  // Edge: fzt provided → fzt-terminal consumed
  const fztToTermCascading = fztActive || fztTermActive
  edges.push({
    id: 'fzt->fzt-terminal',
    source: 'fzt',
    sourceHandle: 'provided-src',
    target: 'fzt-terminal',
    targetHandle: 'consumed-tgt',
    type: 'straight',
    animated: fztToTermCascading,
    style: {
      stroke: fztToTermCascading ? '#f59e0b' : '#334155',
      strokeWidth: fztToTermCascading ? 2 : 1,
      opacity: fztToTermCascading ? 1 : 0.4,
    },
  })

  // ── Consumers (bottom row) ──
  // Estimate fzt-terminal height: consumed ~48px, title ~52px, provided ~48px
  const fztTermNodeHeight = 148
  const consumerY = fztTermY + fztTermNodeHeight + ROW_GAP

  for (let i = 0; i < consumerCount; i++) {
    const repo = CONSUMER_REPOS[i]
    const runs = runsByRepo.get(repo) || []
    const dep = deployed.get(repo)
    const consumedVersion = dep?.versions?.fztTerminal
    const containerX = i * (NODE_WIDTH + NODE_SPACING)

    nodes.push({
      id: repo,
      type: 'cascade',
      position: { x: containerX, y: consumerY },
      style: { width: NODE_WIDTH },
      data: {
        label: repo,
        runs,
        consumed: { label: 'fzt-terminal', version: consumedVersion },
      } satisfies CICascadeData,
    })

    // Edge: fzt-terminal provided → consumer consumed
    const consumerActive = runs.some(r => r.status === 'in_progress' || r.status === 'queued')
    const cascading = fztTermActive || consumerActive

    edges.push({
      id: `fzt-terminal->${repo}`,
      source: 'fzt-terminal',
      sourceHandle: 'provided-src',
      target: repo,
      targetHandle: 'consumed-tgt',
      type: 'straight',
      animated: cascading,
      style: {
        stroke: cascading ? '#f59e0b' : '#334155',
        strokeWidth: cascading ? 2 : 1,
        opacity: cascading ? 1 : 0.4,
      },
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
