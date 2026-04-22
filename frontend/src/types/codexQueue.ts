export interface CodexQueueIssue {
  number: number
  title: string
  url: string
  createdAt: string
  updatedAt: string
  labels: string[]
}

export interface CodexQueueWorkflowRun {
  name: string
  status: string
  conclusion: string | null
  event: string
  htmlUrl: string
  runNumber: number
  createdAt: string | null
  updatedAt: string | null
}

export interface CodexQueueScheduledTask {
  state: string
  interval: string | null
  startBoundary: string | null
  lastRunTime: string | null
  nextRunTime: string | null
  lastTaskResult: number | null
}

export interface CodexQueueRunnerService {
  state: string
  startMode: string
  pathName: string
}

export interface CodexQueueRunnerGitHub {
  status: string
  busy: boolean
  labels: string[]
}

export interface CodexQueueWorkerLock {
  present: boolean
  pid: number | null
  createdAt: string | null
  repo: string | null
}

export interface CodexQueueWorkerLog {
  path: string | null
  exists: boolean
  lastWriteTime: string | null
  recentLines: string[]
  summary: string
  summaryCode: string
}

export interface CodexQueuePushIssue {
  number: number | null
  title: string | null
  url: string | null
}

export interface CodexQueuePushState {
  enabled: boolean
  freshness: 'none' | 'fresh' | 'stale'
  state: 'idle' | 'running' | 'blocked' | null
  lastEventType: string | null
  lastEventAt: string | null
  acceptedAt: string | null
  sourceHost: string | null
  runId: string | null
  issue: CodexQueuePushIssue | null
  processedCount: number
  lastOutcome: string | null
  message: string | null
  ttlMs: number
}

export interface CodexQueueSnapshot {
  supported: boolean
  host: string
  repo: string
  workerName: string
  observedAt: string
  supportNotes: string[]
  overallState: 'idle' | 'queued' | 'running' | 'blocked' | 'offline' | 'unsupported'
  reasons: string[]
  queue: {
    inQueueCount: number
    waitingCount: number
    activeCount: number
    blockedCount: number
    completeCount: number
    waiting: CodexQueueIssue[]
    active: CodexQueueIssue[]
    blocked: CodexQueueIssue[]
  }
  wakeupRun: CodexQueueWorkflowRun | null
  scheduledTask: CodexQueueScheduledTask | null
  runner: {
    name: string
    service: CodexQueueRunnerService | null
    github: CodexQueueRunnerGitHub | null
  }
  worker: {
    stateRoot: string | null
    log: CodexQueueWorkerLog
    lock: CodexQueueWorkerLock
  }
  push: CodexQueuePushState
}
