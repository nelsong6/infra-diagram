import { useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Link } from 'react-router-dom'
import PipelineNodeComponent from './PipelineNode'
import { codexQueueEdges } from '../data/codex-queue-edges'
import { codexQueueNodes } from '../data/codex-queue-nodes'
import { useCodexQueueLive } from '../hooks/useCodexQueueLive'
import type { ConnectionStatus } from '../types/ci'
import type { CodexQueueIssue, CodexQueueSnapshot } from '../types/codexQueue'
import type { PipelineNodeData } from '../data/pipeline-nodes'

const nodeTypes = {
  pipeline: PipelineNodeComponent,
}

const EDGE_RUNNING = new Set([
  'issue-to-queue',
  'queue-to-wakeup',
  'wakeup-to-runner',
  'runner-to-script',
  'script-to-lock',
  'script-to-claim',
  'claim-to-codex',
  'codex-to-outcome',
  'outcome-to-observe',
  'observe-to-log',
  'outcome-back-to-queue',
])

const EDGE_QUEUED = new Set([
  'issue-to-queue',
  'queue-to-wakeup',
])

function timeAgo(dateStr: string | null | undefined) {
  if (!dateStr) return 'unknown'

  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return 'unknown'

  return new Date(dateStr).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function stateBadge(state: CodexQueueSnapshot['overallState']) {
  switch (state) {
    case 'running':
      return 'border-sky-700 bg-sky-950/50 text-sky-200'
    case 'queued':
      return 'border-amber-700 bg-amber-950/50 text-amber-200'
    case 'blocked':
      return 'border-red-700 bg-red-950/50 text-red-200'
    case 'offline':
      return 'border-red-800 bg-red-950/50 text-red-300'
    case 'unsupported':
      return 'border-slate-700 bg-slate-900/90 text-slate-300'
    default:
      return 'border-slate-600 bg-slate-900/80 text-slate-200'
  }
}

function stateLabel(state: CodexQueueSnapshot['overallState']) {
  switch (state) {
    case 'running':
      return 'Running now'
    case 'queued':
      return 'Queued'
    case 'blocked':
      return 'Needs attention'
    case 'offline':
      return 'Offline'
    case 'unsupported':
      return 'Unavailable here'
    default:
      return 'Idle'
  }
}

function pushFreshnessLabel(snapshot: CodexQueueSnapshot | null) {
  if (!snapshot) return 'waiting'
  if (!snapshot.push.enabled) return 'disabled'
  if (snapshot.push.freshness === 'none') return 'no events yet'
  return snapshot.push.freshness
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const color = status === 'connected'
    ? '#22c55e'
    : status === 'connecting'
    ? '#f59e0b'
    : '#ef4444'

  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: color }}
      title={status}
    />
  )
}

