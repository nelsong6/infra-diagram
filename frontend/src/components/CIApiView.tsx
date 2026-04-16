import CIView from './CIView'
import { apiLayout, apiEdges } from '../data/ci-views'

export default function CIApiView() {
  return <CIView title="CI — api" layout={apiLayout} edges={apiEdges} />
}
