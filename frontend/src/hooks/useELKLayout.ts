import { useCallback, useEffect, useState } from 'react'
import ELK, { type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js'
import type { Node, Edge } from '@xyflow/react'

const elk = new ELK()

const DEFAULT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  'elk.spacing.nodeNode': '40',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.edgeRouting': 'ORTHOGONAL',
}

const NODE_WIDTH = 200
const NODE_HEIGHT = 100

// Convert ELK edge sections to an SVG path string
function elkEdgeToPath(edge: ElkExtendedEdge): string | undefined {
  const section = edge.sections?.[0]
  if (!section) return undefined

  const points = [
    section.startPoint,
    ...(section.bendPoints || []),
    section.endPoint,
  ]

  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ')
}

export function useELKLayout(
  inputNodes: Node[],
  inputEdges: Edge[],
  options?: Record<string, string>,
) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [layoutReady, setLayoutReady] = useState(false)

  const runLayout = useCallback(async () => {
    if (inputNodes.length === 0) return

    const graph = {
      id: 'root',
      layoutOptions: { ...DEFAULT_OPTIONS, ...options },
      children: inputNodes.map((node) => ({
        id: node.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_ORDER' },
        ports: [
          { id: `${node.id}-south`, layoutOptions: { 'org.eclipse.elk.port.side': 'SOUTH' } },
          { id: `${node.id}-north`, layoutOptions: { 'org.eclipse.elk.port.side': 'NORTH' } },
        ],
      })),
      edges: inputEdges.map((edge) => ({
        id: edge.id,
        sources: [`${edge.source}-south`],
        targets: [`${edge.target}-north`],
      })),
    }

    const layoutedGraph = await elk.layout(graph)

    // Build a map of ELK edge paths keyed by edge ID
    const elkEdgeMap = new Map<string, string>()
    for (const e of (layoutedGraph.edges || []) as ElkExtendedEdge[]) {
      const path = elkEdgeToPath(e)
      if (path && e.id) elkEdgeMap.set(e.id, path)
    }

    // Apply ELK-computed node positions
    const layoutedNodes = inputNodes.map((node) => {
      const elkNode = layoutedGraph.children?.find((n) => n.id === node.id)
      return {
        ...node,
        position: {
          x: elkNode?.x ?? 0,
          y: elkNode?.y ?? 0,
        },
      }
    })

    // Apply ELK-computed edge paths — edges with paths become hidden
    // (the path is rendered by a custom edge overlay)
    const layoutedEdges = inputEdges.map((edge) => {
      const elkPath = elkEdgeMap.get(edge.id)
      if (elkPath) {
        return {
          ...edge,
          // Store the ELK path for the custom edge renderer
          data: { ...((edge.data as Record<string, unknown>) || {}), elkPath },
          type: 'elk',
        }
      }
      return edge
    })

    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
    setLayoutReady(true)
  }, [inputNodes, inputEdges, options])

  useEffect(() => {
    runLayout()
  }, [runLayout])

  return { nodes, edges, layoutReady }
}
