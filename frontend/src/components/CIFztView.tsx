import CIView from './CIView'
import { fztLayout, fztEdges } from '../data/ci-views'

export default function CIFztView() {
  return <CIView title="CI — fzt" layout={fztLayout} edges={fztEdges} />
}
