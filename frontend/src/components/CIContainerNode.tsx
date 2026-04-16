import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CIRun } from '../types/ci'

export interface CIContainerData {
  label: string
  containerWidth: number
  containerHeight: number
  runs: CIRun[]
}

function getContainerStatus(runs: CIRun[]) {
  if (runs.length === 0) return 'idle'
  if (runs.some(r => r.status === 'in_progress')) return 'in_progress'
  if (runs.some(r => r.status === 'queued')) return 'queued'
  if (runs.some(r => r.conclusion === 'failure')) return 'failure'
  if (runs.some(r => r.conclusion === 'success')) return 'success'
  return 'idle'
}

const BORDER_COLORS: Record<string, string> = {
  idle: '#475569',
  queued: '#f59e0b',
  in_progress: '#38bdf8',
  success: '#22c55e',
  failure: '#ef4444',
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

function CIContainerNodeComponent({ data }: NodeProps) {
  const d = data as unknown as CIContainerData
  const status = getContainerStatus(d.runs)
  const borderColor = BORDER_COLORS[status] || BORDER_COLORS.idle
  const latestRun = d.runs.length > 0
    ? d.runs.reduce((a, b) => new Date(a.updatedAt) > new Date(b.updatedAt) ? a : b)
    : null

  return (
    <div
      style={{
        width: d.containerWidth,
        height: d.containerHeight,
        border: `2px dashed ${borderColor}`,
        borderRadius: '12px',
        backgroundColor: '#0f172a66',
      }}
      className="px-4 pt-3"
    >
      <Handle type="source" position={Position.Bottom} id="bottom-src" className="!bg-transparent !border-0" />
      <Handle type="target" position={Position.Top} id="top-tgt" className="!bg-transparent !border-0" />
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-slate-400">{d.label}</span>
        {latestRun && (
          <>
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
          </>
        )}
      </div>
    </div>
  )
}

export default memo(CIContainerNodeComponent)
