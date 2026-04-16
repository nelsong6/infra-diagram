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
import CIPipelineNodeComponent, { type CINodeData, estimateNodeHeight } from './CIPipelineNode'
import CIContainerNodeComponent from './CIContainerNode'
import CIPackageNodeComponent from './CIPackageNode'
import type { CIRun, PublishedVersion, DeployedVersion, VersionErrors, ConnectionStatus } from '../types/ci'

const nodeTypes = {
  ci: CIPipelineNodeComponent,
  'fzt-consumer': CIContainerNodeComponent,
  'fzt-package': CIPackageNodeComponent,
}

// Layout constants
const NODE_WIDTH = 200
const NODE_SPACING = 40
const PACKAGE_NODE_WIDTH = 160
const CONTAINER_PADDING_X = 20
const CONTAINER_PADDING_TOP = 40
const CONTAINER_PADDING_BOTTOM = 20
const ROW_GAP = 80

// Bottom tier consumers of fzt-terminal releases
const CONSUMER_REPOS = ['my-homepage', 'fzt-showcase', 'picker'] as const

function buildLayout(
  runsByRepo: Map<string, CIRun[]>,
  versions: Map<string, PublishedVersion>,
  deployed: Map<string, DeployedVersion>,
  versionErrors: VersionErrors,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const packageNodeHeight = 44
  const containerHeight = CONTAINER_PADDING_TOP + packageNodeHeight + CONTAINER_PADDING_BOTTOM
  const consumerCount = CONSUMER_REPOS.length
  const consumerContainerWidth = NODE_WIDTH + CONTAINER_PADDING_X * 2
  const totalConsumerWidth = consumerCount * consumerContainerWidth + (consumerCount - 1) * NODE_SPACING

  // ── fzt (top, pipeline node — publishes engine) ──
  const fztRuns = runsByRepo.get('fzt') || []
  const fztPub = versions.get('fzt')
  const fztDep = deployed.get('fzt')
  const fztErr = versionErrors['fzt']
  const fztHeight = estimateNodeHeight(fztRuns, !!(fztPub || fztDep), !!fztErr)
  const fztActive = fztRuns.some(r => r.status === 'in_progress' || r.status === 'queued')

  // Center fzt above fzt-terminal container
  const fztTermContainerWidth = consumerContainerWidth
  const fztX = (totalConsumerWidth - NODE_WIDTH) / 2

  nodes.push({
    id: 'fzt',
    type: 'ci',
    position: { x: fztX, y: 0 },
    style: { width: NODE_WIDTH },
    data: {
      label: 'fzt',
      repoName: 'fzt',
      runs: fztRuns,
      nodeHeight: fztHeight,
      publishedVersion: fztPub,
      deployedVersion: fztDep,
      versionError: fztErr,
    } satisfies CINodeData,
  })

  // ── fzt-terminal (middle, container — consumes fzt engine, publishes releases) ──
  const fztTermRuns = runsByRepo.get('fzt-terminal') || []
  const fztTermActive = fztTermRuns.some(r => r.status === 'in_progress' || r.status === 'queued')
  const fztTermY = fztHeight + ROW_GAP
  const fztTermX = (totalConsumerWidth - fztTermContainerWidth) / 2

  nodes.push({
    id: 'fzt-terminal',
    type: 'fzt-consumer',
    position: { x: fztTermX, y: fztTermY },
    data: {
      label: 'fzt-terminal',
      containerWidth: fztTermContainerWidth,
      containerHeight,
      runs: fztTermRuns,
    },
    style: { width: fztTermContainerWidth, height: containerHeight },
  })

  // Package node inside fzt-terminal showing consumed fzt engine version
  const fztTermDeployed = deployed.get('fzt-terminal')
  const consumedFztVersion = fztTermDeployed?.versions?.fzt

  nodes.push({
    id: 'pkg-fzt-terminal',
    type: 'fzt-package',
    parentId: 'fzt-terminal',
    extent: 'parent' as const,
    position: { x: CONTAINER_PADDING_X, y: CONTAINER_PADDING_TOP },
    style: { width: PACKAGE_NODE_WIDTH },
    data: {
      label: 'fzt',
      deployedVersion: consumedFztVersion,
    },
  })

  // Edge: fzt → package node inside fzt-terminal
  const fztToTermCascading = fztActive || fztTermActive
  edges.push({
    id: 'fzt->pkg-fzt-terminal',
    source: 'fzt',
    sourceHandle: 'bottom-src',
    target: 'pkg-fzt-terminal',
    targetHandle: 'top-tgt',
    type: 'straight',
    animated: fztToTermCascading,
    style: {
      stroke: fztToTermCascading ? '#f59e0b' : '#334155',
      strokeWidth: fztToTermCascading ? 2 : 1,
      opacity: fztToTermCascading ? 1 : 0.4,
    },
  })

  // ── Consumer containers (bottom row) ──
  const consumerY = fztTermY + containerHeight + ROW_GAP

  for (let i = 0; i < consumerCount; i++) {
    const repo = CONSUMER_REPOS[i]
    const runs = runsByRepo.get(repo) || []
    const containerId = `consumer-${repo}`
    const pkgId = `pkg-${repo}`
    const containerX = i * (consumerContainerWidth + NODE_SPACING)

    nodes.push({
      id: containerId,
      type: 'fzt-consumer',
      position: { x: containerX, y: consumerY },
      data: {
        label: repo,
        containerWidth: consumerContainerWidth,
        containerHeight,
        runs,
      },
      style: { width: consumerContainerWidth, height: containerHeight },
    })

    const dep = deployed.get(repo)
    const consumedVersion = dep?.versions?.fztTerminal

    nodes.push({
      id: pkgId,
      type: 'fzt-package',
      parentId: containerId,
      extent: 'parent' as const,
      position: { x: CONTAINER_PADDING_X, y: CONTAINER_PADDING_TOP },
      style: { width: PACKAGE_NODE_WIDTH },
      data: {
        label: 'fzt-terminal',
        deployedVersion: consumedVersion,
      },
    })

    // Edge: fzt-terminal container → package node inside consumer
    const consumerActive = runs.some(r => r.status === 'in_progress' || r.status === 'queued')
    const cascading = fztTermActive || consumerActive

    edges.push({
      id: `fzt-terminal->${pkgId}`,
      source: 'fzt-terminal',
      sourceHandle: 'bottom-src',
      target: pkgId,
      targetHandle: 'top-tgt',
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
  const { runs, versions, deployed, versionErrors, status } = useSSE(watching)

  const runsByRepo = useMemo(() => {
    const map = new Map<string, CIRun[]>()
    for (const run of runs.values()) {
      if (!map.has(run.repoName)) map.set(run.repoName, [])
      map.get(run.repoName)!.push(run)
    }
    return map
  }, [runs])

  const { nodes, edges } = useMemo(
    () => buildLayout(runsByRepo, versions, deployed, versionErrors),
    [runsByRepo, versions, deployed, versionErrors],
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
