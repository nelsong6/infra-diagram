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
import { edgeStyle, edgeMarker, aggregateHealth, type EdgeHealth } from './ciEdgeStyle'
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
  edgeHealths: Map<string, EdgeHealth>,
  hostNodeHealths: Map<string, EdgeHealth>,
  packageHealths: Map<string, EdgeHealth>,
  containerHealth: EdgeHealth,
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
        health: hostNodeHealths.get(repo) ?? 'idle',
      } satisfies CINodeData,
    })
  }

  // Container node (API) — health precomputed by checkApiGrammar so it
  // only shows 'active' when api itself is running (not when a host is).
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
      health: containerHealth,
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
    const edgeHealth = edgeHealths.get(repo) ?? 'idle'
    const pkgHealth = packageHealths.get(repo) ?? 'idle'

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
        health: pkgHealth,
      },
    })

    edges.push({
      id: `${repo}->${pkgId}`,
      source: repo,
      sourceHandle: 'bottom-src',
      target: pkgId,
      targetHandle: 'top-tgt',
      type: 'straight',
      animated: edgeHealth === 'active',
      style: edgeStyle(edgeHealth),
      markerEnd: edgeMarker(edgeHealth),
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

// Repos whose pipeline activity counts as "the api cascade running" — any
// host that publishes a route package + the api itself (which republishes
// the lockfile-pinned versions on deploy).
const API_CASCADE_REPOS = new Set<string>(['api', ...apiHostRepos])

type GrammarStatus = 'pass' | 'pending' | 'fail'

interface GrammarResult {
  status: GrammarStatus
  failures: string[]
  // Per-host edge health keyed by host repo name. Active-aware: an edge is
  // 'active' if host OR api is running. Drives edge-arrow color.
  edgeHealths: Map<string, EdgeHealth>
  // Per-host NODE health. Same as edge, but 'active' only propagates when
  // the host itself is running — not when api is. Fixes diagrams#7 (a
  // finished host inheriting amber from api's cascade activity).
  hostNodeHealths: Map<string, EdgeHealth>
  // Per-host PACKAGE node health (packages inside the api container).
  // 'active' only if api is running.
  packageHealths: Map<string, EdgeHealth>
  // API container health: 'active' only if api is running, otherwise the
  // aggregate of intrinsic (version-match-only) host healths.
  containerHealth: EdgeHealth
}

// Mirrors the check-ci-api skill's three checks. Encodes `/ci/api`'s grammar
// so the badge can answer "is this page broken?" at a glance:
//   1. Every host repo has a published route package.
//   2. The api's deployed version of each host's package equals the host's
//      published version.
//   3. Every deployed package has a host row on the dashboard (no orphans).
function checkApiGrammar(
  runs: Map<string, CIRun>,
  packageVersions: Map<string, PublishedVersion>,
  deployed: Map<string, DeployedVersion>,
): GrammarResult {
  const activeRepos = new Set<string>()
  const reposWithRuns = new Set<string>()
  for (const run of runs.values()) {
    if (!API_CASCADE_REPOS.has(run.repoName)) continue
    reposWithRuns.add(run.repoName)
    if (run.status === 'in_progress' || run.status === 'queued') {
      activeRepos.add(run.repoName)
    }
  }

  const failures: string[] = []
  const edgeHealths = new Map<string, EdgeHealth>()
  const hostNodeHealths = new Map<string, EdgeHealth>()
  const packageHealths = new Map<string, EdgeHealth>()
  const intrinsicHealths: EdgeHealth[] = []  // for container aggregate
  const apiDeployed = deployed.get('api')
  const apiActive = activeRepos.has('api')

  // Dedupe "no recent runs" failures per repo.
  const reportedMissingRuns = new Set<string>()
  const reportMissing = (repo: string) => {
    if (!reportedMissingRuns.has(repo)) {
      failures.push(`no recent runs: ${repo}`)
      reportedMissingRuns.add(repo)
    }
  }

  for (const host of apiHostRepos) {
    const pkg = routePackageMap[host]
    const published = packageVersions.get(host)?.version
    const deployedVer = apiDeployed?.versions?.[pkg]
    const hostActive = activeRepos.has(host)

    // Intrinsic (version-match-only) health — drives the underlying
    // healthy/broken/idle signal without 'active'. Reused for node colors
    // when the relevant repo isn't actually running.
    let intrinsic: EdgeHealth
    if (!reposWithRuns.has(host)) {
      reportMissing(host)
      intrinsic = 'broken'
    } else if (!reposWithRuns.has('api')) {
      reportMissing('api')
      intrinsic = 'broken'
    } else if (!published) {
      failures.push(`unknown: ${host} has no published route package`)
      intrinsic = 'broken'
    } else if (!deployedVer) {
      failures.push(`unknown: api has not deployed ${pkg} (${host}@${published})`)
      intrinsic = 'broken'
    } else if (deployedVer !== published) {
      failures.push(`mismatch: ${host}@${published} ≠ api.${pkg}@${deployedVer}`)
      intrinsic = 'broken'
    } else {
      intrinsic = 'healthy'
    }
    intrinsicHealths.push(intrinsic)

    // Edge health: active if either endpoint running, else intrinsic.
    edgeHealths.set(host, (hostActive || apiActive) ? 'active' : intrinsic)
    // Host node health: active only if the host itself is running.
    hostNodeHealths.set(host, hostActive ? 'active' : intrinsic)
    // Package node health: active only if api is running.
    packageHealths.set(host, apiActive ? 'active' : intrinsic)
  }

  const expectedPkgs = new Set(Object.values(routePackageMap))
  for (const key of Object.keys(apiDeployed?.versions ?? {})) {
    if (!expectedPkgs.has(key)) {
      failures.push(`orphan: api deployed ${key} but no host row for it`)
    }
  }

  // Container health: api's own running state if active; otherwise
  // aggregate intrinsics across all hosts.
  const containerHealth: EdgeHealth = apiActive
    ? 'active'
    : aggregateHealth(intrinsicHealths)

  const status: GrammarStatus =
    activeRepos.size > 0 ? 'pending'
    : failures.length === 0 ? 'pass'
    : 'fail'
  return { status, failures, edgeHealths, hostNodeHealths, packageHealths, containerHealth }
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
    ? 'Every host package is deployed at its published version with no orphans.'
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

interface CIApiContainerViewProps {
  // When provided, skips SSE and renders the supplied data instead. Used by
  // CIApiTestView to drive the dashboard with controllable fixture state.
  injected?: {
    runs: Map<string, CIRun>
    packageVersions: Map<string, PublishedVersion>
    deployed: Map<string, DeployedVersion>
    versionErrors?: VersionErrors
  }
  titleOverride?: string
}

export default function CIApiContainerView({ injected, titleOverride }: CIApiContainerViewProps = {}) {
  const title = titleOverride ?? 'CI — api'
  const [watching, setWatching] = useState(true)
  const sse = useSSE(watching && !injected)
  const runs = injected?.runs ?? sse.runs
  const packageVersions = injected?.packageVersions ?? sse.packageVersions
  const deployed = injected?.deployed ?? sse.deployed
  const versionErrors = injected?.versionErrors ?? sse.versionErrors
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
    () => checkApiGrammar(runs, packageVersions, deployed),
    [runs, packageVersions, deployed],
  )

  const { nodes, edges } = useMemo(
    () => buildLayout(
      apiHostRepos, runsByRepo, packageVersions, deployed, versionErrors,
      grammar.edgeHealths, grammar.hostNodeHealths, grammar.packageHealths, grammar.containerHealth,
    ),
    [runsByRepo, packageVersions, deployed, versionErrors, grammar.edgeHealths, grammar.hostNodeHealths, grammar.packageHealths, grammar.containerHealth],
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
