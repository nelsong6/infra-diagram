import { Router } from 'express';
import { execFile } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const REPO_SLUG = 'nelsong6/card-utility-stats';
const WORKER_NAME = 'sts2-side-a';
const QUEUE_LABEL = 'codex-queue';
const ACTIVE_LABEL = 'codex-active';
const BLOCKED_LABEL = 'codex-blocked';
const COMPLETE_LABEL = 'codex-complete';
const WAKEUP_WORKFLOW = 'codex-queue-wakeup.yml';
const RUNNER_SERVICE_NAME = 'actions.runner.nelsong6-card-utility-stats.sts2-side-a';
const SCHEDULED_TASK_NAME = 'Codex Issue Queue Worker';
const PUSH_EVENT_AUDIENCE = 'diagrams-codex-queue';
const PUSH_EVENT_ISSUER = 'codex-queue-worker';
const PUSH_EVENT_TTL_MS = 2 * 60 * 60 * 1000;

function localStateRoot() {
  if (!process.env.LOCALAPPDATA) return null;
  return path.join(process.env.LOCALAPPDATA, 'CodexIssueQueue', REPO_SLUG.replace('/', '-'));
}

async function pathExists(targetPath) {
  if (!targetPath) return false;

  try {
    await fs.access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveExecutable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (await pathExists(candidate)) {
        return candidate;
      }
      continue;
    }
    return candidate;
  }

  return null;
}

async function runJsonCommand(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });

  const text = stdout.trim();
  if (!text) return null;
  return JSON.parse(text);
}

async function runPowerShellJson(script) {
  if (process.platform !== 'win32') {
    return null;
  }

  const powerShell = await resolveExecutable([
    process.env.POWERSHELL_PATH,
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'powershell.exe',
  ]);

  if (!powerShell) {
    throw new Error('PowerShell is not available on this host.');
  }

  return runJsonCommand(powerShell, ['-NoProfile', '-Command', script]);
}

async function runGhJson(args) {
  const gh = await resolveExecutable([
    process.env.GH_PATH,
    'C:\\Program Files\\GitHub CLI\\gh.exe',
    'gh',
  ]);

  if (!gh) {
    throw new Error('GitHub CLI is not available on this host.');
  }

  return runJsonCommand(gh, args);
}

function mapIssue(issue) {
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    labels: (issue.labels || []).map((label) => label.name),
  };
}

function hasLabel(issue, label) {
  return issue.labels.includes(label);
}

function tailLines(content, count) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-count);
}

function normalizeDateValue(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const match = value.match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/);
  if (!match) {
    return value;
  }

  return new Date(Number(match[1])).toISOString();
}

function summarizeLogLines(lines) {
  const lastLine = lines[lines.length - 1] ?? '';

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];

    if (line.includes('Queue is empty.')) {
      return { code: 'queue_empty', summary: 'Queue is empty.' };
    }

    const claimMatch = line.match(/Claiming issue #(\d+)/);
    if (claimMatch) {
      return { code: 'claiming', summary: `Claiming issue #${claimMatch[1]}.` };
    }

    const outcomeMatch = line.match(/Issue #(\d+) finished with queue outcome '([^']+)'/);
    if (outcomeMatch) {
      return {
        code: `outcome:${outcomeMatch[2]}`,
        summary: `Issue #${outcomeMatch[1]} finished as ${outcomeMatch[2]}.`,
      };
    }

    if (line.includes('Another queue worker process is already active')) {
      return { code: 'already_running', summary: 'Another queue worker process is already active.' };
    }

    if (line.includes('Using local Codex binary')) {
      return { code: 'worker_started', summary: 'Worker woke up and resolved the local Codex binary.' };
    }
  }

  return {
    code: lastLine ? 'recent_line' : 'missing',
    summary: lastLine || 'No worker log lines found.',
  };
}