function buildNodes(snapshot: CodexQueueSnapshot | null): Node[] {
  if (!snapshot) {
    return codexQueueNodes
  }

  const activeIssue = snapshot.queue.active[0] ?? null
  const waitingIssue = snapshot.queue.waiting[0] ?? null
  const currentIssueNumber = activeIssue?.number ?? snapshot.push.issue?.number ?? null
  const currentIssueTitle = activeIssue?.title ?? snapshot.push.issue?.title ?? null
  const pushRunning = snapshot.push.freshness === 'fresh' && snapshot.push.state === 'running'
  const runnerOnline = snapshot.runner.github?.status === 'online' || snapshot.runner.service?.state === 'Running'
  const wakeupRunning = snapshot.wakeupRun
    ? snapshot.wakeupRun.status === 'queued' || snapshot.wakeupRun.status === 'in_progress'
    : false
  const wakeupFailed = snapshot.wakeupRun
    ? snapshot.wakeupRun.status === 'completed' && snapshot.wakeupRun.conclusion && snapshot.wakeupRun.conclusion !== 'success'
    : false
  const latestOutcome = snapshot.worker.log.summaryCode.startsWith('outcome:')
    ? snapshot.worker.log.summaryCode.slice('outcome:'.length)
    : null

  const overrides: Record<string, Partial<PipelineNodeData>> = {
    'trigger-issue': {
      status: snapshot.queue.inQueueCount > 0 ? 'success' : 'idle',
      statusLabel: snapshot.queue.inQueueCount > 0 ? 'seen' : 'quiet',
      statusDetail: snapshot.queue.inQueueCount > 0
        ? `${snapshot.queue.inQueueCount} issue(s) currently carry codex-queue`
        : 'no new queue signal is waiting right now',
    },
    'trigger-manual': {
      status: 'idle',
      statusLabel: 'manual',
      statusDetail: 'available as an escape hatch, but not active by itself',
    },
    'trigger-fallback': {
      status: snapshot.scheduledTask ? 'success' : 'blocked',
      statusLabel: snapshot.scheduledTask ? 'armed' : 'missing',
      statusDetail: snapshot.scheduledTask
        ? `next run ${formatDate(snapshot.scheduledTask.nextRunTime)}`
        : 'the local scheduled task was not found on this host',
    },
    'github-queue-label': {
      status: snapshot.queue.activeCount > 0 || snapshot.queue.waitingCount > 0
        ? 'queued'
        : snapshot.queue.blockedCount > 0
        ? 'blocked'
        : 'idle',
      statusLabel: snapshot.queue.activeCount > 0
        ? `${snapshot.queue.activeCount} active`
        : snapshot.queue.waitingCount > 0
        ? `${snapshot.queue.waitingCount} waiting`
        : 'empty',
      statusDetail: `${snapshot.queue.waitingCount} waiting, ${snapshot.queue.activeCount} active, ${snapshot.queue.blockedCount} blocked`,
    },
    'github-wakeup': {
      status: wakeupRunning ? 'running' : wakeupFailed ? 'blocked' : snapshot.wakeupRun ? 'success' : 'idle',
      statusLabel: wakeupRunning
        ? 'waking'
        : wakeupFailed
        ? 'failed'
        : snapshot.wakeupRun
        ? snapshot.wakeupRun.conclusion ?? snapshot.wakeupRun.status
        : 'idle',
      statusDetail: snapshot.wakeupRun
        ? `run #${snapshot.wakeupRun.runNumber} updated ${timeAgo(snapshot.wakeupRun.updatedAt)}`
        : 'no wakeup workflow run has been observed yet',
    },
    'worker-runner': {
      status: !runnerOnline && !pushRunning ? 'blocked' : snapshot.runner.github?.busy || pushRunning ? 'running' : 'idle',
      statusLabel: !runnerOnline && !pushRunning
        ? 'offline'
        : snapshot.runner.github?.busy || pushRunning
        ? 'busy'
        : 'idle',
      statusDetail: `service ${snapshot.runner.service?.state ?? 'missing'} | github ${snapshot.runner.github?.status ?? 'missing'}`,
    },
    'worker-script': {
      status: snapshot.overallState === 'running'
        ? 'running'
        : snapshot.overallState === 'queued'
        ? 'queued'
        : snapshot.overallState === 'blocked'
        ? 'blocked'
        : 'idle',
      statusLabel: snapshot.overallState === 'running'
        ? 'draining'
        : snapshot.overallState === 'queued'
        ? 'waiting'
        : snapshot.overallState === 'blocked'
        ? 'attention'
        : 'asleep',
      statusDetail: snapshot.push.freshness === 'fresh' && snapshot.push.message
        ? snapshot.push.message
        : snapshot.worker.log.summary,
    },
    'worker-lock': {
      status: snapshot.worker.lock.present ? 'success' : 'idle',
      statusLabel: snapshot.worker.lock.present ? 'held' : 'free',
      statusDetail: snapshot.worker.lock.present && snapshot.worker.lock.pid
        ? `pid ${snapshot.worker.lock.pid}`
        : 'no lock file is present',
    },
    'exec-claim': {
      status: currentIssueNumber ? 'success' : snapshot.queue.waitingCount > 0 ? 'queued' : 'idle',
      statusLabel: currentIssueNumber ? 'claimed' : snapshot.queue.waitingCount > 0 ? 'ready' : 'waiting',
      statusDetail: currentIssueNumber
        ? `issue #${currentIssueNumber}: ${currentIssueTitle ?? 'current issue'}`
        : waitingIssue
        ? `next up is #${waitingIssue.number}`
        : 'nothing is waiting to be claimed',
    },
    'exec-codex': {
      status: snapshot.overallState === 'running' ? 'running' : 'idle',
      statusLabel: snapshot.overallState === 'running' ? 'in progress' : 'idle',
      statusDetail: currentIssueNumber
        ? `working issue #${currentIssueNumber}`
        : 'no issue is currently inside headless Codex exec',
    },
    'exec-outcome': {
      status: snapshot.overallState === 'running'
        ? 'queued'
        : latestOutcome === 'blocked' || latestOutcome === 'needs_human'
        ? 'blocked'
        : latestOutcome
        ? 'success'
        : 'idle',
      statusLabel: snapshot.overallState === 'running'
        ? 'next'
        : latestOutcome === 'blocked' || latestOutcome === 'needs_human'
        ? 'blocked'
        : latestOutcome
        ? latestOutcome
        : 'idle',
      statusDetail: snapshot.worker.log.summary,
    },
    'observe-surfaces': {
      status: snapshot.overallState === 'running'
        ? 'running'
        : snapshot.overallState === 'queued'
        ? 'queued'
        : snapshot.overallState === 'blocked'
        ? 'blocked'
        : 'idle',
      statusLabel: snapshot.overallState === 'running'
        ? 'moving'
        : snapshot.overallState === 'queued'
        ? 'waiting'
        : snapshot.overallState === 'blocked'
        ? 'check'
        : 'quiet',
      statusDetail: snapshot.reasons[0] ?? 'watch the issue page, runner state, Actions run, and worker log together',
    },
    'observe-log': {
      status: !snapshot.worker.log.exists
        ? 'blocked'
        : snapshot.overallState === 'running'
        ? 'running'
        : snapshot.worker.log.summaryCode === 'queue_empty'
        ? 'success'
        : 'idle',
      statusLabel: !snapshot.worker.log.exists
        ? 'missing'
        : snapshot.overallState === 'running'
        ? 'appending'
        : snapshot.worker.log.summaryCode === 'queue_empty'
        ? 'empty'
        : 'quiet',
      statusDetail: snapshot.worker.log.exists
        ? `updated ${timeAgo(snapshot.worker.log.lastWriteTime)}`
        : 'worker.log was not found',
    },
    'observe-drain': {
      status: snapshot.overallState === 'running'
        ? 'running'
        : snapshot.overallState === 'queued'
        ? 'queued'
        : snapshot.overallState === 'blocked'
        ? 'blocked'
        : 'success',
      statusLabel: snapshot.overallState === 'running'
        ? 'draining'
        : snapshot.overallState === 'queued'
        ? 'waiting'
        : snapshot.overallState === 'blocked'
        ? 'attention'
        : 'empty',
      statusDetail: snapshot.overallState === 'running'
        ? `${snapshot.queue.waitingCount} waiting after the current issue`
        : snapshot.reasons[0] ?? 'the outer loop is currently at rest',
    },
  }

  return codexQueueNodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      ...(overrides[node.id] ?? {}),
    },
  }))
}

