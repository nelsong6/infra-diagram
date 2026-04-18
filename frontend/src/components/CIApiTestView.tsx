import { useMemo, useState } from 'react'
import CIApiContainerView from './CIApiContainerView'
import type { CIRun, PublishedVersion, DeployedVersion } from '../types/ci'
import { apiHostRepos, routePackageMap } from '../data/ci-views'
import {
  TEST_RUN_STATUSES, TEST_VERSION_STATES,
  type TestRunStatus, type TestVersionState,
  makeRun, makeVersion, makeDeployed,
} from '../fixtures/ciTestHelpers'

// Hosts + api. 'api' is included so we can toggle its own pipeline state,
// which affects container/package coloring separately from host coloring.
const API_REPOS = ['api', ...apiHostRepos]

function defaultRunStates(): Record<string, TestRunStatus> {
  const r: Record<string, TestRunStatus> = {}
  for (const repo of API_REPOS) r[repo] = 'success'
  r['api'] = 'in_progress'      // exercises container active state
  r['llm-explorer'] = 'no_runs' // exercises "no recent runs" demote
  return r
}

function defaultEdgeStates(): Record<string, TestVersionState> {
  const r: Record<string, TestVersionState> = {}
  for (const host of apiHostRepos) r[host] = 'match'
  r['kill-me'] = 'mismatch' // one broken edge
  return r
}

// A canonical version per host's route package. 'match' copies it to the api
// deployed map; 'mismatch' uses a distinct value; 'unknown' omits the host's
// published package version.
const HOST_VERSIONS: Record<string, string> = Object.fromEntries(
  apiHostRepos.map((r, i) => [r, `0.${i + 1}.0`]),
)

export default function CIApiTestView() {
  const [runStates, setRunStates] = useState<Record<string, TestRunStatus>>(defaultRunStates)
  const [edgeStates, setEdgeStates] = useState<Record<string, TestVersionState>>(defaultEdgeStates)

  const injected = useMemo(() => {
    const runs = new Map<string, CIRun>()
    for (const repo of API_REPOS) {
      const run = makeRun(repo, runStates[repo])
      if (run) runs.set(`${run.repo}/${run.runId}`, run)
    }

    // Package versions per host (keyed by host repo name like the real API).
    const packageVersions = new Map<string, PublishedVersion>()
    for (const host of apiHostRepos) {
      if (edgeStates[host] !== 'unknown') {
        packageVersions.set(host, makeVersion(host, HOST_VERSIONS[host]))
      }
    }

    // api's deployed route-package versions. Key is the pkg short name.
    const apiDeployedVersions: Record<string, string> = {}
    for (const host of apiHostRepos) {
      const state = edgeStates[host]
      const pkg = routePackageMap[host]
      if (state === 'match') apiDeployedVersions[pkg] = HOST_VERSIONS[host]
      else if (state === 'mismatch') apiDeployedVersions[pkg] = '9.9.9'
    }
    const deployed = new Map<string, DeployedVersion>()
    // Key matches how useSSE populates the map (by `repo`, not `owner/repo`).
    deployed.set('api', makeDeployed('api.romaine.life', 'api', apiDeployedVersions))

    return { runs, packageVersions, deployed, versionErrors: {} }
  }, [runStates, edgeStates])

  return (
    <div className="w-screen h-screen relative">
      <CIApiContainerView injected={injected} titleOverride="CI — api (test)" />
      <TestControlPanel
        repos={API_REPOS}
        hosts={apiHostRepos}
        runStates={runStates}
        edgeStates={edgeStates}
        onRunChange={(repo, s) => setRunStates(prev => ({ ...prev, [repo]: s }))}
        onEdgeChange={(host, s) => setEdgeStates(prev => ({ ...prev, [host]: s }))}
      />
    </div>
  )
}

function TestControlPanel({
  repos, hosts, runStates, edgeStates, onRunChange, onEdgeChange,
}: {
  repos: string[]
  hosts: string[]
  runStates: Record<string, TestRunStatus>
  edgeStates: Record<string, TestVersionState>
  onRunChange: (repo: string, status: TestRunStatus) => void
  onEdgeChange: (host: string, state: TestVersionState) => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div
      className="absolute top-4 right-4 z-20 bg-slate-900/95 border border-slate-700 rounded-lg shadow-xl text-slate-200"
      style={{ maxHeight: 'calc(100vh - 2rem)', width: open ? 320 : 'auto', overflow: 'auto' }}
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
            <div className="text-slate-400 uppercase tracking-wider mb-2">version match per host</div>
            <div className="space-y-1">
              {hosts.map(host => (
                <div key={host} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-slate-300">{host}</span>
                  <select
                    className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 text-slate-200"
                    value={edgeStates[host]}
                    onChange={e => onEdgeChange(host, e.target.value as TestVersionState)}
                  >
                    {TEST_VERSION_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
