import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

export interface CIPackageData {
  label: string
  deployedVersion?: string
  badge?: string
}

function CIPackageNodeComponent({ data }: NodeProps) {
  const d = data as unknown as CIPackageData
  return (
    <>
      {/* Handles on all four sides so each view can pick based on its
          cascade direction. /ci/fzt flows left→right (left-tgt / right-src);
          /ci/api stacks top-down (top-tgt / bottom-src). Handles are
          invisible, having extras doesn't affect layout. */}
      <Handle type="target" position={Position.Left} id="left-tgt" className="!bg-transparent !border-0" />
      <Handle type="source" position={Position.Right} id="right-src" className="!bg-transparent !border-0" />
      <Handle type="target" position={Position.Top} id="top-tgt" className="!bg-transparent !border-0" />
      <Handle type="source" position={Position.Bottom} id="bottom-src" className="!bg-transparent !border-0" />
      <div className="rounded-md px-3 py-2 border border-slate-600 bg-[#0f172a] min-w-[140px]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-300 font-mono truncate">{d.label}</span>
          {d.badge && (
            <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-slate-800 text-slate-500 whitespace-nowrap">{d.badge}</span>
          )}
        </div>
        <div className="text-[9px] mt-0.5">
          {d.deployedVersion
            ? <span className="text-cyan-400 font-mono">{d.deployedVersion}</span>
            : <span className="text-slate-600">unknown</span>
          }
        </div>
      </div>
    </>
  )
}

export default memo(CIPackageNodeComponent)
