import { MarkerType } from '@xyflow/react'

// Shared edge-styling helpers for the /ci/* cascade views. Keeps edge
// appearance consistent across /ci/fzt, /ci/api, /ci/tofu.
//
// Design:
// - Idle edges are visible structural backdrop (slate-500 @ 0.7 opacity).
//   Enough contrast against slate-900 bg to read without competing with
//   active edges.
// - Active (cascading) edges are amber (#f59e0b), width 2, full opacity.
//   The COLOR difference (not width/opacity alone) is what makes activity
//   pop.
// - Every edge gets a filled-arrow terminator at the consumer end in the
//   matching color.

export const IDLE_COLOR = '#64748b'    // slate-500
export const ACTIVE_COLOR = '#f59e0b'  // amber-500

export function edgeStyle(cascading: boolean) {
  return {
    stroke: cascading ? ACTIVE_COLOR : IDLE_COLOR,
    strokeWidth: cascading ? 2 : 1,
    opacity: cascading ? 1 : 0.7,
  }
}

export function edgeMarker(cascading: boolean) {
  return {
    type: MarkerType.ArrowClosed,
    color: cascading ? ACTIVE_COLOR : IDLE_COLOR,
    width: 18,
    height: 18,
  }
}
