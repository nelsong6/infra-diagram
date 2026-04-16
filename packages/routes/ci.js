import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

const REPOS = [
  'fzt', 'fzt-terminal', 'my-homepage', 'fzt-showcase',
  'kill-me', 'plant-agent', 'investing', 'house-hunt',
  'infra-diagram', 'api', 'infra-bootstrap', 'picker',
  'landing-page', 'emotions-mcp',
];

/**
 * CI Dashboard routes — webhook receiver + SSE broadcaster + version tracking.
 *
 * @param {object} opts
 * @param {string} opts.webhookSecret - GitHub webhook HMAC signing secret
 * @param {string} opts.githubToken - GitHub PAT for backfilling runs on cold start
 */
export function createCIRoutes({ webhookSecret, githubToken }) {
  const router = Router();

  // In-memory state
  const runs = new Map();              // key: `${repo}/${runId}` → pipeline run
  const versions = new Map();          // key: repoName → latest published version
  const deployedVersions = new Map();  // key: repoName → deployed version info
  const sseClients = new Set();
  let backfilled = false;

  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      client.write(msg);
    }
  }

  function isDependabot(wr) {
    return wr.head_branch?.startsWith('dependabot/') ||
      wr.name?.toLowerCase().includes('dependabot');
  }

  function toRun(wr) {
    return {
      repo: wr.repository?.full_name || `nelsong6/${wr.name}`,
      repoName: wr.repository?.name || wr.name,
      workflow: wr.name || wr.workflow_name || '',
      workflowId: wr.workflow_id,
      runId: wr.id,
      runNumber: wr.run_number,
      status: wr.status,
      conclusion: wr.conclusion,
      headBranch: wr.head_branch,
      headSha: wr.head_sha?.substring(0, 7),
      commitMessage: wr.head_commit?.message?.split('\n')[0] || wr.display_title || '',
      event: wr.event,
      htmlUrl: wr.html_url,
      startedAt: wr.run_started_at,
      updatedAt: wr.updated_at,
      action: wr.status,
    };
  }

  // ── Backfill from GitHub API on cold start ────────────────────

  async function backfillFromGitHub() {
    if (backfilled || !githubToken) return;
    backfilled = true;

    console.log('[ci] Backfilling runs from GitHub API...');
    const headers = {
      Authorization: `token ${githubToken}`,
      Accept: 'application/vnd.github+json',
    };

    const fetches = REPOS.map(async (repo) => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/nelsong6/${repo}/actions/runs?per_page=5&branch=main`,
          { headers },
        );
        if (!res.ok) return;
        const data = await res.json();
        for (const wr of data.workflow_runs || []) {
          if (isDependabot(wr)) continue;
          const run = toRun(wr);
          run.repo = `nelsong6/${repo}`;
          run.repoName = repo;
          runs.set(`${run.repo}/${run.runId}`, run);
        }
      } catch (err) {
        console.error(`[ci] Backfill failed for ${repo}:`, err.message);
      }
    });

    await Promise.all(fetches);

    // Prune old runs
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [k, v] of runs) {
      if (new Date(v.updatedAt).getTime() < cutoff) {
        runs.delete(k);
      }
    }

    console.log(`[ci] Backfilled ${runs.size} runs across ${REPOS.length} repos`);
  }

  // ── Webhook receiver ──────────────────────────────────────────

  router.post('/webhook', (req, res) => {
    if (!webhookSecret) {
      return res.status(503).json({ error: 'Webhook secret not configured' });
    }

    const signature = req.headers['x-hub-signature-256'];
    if (!signature || !req.rawBody) {
      return res.status(400).json({ error: 'Missing signature or body' });
    }

    const expected = 'sha256=' + createHmac('sha256', webhookSecret)
      .update(req.rawBody)
      .digest('hex');

    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.headers['x-github-event'];

    // ── Release events — track latest published version ──
    if (event === 'release') {
      const { action, release, repository } = req.body;
      if (action === 'published' && release && repository) {
        const version = {
          repo: repository.full_name,
          repoName: repository.name,
          version: release.tag_name,
          publishedAt: release.published_at,
          htmlUrl: release.html_url,
        };
        versions.set(repository.name, version);
        broadcast('version', version);
        return res.status(200).json({ received: true, type: 'release', version: release.tag_name });
      }
      return res.status(200).json({ ignored: true, event, action });
    }

    // ── Workflow run events — track pipeline status ──
    if (event === 'workflow_run') {
      const { action, workflow_run: wr } = req.body;
      if (!wr) {
        return res.status(400).json({ error: 'Missing workflow_run payload' });
      }

      if (isDependabot(wr)) {
        return res.status(200).json({ ignored: true, reason: 'dependabot' });
      }

      const run = toRun(wr);
      const key = `${run.repo}/${run.runId}`;
      runs.set(key, run);

      // Prune runs older than 2 hours
      const cutoff = Date.now() - 2 * 60 * 60 * 1000;
      for (const [k, v] of runs) {
        if (new Date(v.updatedAt).getTime() < cutoff) {
          runs.delete(k);
        }
      }

      broadcast('update', run);
      return res.status(200).json({ received: true, key });
    }

    // Ignore other event types
    return res.status(200).json({ ignored: true, event });
  });

  // ── Deploy report — consumer sites report their live versions ──

  router.post('/deployed', (req, res) => {
    const { site, repo, versions: deployedVers } = req.body;
    if (!site || !repo) {
      return res.status(400).json({ error: 'Missing site or repo' });
    }

    const deployed = {
      site,
      repo,
      versions: deployedVers || {},
      reportedAt: new Date().toISOString(),
    };
    deployedVersions.set(repo, deployed);
    broadcast('deployed', deployed);
    res.status(200).json({ received: true, repo });
  });

  // ── SSE endpoint ──────────────────────────────────────────────

  router.get('/events', async (req, res) => {
    // Backfill on first connection
    await backfillFromGitHub();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const snapshot = {
      runs: Array.from(runs.values()),
      versions: Array.from(versions.values()),
      deployed: Array.from(deployedVersions.values()),
    };
    res.write(`event: init\ndata: ${JSON.stringify(snapshot)}\n\n`);

    sseClients.add(res);

    const keepalive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      sseClients.delete(res);
      clearInterval(keepalive);
    });
  });

  // ── Status snapshots ──────────────────────────────────────────

  router.get('/status', (req, res) => {
    res.json({
      runs: Array.from(runs.values()),
      clients: sseClients.size,
    });
  });

  router.get('/versions', (req, res) => {
    res.json({
      published: Array.from(versions.values()),
      deployed: Array.from(deployedVersions.values()),
    });
  });

  return router;
}
