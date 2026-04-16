import CIView from './CIView'
import { tofuLayout, tofuEdges } from '../data/ci-views'

export default function CITofuView() {
  return <CIView title="CI — tofu" layout={tofuLayout} edges={tofuEdges} />
}