function decodeBase64Url(segment) {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function parseJwtJson(segment, label) {
  try {
    return JSON.parse(decodeBase64Url(segment).toString('utf8'));
  } catch {
    throw new Error(`Invalid JWT ${label}.`);
  }
}

function timingSafeStringEqual(left, right) {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

function audienceMatches(aud) {
  if (Array.isArray(aud)) {
    return aud.includes(PUSH_EVENT_AUDIENCE);
  }
  return aud === PUSH_EVENT_AUDIENCE;
}

function verifyPushToken(token, secret) {
  if (!secret) {
    throw new Error('Push event secret is not configured.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT.');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJwtJson(encodedHeader, 'header');
  const payload = parseJwtJson(encodedPayload, 'payload');

  if (header.alg !== 'HS256') {
    throw new Error('Unsupported JWT algorithm.');
  }

  const expectedSignature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  if (!timingSafeStringEqual(encodedSignature, expectedSignature)) {
    throw new Error('JWT signature mismatch.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.nbf && now < payload.nbf) {
    throw new Error('JWT is not active yet.');
  }
  if (payload.exp && now >= payload.exp) {
    throw new Error('JWT is expired.');
  }
  if (payload.iss && payload.iss !== PUSH_EVENT_ISSUER) {
    throw new Error('JWT issuer mismatch.');
  }
  if (payload.aud && !audienceMatches(payload.aud)) {
    throw new Error('JWT audience mismatch.');
  }

  return payload;
}

async function readWorkerFiles() {
  const stateRoot = localStateRoot();
  const logPath = stateRoot ? path.join(stateRoot, 'worker.log') : null;
  const lockPath = stateRoot ? path.join(stateRoot, 'worker.lock') : null;

  const logExists = await pathExists(logPath);
  const lockExists = await pathExists(lockPath);

  let recentLines = [];
  let logLastWriteTime = null;
  if (logExists && logPath) {
    const [content, stats] = await Promise.all([
      fs.readFile(logPath, 'utf8'),
      fs.stat(logPath),
    ]);
    recentLines = tailLines(content, 12);
    logLastWriteTime = stats.mtime.toISOString();
  }

  let lock = {
    present: false,
    pid: null,
    createdAt: null,
    repo: null,
  };

  if (lockExists && lockPath) {
    try {
      const parsed = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      lock = {
        present: true,
        pid: Number.isFinite(parsed.pid) ? parsed.pid : null,
        createdAt: parsed.created_at ?? null,
        repo: parsed.repo ?? null,
      };
    } catch {
      lock = {
        present: true,
        pid: null,
        createdAt: null,
        repo: null,
      };
    }
  }

  const logSummary = summarizeLogLines(recentLines);

  return {
    stateRoot,
    log: {
      path: logPath,
      exists: logExists,
      lastWriteTime: logLastWriteTime,
      recentLines,
      summary: logSummary.summary,
      summaryCode: logSummary.code,
    },
    lock,
  };
}

async function readWindowsState() {
  const script = `
$task = Get-ScheduledTask -TaskName '${SCHEDULED_TASK_NAME}' -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName '${SCHEDULED_TASK_NAME}' -ErrorAction SilentlyContinue } else { $null }
$service = Get-CimInstance Win32_Service | Where-Object { $_.Name -eq '${RUNNER_SERVICE_NAME}' } | Select-Object -First 1 Name, State, StartMode, PathName
[pscustomobject]@{
  scheduledTask = if ($task) {
    [pscustomobject]@{
      state = $task.State.ToString()
      interval = if ($task.Triggers.Count -gt 0 -and $task.Triggers[0].Repetition) { $task.Triggers[0].Repetition.Interval } else { $null }
      startBoundary = if ($task.Triggers.Count -gt 0) { $task.Triggers[0].StartBoundary } else { $null }
      lastRunTime = if ($taskInfo) { $taskInfo.LastRunTime } else { $null }
      nextRunTime = if ($taskInfo) { $taskInfo.NextRunTime } else { $null }
      lastTaskResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
    }
  } else {
    $null
  }
  runnerService = if ($service) {
    [pscustomobject]@{
      state = $service.State
      startMode = $service.StartMode
      pathName = $service.PathName
    }
  } else {
    $null
  }
} | ConvertTo-Json -Depth 5 -Compress
`;

  try {
    const payload = (await runPowerShellJson(script)) ?? {
      scheduledTask: null,
      runnerService: null,
    };

    if (payload.scheduledTask) {
      payload.scheduledTask = {
        ...payload.scheduledTask,
        lastRunTime: normalizeDateValue(payload.scheduledTask.lastRunTime),
        nextRunTime: normalizeDateValue(payload.scheduledTask.nextRunTime),
        startBoundary: normalizeDateValue(payload.scheduledTask.startBoundary),
      };
    }

    return payload;
  } catch {
    return {
      scheduledTask: null,
      runnerService: null,
    };
  }
}

function normalizeWakeupRun(payload) {
  const run = payload?.workflow_runs?.[0];
  if (!run) return null;

  return {
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    event: run.event,
    htmlUrl: run.html_url,
    runNumber: run.run_number,
    createdAt: run.created_at ?? null,
    updatedAt: run.updated_at ?? null,
  };
}

function createInitialPushState() {
  return {
    state: null,
    lastEventType: null,
    lastEventAt: null,
    acceptedAt: null,
    sourceHost: null,
    runId: null,
    issue: null,
    processedCount: 0,
    lastOutcome: null,
    message: null,
  };
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function applyPushEvent(previousState, event) {
  const next = {
    ...previousState,
    lastEventType: event.type ?? previousState.lastEventType,
    lastEventAt: event.occurred_at ?? new Date().toISOString(),
    acceptedAt: new Date().toISOString(),
    sourceHost: event.host ?? previousState.sourceHost,
    runId: event.run_id ?? previousState.runId,
    message: event.message ?? previousState.message,
  };

  if (event.issue_number) {
    next.issue = {
      number: toNumberOrNull(event.issue_number),
      title: event.issue_title ?? null,
      url: event.issue_url ?? null,
    };
  }

  if (event.processed_count !== undefined && event.processed_count !== null) {
    const processedCount = toNumberOrNull(event.processed_count);
    if (processedCount !== null) {
      next.processedCount = processedCount;
    }
  }

  if (event.outcome) {
    next.lastOutcome = event.outcome;
  }

  switch (event.type) {
    case 'worker_run_started':
      next.state = 'running';
      next.issue = null;
      next.lastOutcome = null;
      next.message = event.message ?? 'Worker run started.';
      break;
    case 'issue_claimed':
      next.state = 'running';
      next.message = event.message ?? 'Worker claimed an issue.';
      break;
    case 'issue_finished':
      next.state = event.outcome === 'blocked' || event.outcome === 'needs_human' ? 'blocked' : 'running';
      next.issue = null;
      next.message = event.message ?? `Issue finished with outcome ${event.outcome ?? 'unknown'}.`;
      break;
    case 'queue_empty':
      next.state = 'idle';
      next.issue = null;
      next.message = event.message ?? 'Queue is empty.';
      break;
    case 'worker_run_finished':
      next.state = event.outcome === 'blocked' ? 'blocked' : 'idle';
      next.issue = null;
      next.message = event.message ?? 'Worker run finished.';
      break;
    case 'worker_run_failed':
      next.state = 'blocked';
      next.message = event.message ?? 'Worker run failed.';
      break;
    default:
      if (event.state === 'running' || event.state === 'idle' || event.state === 'blocked') {
        next.state = event.state;
      }
      break;
  }

  return next;
}

function buildPushSnapshot(pushState, secretConfigured) {
  const referenceTime = pushState.acceptedAt ?? pushState.lastEventAt;
  const ageMs = referenceTime ? Math.max(Date.now() - Date.parse(referenceTime), 0) : null;
  const freshness = ageMs === null
    ? 'none'
    : ageMs <= PUSH_EVENT_TTL_MS
    ? 'fresh'
    : 'stale';

  return {
    enabled: Boolean(secretConfigured),
    freshness,
    state: pushState.state,
    lastEventType: pushState.lastEventType,
    lastEventAt: pushState.lastEventAt,
    acceptedAt: pushState.acceptedAt,
    sourceHost: pushState.sourceHost,
    runId: pushState.runId,
    issue: pushState.issue,
    processedCount: pushState.processedCount,
    lastOutcome: pushState.lastOutcome,
    message: pushState.message,
    ttlMs: PUSH_EVENT_TTL_MS,
  };
}

function classifyState(snapshot) {
  const notes = [...snapshot.supportNotes];
  const reasons = [];

  const pushFresh = snapshot.push.freshness === 'fresh';
  const pushRunning = pushFresh && snapshot.push.state === 'running';
  const pushBlocked = pushFresh && snapshot.push.state === 'blocked';
  const pushIdle = pushFresh && snapshot.push.state === 'idle';

  if (snapshot.push.freshness === 'stale' && snapshot.push.lastEventAt) {
    notes.push(`The latest push event from ${snapshot.push.sourceHost ?? 'the worker'} is stale.`);
  }

  const serviceState = snapshot.runner.service?.state ?? null;
  const githubStatus = snapshot.runner.github?.status ?? null;
  const runnerKnown = Boolean(serviceState || githubStatus);
  const runnerOnline = githubStatus === 'online' || serviceState === 'Running';
  const runnerBusy = snapshot.runner.github?.busy ?? false;
  const wakeupRunning = snapshot.wakeupRun
    ? snapshot.wakeupRun.status === 'queued' || snapshot.wakeupRun.status === 'in_progress'
    : false;
  const wakeupFailed = snapshot.wakeupRun
    ? snapshot.wakeupRun.status === 'completed' && snapshot.wakeupRun.conclusion && snapshot.wakeupRun.conclusion !== 'success'
    : false;

  if (!snapshot.supported) {
    reasons.push('This host does not expose local queue state and push events are not configured.');
    return { overallState: 'unsupported', reasons, supportNotes: notes };
  }

  if (pushBlocked) {
    reasons.push(`Fresh push event from ${snapshot.push.sourceHost ?? 'the side machine'} reports a blocked worker state.`);
    return { overallState: 'blocked', reasons, supportNotes: notes };
  }

  if (pushRunning) {
    reasons.push(`Fresh push event from ${snapshot.push.sourceHost ?? 'the side machine'} reports active queue work.`);
    return { overallState: 'running', reasons, supportNotes: notes };
  }

  if (runnerBusy || wakeupRunning || snapshot.queue.activeCount > 0 || snapshot.worker.lock.present) {
    if (runnerBusy) reasons.push('GitHub reports the runner as busy.');
    if (snapshot.queue.activeCount > 0) reasons.push('An issue currently carries codex-active.');
    if (snapshot.worker.lock.present) reasons.push('The local worker lock is present.');
    if (wakeupRunning) reasons.push('The wakeup workflow is currently running.');
    return { overallState: 'running', reasons, supportNotes: notes };
  }

  if (snapshot.queue.waitingCount > 0) {
    reasons.push('There are queued issues waiting for the next wakeup or drain pass.');
    return { overallState: 'queued', reasons, supportNotes: notes };
  }

  if (snapshot.queue.blockedCount > 0 || wakeupFailed) {
    if (snapshot.queue.blockedCount > 0) {
      reasons.push(`${snapshot.queue.blockedCount} open issue(s) are marked codex-blocked.`);
    }
    if (wakeupFailed) {
      reasons.push('The latest wakeup workflow did not finish successfully.');
    }
    return { overallState: 'blocked', reasons, supportNotes: notes };
  }

  if (pushIdle) {
    reasons.push(`Fresh push event from ${snapshot.push.sourceHost ?? 'the side machine'} reports the queue worker is idle.`);
    return { overallState: 'idle', reasons, supportNotes: notes };
  }

  if (snapshot.push.enabled && snapshot.push.freshness === 'none' && !runnerKnown && !snapshot.worker.log.exists) {
    reasons.push('Waiting for the first push event from the side machine.');
    return { overallState: 'idle', reasons, supportNotes: notes };
  }

  if (runnerKnown && !runnerOnline) {
    reasons.push('The self-hosted runner is not online.');
    return { overallState: 'offline', reasons, supportNotes: notes };
  }

  reasons.push('No queued or active issues are present and the available signals are calm.');
  return { overallState: 'idle', reasons, supportNotes: notes };
}

export function createCodexQueueRoutes({ eventJwtSecret = null } = {}) {
  const router = Router();
  const sseClients = new Set();
  let pushState = createInitialPushState();

  async function collectSnapshot() {
    const supportNotes = [];
    const workerFiles = await readWorkerFiles();
    const windowsState = await readWindowsState();

    let issues = [];
    let wakeupRun = null;
    let githubRunner = null;
    let ghAvailable = true;

    try {
      const [issuePayload, wakeupPayload, runnerPayload] = await Promise.all([
        runGhJson([
          'issue', 'list',
          '--repo', REPO_SLUG,
          '--state', 'open',
          '--limit', '100',
          '--json', 'number,title,url,createdAt,updatedAt,labels',
        ]),
        runGhJson([
          'api',
          `repos/${REPO_SLUG}/actions/workflows/${WAKEUP_WORKFLOW}/runs?per_page=5`,
        ]),
        runGhJson([
          'api',
          `repos/${REPO_SLUG}/actions/runners`,
        ]),
      ]);

      issues = (issuePayload || []).map(mapIssue);
      wakeupRun = normalizeWakeupRun(wakeupPayload);

      const runnerMatch = runnerPayload?.runners?.find((runner) => runner.name === WORKER_NAME) ?? null;
      githubRunner = runnerMatch
        ? {
            status: runnerMatch.status,
            busy: Boolean(runnerMatch.busy),
            labels: (runnerMatch.labels || []).map((label) => label.name),
          }
        : null;

      if (!runnerMatch) {
        supportNotes.push(`Runner ${WORKER_NAME} was not returned by the GitHub Actions runners API.`);
      }
    } catch (error) {
      ghAvailable = false;
      supportNotes.push(`GitHub CLI data is unavailable: ${error.message}`);
    }

    if (!eventJwtSecret) {
      supportNotes.push('Push event secret is not configured on this backend.');
    }

    if (!workerFiles.stateRoot) {
      supportNotes.push('LOCALAPPDATA is not available on this host, so worker state files cannot be read.');
    }
    if (!workerFiles.log.exists) {
      supportNotes.push('worker.log was not found under the local Codex issue queue state root.');
    }
    if (!windowsState.runnerService) {
      supportNotes.push(`Windows service ${RUNNER_SERVICE_NAME} was not found on this host.`);
    }
    if (!windowsState.scheduledTask) {
      supportNotes.push(`Scheduled task ${SCHEDULED_TASK_NAME} was not found on this host.`);
    }

    const inQueue = issues.filter((issue) => hasLabel(issue, QUEUE_LABEL));
    const active = issues.filter((issue) => hasLabel(issue, ACTIVE_LABEL));
    const waiting = inQueue.filter((issue) => !hasLabel(issue, ACTIVE_LABEL));
    const blocked = issues.filter((issue) => hasLabel(issue, BLOCKED_LABEL));
    const complete = issues.filter((issue) => hasLabel(issue, COMPLETE_LABEL));

    const snapshot = {
      supported: ghAvailable || workerFiles.log.exists || Boolean(windowsState.runnerService) || Boolean(eventJwtSecret) || Boolean(pushState.lastEventAt),
      host: os.hostname(),
      repo: REPO_SLUG,
      workerName: WORKER_NAME,
      observedAt: new Date().toISOString(),
      supportNotes,
      overallState: 'idle',
      reasons: [],
      queue: {
        inQueueCount: inQueue.length,
        waitingCount: waiting.length,
        activeCount: active.length,
        blockedCount: blocked.length,
        completeCount: complete.length,
        waiting: waiting.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        active: active.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
        blocked: blocked.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
      },
      wakeupRun,
      scheduledTask: windowsState.scheduledTask ?? null,
      runner: {
        name: WORKER_NAME,
        service: windowsState.runnerService ?? null,
        github: githubRunner,
      },
      worker: workerFiles,
      push: buildPushSnapshot(pushState, eventJwtSecret),
    };

    const classified = classifyState(snapshot);
    snapshot.overallState = classified.overallState;
    snapshot.reasons = classified.reasons;
    snapshot.supportNotes = classified.supportNotes;

    return snapshot;
  }

  async function broadcastSnapshot(eventName = 'update') {
    if (sseClients.size === 0) {
      return;
    }

    try {
      const snapshot = await collectSnapshot();
      const message = `event: ${eventName}\ndata: ${JSON.stringify(snapshot)}\n\n`;
      for (const client of sseClients) {
        client.write(message);
      }
    } catch (error) {
      const message = `event: problem\ndata: ${JSON.stringify(error.message)}\n\n`;
      for (const client of sseClients) {
        client.write(message);
      }
    }
  }

  router.post('/codex/push', async (req, res) => {
    if (!eventJwtSecret) {
      return res.status(503).json({ error: 'Push event secret is not configured on this backend.' });
    }

    const authorization = req.headers.authorization ?? '';
    if (!authorization.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing bearer token.' });
    }

    let claims;
    try {
      claims = verifyPushToken(authorization.slice('Bearer '.length), eventJwtSecret);
    } catch (error) {
      return res.status(401).json({ error: error.message });
    }

    const event = req.body ?? {};
    if (!event.type || !event.repo || !event.worker || !event.occurred_at) {
      return res.status(400).json({ error: 'Event payload must include type, repo, worker, and occurred_at.' });
    }
    if (event.repo !== REPO_SLUG) {
      return res.status(400).json({ error: `Unexpected repo '${event.repo}'.` });
    }
    if (event.worker !== WORKER_NAME) {
      return res.status(400).json({ error: `Unexpected worker '${event.worker}'.` });
    }
    if (claims.repo && claims.repo !== event.repo) {
      return res.status(403).json({ error: 'JWT repo claim does not match event body.' });
    }
    if (claims.sub && claims.sub !== event.worker) {
      return res.status(403).json({ error: 'JWT subject does not match event worker.' });
    }

    pushState = applyPushEvent(pushState, event);
    void broadcastSnapshot('update');

    return res.json({
      accepted: true,
      state: pushState.state,
      acceptedAt: pushState.acceptedAt,
      eventType: pushState.lastEventType,
    });
  });

  router.get('/codex/status', async (req, res) => {
    try {
      res.json(await collectSnapshot());
    } catch (error) {
      res.status(500).json({
        supported: false,
        overallState: 'unsupported',
        message: error.message,
      });
    }
  });

  router.get('/codex/events', async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    let closed = false;
    let inFlight = false;

    const sendSnapshot = async (eventName) => {
      if (closed || inFlight) return;
      inFlight = true;

      try {
        const snapshot = await collectSnapshot();
        if (!closed) {
          res.write(`event: ${eventName}\ndata: ${JSON.stringify(snapshot)}\n\n`);
        }
      } catch (error) {
        if (!closed) {
          res.write(`event: problem\ndata: ${JSON.stringify(error.message)}\n\n`);
        }
      } finally {
        inFlight = false;
      }
    };

    await sendSnapshot('init');
    sseClients.add(res);

    const updateTimer = setInterval(() => {
      void sendSnapshot('update');
    }, 5000);

    const keepAlive = setInterval(() => {
      if (!closed) {
        res.write(': keepalive\n\n');
      }
    }, 30000);

    req.on('close', () => {
      closed = true;
      sseClients.delete(res);
      clearInterval(updateTimer);
      clearInterval(keepAlive);
    });
  });

  return router;
}
