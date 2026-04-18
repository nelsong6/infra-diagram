import type { CIRun, PublishedVersion, DeployedVersion } from '../types/ci'

// Possible per-repo "pipeline run" states a test control can emit.
export type TestRunStatus =
  | 'success'
  | 'failure'
  | 'in_progress'
  | 'queued'
  | 'no_runs'

export const TEST_RUN_STATUSES: TestRunStatus[] = [
  'success', 'failure', 'in_progress', 'queued', 'no_runs',
]

// Possible per-repo version-match states. `match` = healthy edge, `mismatch`
// = broken edge with distinct version on consumer side, `unknown` = producer
// has no release.
export type TestVersionState = 'match' | 'mismatch' | 'unknown'

export const TEST_VERSION_STATES: TestVersionState[] = ['match', 'mismatch', 'unknown']

let runIdSeq = 1

// Build a CIRun from a test status. Returns null for 'no_runs' so the caller
// can skip adding it to the runs map.
export function makeRun(repo: string, status: TestRunStatus, version = 'v0.0.1'): CIRun | null {
  if (status === 'no_runs') return null
  const isInProgress = status === 'in_progress' || status === 'queued'
  return {
    repo: `nelsong6/${repo}`,
    repoName: repo,
    workflow: 'Build',
    workflowId: 1,
    runId: runIdSeq++,
    runNumber: 1,
    status: isInProgress ? status : 'completed',
    conclusion: isInProgress ? null : status,
    headBranch: 'main',
    headSha: 'abc1234',
    commitMessage: `test: ${status} fixture`,
    event: 'push',
    htmlUrl: `https://github.com/nelsong6/${repo}`,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    action: isInProgress ? 'in_progress' : 'completed',
  }
}

export function makeVersion(repo: string, version: string): PublishedVersion {
  return {
    repo: `nelsong6/${repo}`,
    repoName: repo,
    version,
    publishedAt: new Date().toISOString(),
    htmlUrl: `https://github.com/nelsong6/${repo}/releases`,
  }
}

// Build a DeployedVersion entry. `versions` is the per-field map
// (e.g. { fztTerminal: "v0.1.1", fztFrontend: "v0.0.5" }).
export function makeDeployed(site: string, repo: string, versions: Record<string, string>): DeployedVersion {
  return {
    site,
    repo,
    versions,
    reportedAt: new Date().toISOString(),
  }
}
