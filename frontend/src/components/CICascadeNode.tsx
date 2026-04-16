import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CIRun } from '../types/ci'

export interface CICascadeData {
  label: string
  runs: CIRun[]
  consumed?: { label: string; version?: string }
  provided?: { label: string; version?: string }
}

function getStatus(runs: CIRun[]) {
  if (runs.length === 0) return 'idle'
  if (runs.some(r => r.status === 'in_progress')) return 'in_progress'
  if (runs.some(r => r.status === 'queued')) return 'queued'
  const latest = runs.reduce((a, b) => new Date(a.updatedAt) > new Date(b.updatedAt) ? a : b)
  if (latest.conclusion === 'failure') return 'failure'
  if (latest.conclusion === 'success') return 'success'
  if (latest.conclusion === 'cancelled') return 'cancelled'
  return 'idle'
}

const BORDER_COLORS: Record<string, string> = {
  idle: '#475569',
  queued: '#f59e0b',
  in_progress: '#38bdf8',
  success: '#22c55e',
  failure: '#ef4444',
  cancelled: '#64748b',
}

const BG_COLORS: Record<string, string> = {
  idle: '#0f172a',
  queued: '#1a1500',
  in_progress: '#0c1929',
  success: '#0a1a0f',
  failure: '#1a0f0f',
  cancelled: '#0f172a',
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

function PackageBox({ label, version }: { label: string; version?: string }) {
  return (
    <div className="rounded-md px-3 py-2 border border-slate-600 bg-[#0f172a] mx-3">
      <div className="text-[10px] text-slate-300 font-mono truncate">{label}</div>
      <div className="text-[9px] mt-0.5">
        {version
          ? <span className="text-cyan-400 font-mono">{version}</span>
          : <span className="text-slate-600">unknown</span>
        }
      </div>
    </div>
  )
}

function CICascadeNodeComponent({ data }: NodeProps) {
  const d = data as unknown as CICascadeData
  const status = getStatus(d.runs)
  const borderColor = BORDER_COLORS[status] || BORDER_COLORS.idle
  const bgColor = BG_COLORS[status] || BG_COLORS.idle
  const latestRun = d.runs.length > 0
    ? d.runs.reduce((a, b) => new Date(a.updatedAt) > new Date(b.updatedAt) ? a : b)
    : null

  return (
    <div
      className={`rounded-lg border-2 min-w-[200px] transition-all duration-500 ${
        status === 'in_progress' ? 'animate-pulse' : ''
      }`}
      style={{ borderColor, backgroundColor: bgColor, boxShadow: status !== 'idle' && status !== 'cancelled' ? `0 0 8px ${borderColor}44` : 'none' }}
    >
      {/* Target handle at very top — for incoming edges from upstream provider */}
      <Handle type="target" position={Position.Top} id="top-tgt" className="!bg-transparent !border-0" />

      {/* Consumed package — above title */}
      {d.consumed && (
        <div className="pt-3 pb-1">
          <Handle type="target" position={Position.Top} id="consumed-tgt" className="!bg-transparent !border-0" />
          <PackageBox label={d.consumed.label} version={d.consumed.version} />
        </div>
      )}

      {/* Title + status — center */}
      <div className={`px-4 ${d.consumed ? 'py-2' : 'py-3'} ${d.provided ? '' : 'pb-3'}`}>
        <div className="font-bold text-sm text-slate-200">{d.label}</div>
        {latestRun && (
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
        )}
        {!latestRun && (
          <div className="text-[10px] text-slate-600 mt-1">No recent runs</div>
        )}
      </div>

      {/* Provided package — below title */}
      {d.provided && (
        <div className="pb-3 pt-1">
          <PackageBox label={d.provided.label} version={d.provided.version} />
          <Handle type="source" position={Position.Bottom} id="provided-src" className="!bg-transparent !border-0" />
        </div>
      )}

      {/* Source handle at very bottom — for outgoing edges to downstream consumers */}
      <Handle type="source" position={Position.Bottom} id="bottom-src" className="!bg-transparent !border-0" />
    </div>
  )
}

export default memo(CICascadeNodeComponent)
