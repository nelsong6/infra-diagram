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
import { edgeStyle, edgeMarker } from './ciEdgeStyle'
import type { CIRun, PublishedVersion, DeployedVersion, VersionErrors, ConnectionStatus } from '../types/ci'
import { apiHostRepos, routePackageMap } from '../data/ci-views'

const nodeTypes = {
  ci: CIPipelineNodeComponent,
  'api-container': CIContainerNodeComponent,
  'api-package': CIPackageNodeComponent,
}

// Layout constants
const HOST_NODE_WIDTH = 200
const HOST_SPACING = 40
const PACKAGE_NODE_WIDTH = 160
const CONTAINER_PADDING_X = 20
const CONTAINER_PADDING_TOP = 40
const CONTAINER_PADDING_BOTTOM = 20
const ROW_GAP = 80

function buildLayout(
  hostRepos: string[],
  runsByRepo: Map<string, CIRun[]>,
  versions: Map<string, PublishedVersion>,
  deployed: Map<string, DeployedVersion>,
  versionErrors: VersionErrors,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const n = hostRepos.length

  // Compute host node heights
  const hostHeights = hostRepos.map((repo) => {
    const runs = runsByRepo.get(repo) || []
    const pub = versions.get(repo)
    const dep = deployed.get(repo)
    const err = versionErrors[repo]
    return estimateNodeHeight(runs, !!(pub || dep), !!err)
  })
  const maxHostHeight = Math.max(...hostHeights)

  // Host nodes (top row) — explicit width so handle centers align with packages
  for (let i = 0; i < n; i++) {
    const repo = hostRepos[i]
    const runs = runsByRepo.get(repo) || []
    const pub = versions.get(repo)
    const dep = deployed.get(repo)
    const err = versionErrors[repo]
    nodes.push({
      id: repo,
      type: 'ci',
      position: { x: i * (HOST_NODE_WIDTH + HOST_SPACING), y: 0 },
      style: { width: HOST_NODE_WIDTH },
      data: {
        label: repo,
        repoName: repo,
        runs,
        nodeHeight: hostHeights[i],
        publishedVersion: pub,
        deployedVersion: dep,
        versionError: err,
      } satisfies CINodeData,
    })
  }

  // Container node (API)
  const totalHostWidth = n * HOST_NODE_WIDTH + (n - 1) * HOST_SPACING
  const containerWidth = totalHostWidth + CONTAINER_PADDING_X * 2
  const packageNodeHeight = 44
  const containerHeight = CONTAINER_PADDING_TOP + packageNodeHeight + CONTAINER_PADDING_BOTTOM
  const containerY = maxHostHeight + ROW_GAP
  const containerX = -CONTAINER_PADDING_X

  const apiRuns = runsByRepo.get('api') || []
  nodes.push({
    id: 'api-container',
    type: 'api-container',
    position: { x: containerX, y: containerY },
    data: {
      label: 'api',
      containerWidth,
      containerHeight,
      runs: apiRuns,
    },
    style: { width: containerWidth, height: containerHeight },
  })

  // Package nodes inside container + edges
  const apiDeployed = deployed.get('api')

  for (let i = 0; i < n; i++) {
    const repo = hostRepos[i]
    const pkgShortName = routePackageMap[repo]
    if (!pkgShortName) continue

    const pkgId = `pkg-${repo}`
    const hostX = i * (HOST_NODE_WIDTH + HOST_SPACING)
    const pkgX = hostX + (HOST_NODE_WIDTH - PACKAGE_NODE_WIDTH) / 2 + CONTAINER_PADDING_X

    const deployedVersion = apiDeployed?.versions?.[pkgShortName]

    nodes.push({
      id: pkgId,
      type: 'api-package',
      parentId: 'api-container',
      extent: 'parent' as const,
      position: { x: pkgX, y: CONTAINER_PADDING_TOP },
      style: { width: PACKAGE_NODE_WIDTH },
      data: {
        label: pkgShortName,
        deployedVersion,
      },
    })

    // Edge from host to package
    const hostRuns = runsByRepo.get(repo) || []
    const hostActive = hostRuns.some(r => r.status === 'in_progress' || r.status === 'queued')
    const apiActive = apiRuns.some(r => r.status === 'in_progress' || r.status === 'queued')
    const cascading = hostActive || apiActive

    edges.push({
      id: `${repo}->${pkgId}`,
      source: repo,
      sourceHandle: 'bottom-src',
      target: pkgId,
      targetHandle: 'top-tgt',
      type: 'straight',
      animated: cascading,
      style: edgeStyle(cascading),
      markerEnd: edgeMarker(cascading),
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

export default function CIApiContainerView() {
  const title = 'CI — api'
  const [watching, setWatching] = useState(true)
  const { runs, packageVersions, deployed, versionErrors, status } = useSSE(watching)

  const runsByRepo = useMemo(() => {
    const map = new Map<string, CIRun[]>()
    for (const run of runs.values()) {
      if (!map.has(run.repoName)) map.set(run.repoName, [])
      map.get(run.repoName)!.push(run)
    }
    return map
  }, [runs])

  const { nodes, edges } = useMemo(
    () => buildLayout(apiHostRepos, runsByRepo, packageVersions, deployed, versionErrors),
    [runsByRepo, packageVersions, deployed, versionErrors],
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
