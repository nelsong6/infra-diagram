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
import { useELKLayout } from '../hooks/useELKLayout'
import CIPipelineNodeComponent, { type CINodeData, estimateNodeHeight } from './CIPipelineNode'
import ELKEdgeComponent from './ELKEdge'
import type { CIRun, PublishedVersion, DeployedVersion, ConnectionStatus } from '../types/ci'

const nodeTypes = { ci: CIPipelineNodeComponent }
const edgeTypes = { elk: ELKEdgeComponent }

// [source, target]
export type DispatchEdge = [string, string]

interface CIViewProps {
  title: string
  repos: string[]
  edges: DispatchEdge[]
}

function buildInputNodes(
  repos: string[],
  runsByRepo: Map<string, CIRun[]>,
  versions: Map<string, PublishedVersion>,
  deployed: Map<string, DeployedVersion>,
): Node[] {
  return repos.map((id) => {
    const runs = runsByRepo.get(id) || []
    const pub = versions.get(id)
    const dep = deployed.get(id)
    const hasVersion = !!(pub || dep)
    return {
      id,
      type: 'ci',
      position: { x: 0, y: 0 },
      data: {
        label: id,
        repoName: id,
        runs,
        nodeHeight: estimateNodeHeight(runs, hasVersion),
        publishedVersion: pub,
        deployedVersion: dep,
      } satisfies CINodeData,
    }
  })
}

function buildInputEdges(chains: DispatchEdge[], runsByRepo: Map<string, CIRun[]>): Edge[] {
  return chains.map(([src, dst]) => {
    const srcRuns = runsByRepo.get(src) || []
    const dstRuns = runsByRepo.get(dst) || []
    const srcActive = srcRuns.some(r => r.status === 'in_progress' || r.status === 'queued')
    const dstActive = dstRuns.some(r => r.status === 'in_progress' || r.status === 'queued')
    const cascading = srcActive || dstActive

    return {
      id: `${src}->${dst}`,
      source: src,
      target: dst,
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

export default function CIView({ title, repos, edges: edgeDefs }: CIViewProps) {
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

  const inputNodes = useMemo(() => buildInputNodes(repos, runsByRepo, versions, deployed), [repos, runsByRepo, versions, deployed])
  const inputEdges = useMemo(() => buildInputEdges(edgeDefs, runsByRepo), [edgeDefs, runsByRepo])

  const { nodes, edges, layoutReady } = useELKLayout(inputNodes, inputEdges)

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
  }, [hasActiveRuns, runs.size, title])

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

      {layoutReady && (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          minZoom={0.3}
          maxZoom={1.5}
          defaultEdgeOptions={{ type: 'elk' }}
          nodesDraggable={false}
          nodesConnectable={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#1e293b" />
          <Controls className="!bg-slate-800 !border-slate-700 !rounded-lg [&>button]:!bg-slate-800 [&>button]:!border-slate-700 [&>button]:!text-slate-400 [&>button:hover]:!bg-slate-700" />
        </ReactFlow>
      )}
    </div>
  )
}
