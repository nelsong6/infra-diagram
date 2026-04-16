import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CIRun } from '../types/ci'

export interface CINodeData {
  label: string
  repoName: string
  runs: CIRun[]
}

const STATUS_COLORS = {
  idle: { border: '#475569', bg: '#0f172a', glow: 'none' },
  queued: { border: '#f59e0b', bg: '#1a1500', glow: '0 0 8px #f59e0b44' },
  in_progress: { border: '#38bdf8', bg: '#0c1929', glow: '0 0 12px #38bdf844' },
  success: { border: '#22c55e', bg: '#0a1a0f', glow: '0 0 8px #22c55e33' },
  failure: { border: '#ef4444', bg: '#1a0f0f', glow: '0 0 8px #ef444444' },
  cancelled: { border: '#64748b', bg: '#0f172a', glow: 'none' },
}

function getNodeStatus(runs: CIRun[]): keyof typeof STATUS_COLORS {
  if (runs.length === 0) return 'idle'

  // Priority: in_progress > queued > failure > success > cancelled
  if (runs.some(r => r.status === 'in_progress')) return 'in_progress'
  if (runs.some(r => r.status === 'queued')) return 'queued'
  if (runs.some(r => r.conclusion === 'failure')) return 'failure'
  if (runs.some(r => r.conclusion === 'success')) return 'success'
  if (runs.some(r => r.conclusion === 'cancelled')) return 'cancelled'
  return 'idle'
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function CIPipelineNodeComponent({ data }: NodeProps) {
  const d = data as unknown as CINodeData
  const status = getNodeStatus(d.runs)
  const colors = STATUS_COLORS[status]
  const latestRun = d.runs.length > 0
    ? d.runs.reduce((a, b) => new Date(a.updatedAt) > new Date(b.updatedAt) ? a : b)
    : null

  return (
    <>
      <Handle type="source" position={Position.Top} id="top-src" className="!bg-transparent !border-0" />
      <Handle type="target" position={Position.Top} id="top-tgt" className="!bg-transparent !border-0" />
      <Handle type="source" position={Position.Bottom} id="bottom-src" className="!bg-transparent !border-0" />
      <Handle type="target" position={Position.Bottom} id="bottom-tgt" className="!bg-transparent !border-0" />
      <Handle type="source" position={Position.Right} id="right-src" className="!bg-transparent !border-0" />
      <Handle type="target" position={Position.Right} id="right-tgt" className="!bg-transparent !border-0" />
      <Handle type="source" position={Position.Left} id="left-src" className="!bg-transparent !border-0" />
      <Handle type="target" position={Position.Left} id="left-tgt" className="!bg-transparent !border-0" />
      <div
        className={`rounded-lg px-4 py-3 border-2 min-w-[180px] transition-all duration-500 ${
          status === 'in_progress' ? 'animate-pulse' : ''
        }`}
        style={{
          backgroundColor: colors.bg,
          borderColor: colors.border,
          boxShadow: colors.glow,
        }}
        onClick={() => latestRun && window.open(latestRun.htmlUrl, '_blank')}
        role={latestRun ? 'link' : undefined}
      >
        <div className="font-bold text-sm text-slate-200">{d.label}</div>

        {latestRun && (
          <div className="mt-1.5 space-y-0.5">
            <div className="text-[10px] text-slate-400 font-mono truncate max-w-[200px]">
              {latestRun.workflow}
            </div>
            <div className="text-[10px] text-slate-500 truncate max-w-[200px]">
              {latestRun.commitMessage}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                status === 'success' ? 'bg-green-900/40 text-green-400' :
                status === 'failure' ? 'bg-red-900/40 text-red-400' :
                status === 'in_progress' ? 'bg-blue-900/40 text-blue-400' :
                status === 'queued' ? 'bg-amber-900/40 text-amber-400' :
                'bg-slate-800 text-slate-500'
              }`}>
                {latestRun.conclusion || latestRun.status}
              </span>
              <span className="text-[9px] text-slate-600">
                {timeAgo(latestRun.updatedAt)}
              </span>
            </div>
          </div>
        )}

        {!latestRun && (
          <div className="text-[10px] text-slate-600 mt-1">No recent runs</div>
        )}

        {d.runs.length > 1 && (
          <div className="text-[9px] text-slate-600 mt-1">
            +{d.runs.length - 1} more
          </div>
        )}
      </div>
    </>
  )
}

export default memo(CIPipelineNodeComponent)
