import CIView from './CIView'
import { overviewLayout, overviewEdges } from '../data/ci-views'

export default function CIDashboardView() {
  return <CIView title="CI Dashboard" layout={overviewLayout} edges={overviewEdges} />
}