function buildEdges(snapshot: CodexQueueSnapshot | null): Edge[] {
  const highlighted = !snapshot
    ? new Set()
    : snapshot.overallState === 'running'
    ? EDGE_RUNNING
    : snapshot.overallState === 'queued'
    ? EDGE_QUEUED
    : new Set<string>()

  return codexQueueEdges.map((edge) => {
    const isRecovery = edge.id === 'fallback-to-script'
    const isHighlighted = highlighted.has(edge.id)

    return {
      ...edge,
      animated: isHighlighted,
      style: {
        ...edge.style,
        opacity: isRecovery ? 0.95 : highlighted.size === 0 ? 0.35 : isHighlighted ? 1 : 0.22,
        strokeWidth: isHighlighted ? 2.4 : edge.style?.strokeWidth,
      },
    }
  })
}

function IssueList({
  issues,
  empty,
}: {
  issues: CodexQueueIssue[]
  empty: string
}) {
  if (issues.length === 0) {
    return <div className="text-[11px] text-slate-500">{empty}</div>
  }

  return (
    <div className="space-y-2">
      {issues.slice(0, 3).map((issue) => (
        <a
          key={issue.number}
          href={issue.url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 transition-colors hover:border-slate-700"
        >
          <div className="text-xs font-medium text-slate-100">#{issue.number} {issue.title}</div>
          <div className="mt-1 text-[10px] text-slate-500">updated {timeAgo(issue.updatedAt)}</div>
        </a>
      ))}
    </div>
  )
}

export default function CodexQueueView() {
  const [watching, setWatching] = useState(true)
  const { snapshot, status, problem } = useCodexQueueLive(watching)

  const nodes = useMemo(() => buildNodes(snapshot), [snapshot])
  const edges = useMemo(() => buildEdges(snapshot), [snapshot])

  const titleState = snapshot?.overallState ?? 'unsupported'
  const headline = snapshot
    ? stateLabel(snapshot.overallState)
    : status === 'connecting'
    ? 'Connecting'
    : 'Waiting for data'

  return (
    <div className="w-screen h-screen bg-[#0f172a]">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-4">
        <Link
          to="/ci"
          className="text-xs text-slate-500 transition-colors hover:text-slate-300"
        >
          &larr; ci
        </Link>
        <h1 className="text-sm font-bold text-slate-300">Codex Queue Dashboard</h1>
        <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/90 px-2 py-0.5 text-[10px] text-slate-400">
          <StatusDot status={status} />
          live
        </div>
        {snapshot && (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] ${stateBadge(titleState)}`}>
            {headline}
          </span>
        )}
      </div>

      <div className="absolute top-4 right-4 z-10 flex items-center gap-3">
        <button
          onClick={() => setWatching((current) => !current)}
          className={`rounded-md border px-3 py-1 text-xs transition-colors ${
            watching
              ? 'border-green-700 bg-green-900/20 text-green-400 hover:bg-green-900/40'
              : 'border-slate-700 bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`}
        >
          {watching ? 'watching' : 'paused'}
        </button>
      </div>

      <div className="absolute top-16 left-4 z-10 w-[360px] rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl shadow-black/30">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Now</div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-100">{headline}</div>
            <div className="mt-1 text-xs text-slate-400">
              {snapshot ? `${snapshot.host} • ${snapshot.repo}` : 'Waiting for the local backend snapshot'}
            </div>
          </div>
          {snapshot && (
            <div className={`rounded-lg border px-3 py-2 text-center ${stateBadge(snapshot.overallState)}`}>
              <div className="text-[10px] uppercase tracking-[0.18em]">State</div>
              <div className="mt-1 text-sm font-semibold">{stateLabel(snapshot.overallState)}</div>
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Waiting</div>
            <div className="mt-1 text-lg font-semibold text-amber-300">{snapshot?.queue.waitingCount ?? '-'}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Active</div>
            <div className="mt-1 text-lg font-semibold text-sky-300">{snapshot?.queue.activeCount ?? '-'}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Blocked</div>
            <div className="mt-1 text-lg font-semibold text-red-300">{snapshot?.queue.blockedCount ?? '-'}</div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Why this state</div>
            <div className="mt-1 text-xs leading-relaxed text-slate-200">
              {snapshot?.reasons[0] ?? (problem ?? 'Waiting for the first live snapshot from the backend.')}
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Observed</div>
            <div className="mt-1 text-xs text-slate-200">
              {snapshot ? `${formatDate(snapshot.observedAt)} (${timeAgo(snapshot.observedAt)})` : status}
            </div>
          </div>

          {problem && (
            <div className="rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-xs text-red-200">
              {problem}
            </div>
          )}
        </div>
      </div>

      <div className="absolute top-16 right-4 z-10 w-[390px] space-y-3">
        <div className="rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl shadow-black/30">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Watch</div>
          <div className="mt-3 grid gap-2">
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Push signal</div>
              <div className="mt-1 text-xs text-slate-200">
                {pushFreshnessLabel(snapshot)}
                {snapshot?.push.state ? ` | ${snapshot.push.state}` : ''}
              </div>
              <div className="text-[10px] text-slate-500">
                {snapshot?.push.lastEventAt
                  ? `${snapshot.push.lastEventType ?? 'event'} from ${snapshot.push.sourceHost ?? 'worker'} ${timeAgo(snapshot.push.lastEventAt)}`
                  : 'waiting for the first signed worker event'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Runner</div>
              <div className="mt-1 text-xs text-slate-200">
                GitHub: {snapshot?.runner.github?.status ?? 'missing'} {snapshot?.runner.github?.busy ? '(busy)' : ''}
              </div>
              <div className="text-[10px] text-slate-500">
                Service: {snapshot?.runner.service?.state ?? 'missing'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Wakeup run</div>
              {snapshot?.wakeupRun ? (
                <a
                  href={snapshot.wakeupRun.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-xs text-slate-200 hover:text-slate-100"
                >
                  {snapshot.wakeupRun.status}
                  {snapshot.wakeupRun.conclusion ? ` / ${snapshot.wakeupRun.conclusion}` : ''}
                  {' • '}
                  updated {timeAgo(snapshot.wakeupRun.updatedAt)}
                </a>
              ) : (
                <div className="mt-1 text-xs text-slate-500">no wakeup workflow data yet</div>
              )}
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Scheduled task</div>
              <div className="mt-1 text-xs text-slate-200">
                {snapshot?.scheduledTask ? `${snapshot.scheduledTask.state} • ${snapshot.scheduledTask.interval ?? 'manual'}` : 'missing'}
              </div>
              <div className="text-[10px] text-slate-500">
                next run {snapshot?.scheduledTask ? formatDate(snapshot.scheduledTask.nextRunTime) : 'unknown'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Worker log</div>
              <div className="mt-1 text-xs text-slate-200">{snapshot?.worker.log.summary ?? 'waiting for log data'}</div>
              <div className="text-[10px] text-slate-500">
                {snapshot?.worker.log.exists ? `updated ${timeAgo(snapshot.worker.log.lastWriteTime)}` : 'log file missing'}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl shadow-black/30">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Queue detail</div>
          <div className="mt-3">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Active issue</div>
            <IssueList issues={snapshot?.queue.active ?? []} empty="No active issue right now." />
          </div>
          <div className="mt-4">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">Waiting issues</div>
            <IssueList issues={snapshot?.queue.waiting ?? []} empty="No waiting issues in codex-queue." />
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl shadow-black/30">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Recent log lines</div>
          <pre className="mt-3 max-h-[190px] overflow-auto rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-[10px] leading-relaxed text-slate-300">
{snapshot?.worker.log.recentLines.length
  ? snapshot.worker.log.recentLines.join('\n')
  : 'No worker log lines yet.'}
          </pre>
          {snapshot?.supportNotes.length ? (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-400">
              {snapshot.supportNotes.join(' ')}
            </div>
          ) : null}
        </div>
      </div>

      <div className="absolute bottom-4 left-24 z-10 flex flex-wrap gap-4 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: '#475569' }} /> idle
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: '#f59e0b' }} /> queued / waiting
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: '#38bdf8' }} /> running now
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: '#22c55e' }} /> healthy handoff
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: '#ef4444' }} /> blocked / offline
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: '#ef4444' }} /> fallback poll
        </span>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.14, maxZoom: 0.82 }}
        minZoom={0.35}
        maxZoom={1.6}
        defaultEdgeOptions={{ type: 'smoothstep' }}
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
