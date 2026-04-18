import { useMemo, useState } from 'react'
import CIFztView from './CIFztView'
import type { CIRun, PublishedVersion, DeployedVersion } from '../types/ci'
import {
  TEST_RUN_STATUSES, TEST_VERSION_STATES,
  type TestRunStatus, type TestVersionState,
  makeRun, makeVersion, makeDeployed,
} from '../fixtures/ciTestHelpers'

// Repos tracked on /ci/fzt. Order matches the view layout.
const FZT_REPOS = [
  'fzt', 'fzt-frontend', 'fzt-terminal',
  'fzt-browser', 'fzt-automate', 'fzt-picker',
  'my-homepage', 'fzt-showcase',
]

// Each verification edge (producer -> consumer) that the grammar check walks.
// Mirrors VERIFICATION_EDGES inside CIFztView for controllable per-edge state.
const FZT_EDGES: Array<readonly [string, string, string]> = [
  ['fzt',          'fzt-frontend', 'fzt'],
  ['fzt',          'fzt-terminal', 'fzt'],
  ['fzt-frontend', 'fzt-terminal', 'fztFrontend'],
  ['fzt-terminal', 'fzt-browser',  'fztTerminal'],
  ['fzt-terminal', 'fzt-automate', 'fztTerminal'],
  ['fzt-terminal', 'fzt-picker',   'fztTerminal'],
  ['fzt-browser',  'my-homepage',  'fztBrowser'],
  ['fzt-browser',  'fzt-showcase', 'fztBrowser'],
]

// Canonical "healthy" version per producer repo. When the corresponding edge
// state is 'match', consumers inherit this. 'mismatch' injects a different
// version on the consumer side. 'unknown' omits the producer's release.
const PRODUCER_VERSIONS: Record<string, string> = {
  'fzt': 'v0.2.55',
  'fzt-frontend': 'v0.1.9',
  'fzt-terminal': 'v0.1.52',
  'fzt-browser': 'v0.1.16',
}

// Seed state: a mix that surfaces each grammar outcome at least once.
function defaultRunStates(): Record<string, TestRunStatus> {
  const r: Record<string, TestRunStatus> = {}
  for (const repo of FZT_REPOS) r[repo] = 'success'
  r['fzt-terminal'] = 'in_progress'
  r['fzt-picker'] = 'no_runs'
  return r
}

function defaultEdgeStates(): Record<string, TestVersionState> {
  const r: Record<string, TestVersionState> = {}
  for (const [p, c, f] of FZT_EDGES) {
    r[`${p}|${c}|${f}`] = 'match'
  }
  // Force one broken edge so we see red.
  r['fzt-terminal|fzt-automate|fztTerminal'] = 'mismatch'
  return r
}

export default function CIFztTestView() {
  const [runStates, setRunStates] = useState<Record<string, TestRunStatus>>(defaultRunStates)
  const [edgeStates, setEdgeStates] = useState<Record<string, TestVersionState>>(defaultEdgeStates)

  const injected = useMemo(() => {
    const runs = new Map<string, CIRun>()
    for (const repo of FZT_REPOS) {
      const run = makeRun(repo, runStates[repo])
      if (run) runs.set(`${run.repo}/${run.runId}`, run)
    }

    // Versions: producer releases. 'unknown' on any outgoing edge removes the
    // producer's release entirely; 'match' / 'mismatch' keep it.
    const versions = new Map<string, PublishedVersion>()
    for (const producer of Object.keys(PRODUCER_VERSIONS)) {
      const hasUnknown = FZT_EDGES.some(([p, c, f]) =>
        p === producer && edgeStates[`${p}|${c}|${f}`] === 'unknown',
      )
      if (!hasUnknown) versions.set(producer, makeVersion(producer, PRODUCER_VERSIONS[producer]))
    }

    // Deployed versions: per-consumer, per-field. 'match' copies producer's;
    // 'mismatch' uses a distinct sentinel. 'unknown' omits the field.
    const perConsumerVersions: Record<string, Record<string, string>> = {}
    for (const [producer, consumer, field] of FZT_EDGES) {
      const state = edgeStates[`${producer}|${consumer}|${field}`]
      if (!perConsumerVersions[consumer]) perConsumerVersions[consumer] = {}
      if (state === 'match') {
        perConsumerVersions[consumer][field] = PRODUCER_VERSIONS[producer]
      } else if (state === 'mismatch') {
        perConsumerVersions[consumer][field] = 'v9.9.9'
      }
    }
    const deployed = new Map<string, DeployedVersion>()
    for (const [consumer, versionMap] of Object.entries(perConsumerVersions)) {
      deployed.set(consumer, makeDeployed(`github.com/nelsong6/${consumer}`, consumer, versionMap))
    }

    return { runs, versions, deployed }
  }, [runStates, edgeStates])

  return (
    <div className="w-screen h-screen relative">
      <CIFztView injected={injected} titleOverride="CI — fzt (test)" />
      <TestControlPanel
        repos={FZT_REPOS}
        edges={FZT_EDGES}
        runStates={runStates}
        edgeStates={edgeStates}
        onRunChange={(repo, s) => setRunStates(prev => ({ ...prev, [repo]: s }))}
        onEdgeChange={(key, s) => setEdgeStates(prev => ({ ...prev, [key]: s }))}
      />
    </div>
  )
}

function TestControlPanel({
  repos, edges, runStates, edgeStates, onRunChange, onEdgeChange,
}: {
  repos: string[]
  edges: Array<readonly [string, string, string]>
  runStates: Record<string, TestRunStatus>
  edgeStates: Record<string, TestVersionState>
  onRunChange: (repo: string, status: TestRunStatus) => void
  onEdgeChange: (key: string, state: TestVersionState) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div
      className="absolute top-20 left-4 z-20 bg-slate-900/95 border border-slate-700 rounded-lg shadow-xl text-slate-200"
      style={{ maxHeight: 'calc(100vh - 6rem)', width: open ? 360 : 'auto', overflow: 'auto' }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 sticky top-0 bg-slate-900/95">
        <span className="text-xs font-bold">test controls</span>
        <button
          className="text-xs text-slate-400 hover:text-slate-200"
          onClick={() => setOpen(o => !o)}
        >
          {open ? 'collapse' : 'expand'}
        </button>
      </div>
      {open && (
        <div className="p-3 space-y-4 text-[11px]">
          <section>
            <div className="text-slate-400 uppercase tracking-wider mb-2">run status per repo</div>
            <div className="space-y-1">
              {repos.map(repo => (
                <div key={repo} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-slate-300">{repo}</span>
                  <select
                    className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-slate-200"
                    value={runStates[repo]}
                    onChange={e => onRunChange(repo, e.target.value as TestRunStatus)}
                  >
                    {TEST_RUN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </section>
          <section>
            <div className="text-slate-400 uppercase tracking-wider mb-2">version match per edge</div>
            <div className="space-y-1">
              {edges.map(([p, c, f]) => {
                const key = `${p}|${c}|${f}`
                return (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-slate-300 truncate" title={`${p} → ${c} (${f})`}>
                      {p}→{c}
                    </span>
                    <select
                      className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-slate-200"
                      value={edgeStates[key]}
                      onChange={e => onEdgeChange(key, e.target.value as TestVersionState)}
                    >
                      {TEST_VERSION_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
