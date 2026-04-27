import { MarkerType, type Edge } from '@xyflow/react'

const labelStyle = { fill: '#94a3b8', fontSize: 9 }
const markerEnd = { type: MarkerType.ArrowClosed, color: '#64748b' }

const flow = { stroke: '#38bdf8', strokeWidth: 2 }
const support = { stroke: '#a78bfa', strokeWidth: 1.6 }
const guardrail = { stroke: '#f97316', strokeWidth: 1.8, strokeDasharray: '6 4' }
const evidence = { stroke: '#22c55e', strokeWidth: 1.8 }

export const spireLensWorkflowEdges: Edge[] = [
  {
    id: 'issue-planner',
    source: 'issue',
    target: 'planner',
    style: flow,
    markerEnd,
    label: 'request',
    labelStyle,
  },
  {
    id: 'base-planner',
    source: 'base-saves',
    target: 'planner',
    style: support,
    markerEnd,
    label: 'available starts',
    labelStyle,
  },
  {
    id: 'catalog-planner',
    source: 'catalog',
    target: 'planner',
    style: support,
    markerEnd,
    label: 'identity lookup',
    labelStyle,
  },
  {
    id: 'planner-materialize',
    source: 'planner',
    target: 'materialize',
    style: flow,
    markerEnd,
    label: 'scenario recipe',
    labelStyle,
  },
  {
    id: 'planner-abort',
    source: 'planner',
    target: 'abort',
    style: guardrail,
    markerEnd,
    label: 'fail closed',
    labelStyle,
  },
  {
    id: 'materialize-install',
    source: 'materialize',
    target: 'two-path-install',
    style: flow,
    markerEnd,
    label: 'current_run.save',
    labelStyle,
  },
  {
    id: 'install-launch',
    source: 'two-path-install',
    target: 'launch',
    style: flow,
    markerEnd,
    label: 'game starts clean',
    labelStyle,
  },
  {
    id: 'launch-runtime',
    source: 'launch',
    target: 'runtime-setup',
    style: flow,
    markerEnd,
    label: 'combat exists',
    labelStyle,
  },
  {
    id: 'runtime-agent',
    source: 'runtime-setup',
    target: 'test-agent',
    style: flow,
    markerEnd,
    label: 'controlled state',
    labelStyle,
  },
  {
    id: 'agent-screenshots',
    source: 'test-agent',
    target: 'screenshots',
    style: evidence,
    markerEnd,
    label: 'visual proof',
    labelStyle,
  },
  {
    id: 'agent-summary',
    source: 'test-agent',
    target: 'summary',
    style: evidence,
    markerEnd,
    label: 'json result',
    labelStyle,
  },
  {
    id: 'screenshots-summary',
    source: 'screenshots',
    target: 'summary',
    style: evidence,
    markerEnd,
    label: 'attached evidence',
    labelStyle,
  },
  {
    id: 'agent-abort',
    source: 'test-agent',
    target: 'abort',
    style: guardrail,
    markerEnd,
    label: 'unsafe or failed',
    labelStyle,
  },
]
