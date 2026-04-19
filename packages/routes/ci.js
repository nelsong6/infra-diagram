import { Router } from 'express';
import { createHmac, createSign, timingSafeEqual } from 'node:crypto';

const REPOS = [
  'fzt', 'fzt-frontend', 'fzt-terminal', 'fzt-browser', 'fzt-automate',
  'my-homepage', 'fzt-showcase', 'fzt-picker',
  'kill-me', 'plant-agent', 'investing', 'house-hunt',
  'diagrams', 'api', 'infra-bootstrap',
  'landing-page', 'emotions-mcp', 'llm-explorer',
];

// Go dependencies to extract from go.mod on release events
const GO_DEPS = {
  'fzt-frontend': [
    { module: 'github.com/nelsong6/fzt', field: 'fzt' },
  ],
  'fzt-terminal': [
    { module: 'github.com/nelsong6/fzt', field: 'fzt' },
    { module: 'github.com/nelsong6/fzt-frontend', field: 'fztFrontend' },
  ],
  'fzt-automate': [
    { module: 'github.com/nelsong6/fzt', field: 'fzt' },
    { module: 'github.com/nelsong6/fzt-terminal', field: 'fztTerminal' },
  ],
  'fzt-browser': [
    { module: 'github.com/nelsong6/fzt', field: 'fzt' },
    { module: 'github.com/nelsong6/fzt-terminal', field: 'fztTerminal' },
  ],
  'fzt-picker': [
    { module: 'github.com/nelsong6/fzt', field: 'fzt' },
    { module: 'github.com/nelsong6/fzt-terminal', field: 'fztTerminal' },
  ],
};

// Repos that publish route packages to GitHub Packages
const ROUTE_PACKAGES = {
  'my-homepage': '@nelsong6/my-homepage-routes',
  'fzt-frontend': '@nelsong6/fzt-frontend-routes',
  'diagrams': '@nelsong6/diagrams-routes',
  'kill-me': '@nelsong6/kill-me-routes',
  'plant-agent': '@nelsong6/plant-agent-routes',
  'investing': '@nelsong6/investing-routes',
  'house-hunt': '@nelsong6/house-hunt-routes',
  'llm-explorer': '@nelsong6/llm-explorer-routes',
};

// Sites that serve a /version.json for deployed version backfill.
// landing-page is intentionally NOT in this list — it doesn't expose
// /version.json and isn't represented as a node on /ci/api (no route
// package). Adding it back requires first giving it a version.json in
// its deploy workflow AND deciding where it should surface on the
// dashboard.
const SITE_URLS = {
  'my-homepage': 'https://homepage.romaine.life',
  'fzt-showcase': 'https://fzt.romaine.life',
  'kill-me': 'https://workout.romaine.life',
  'plant-agent': 'https://plants.romaine.life',
  'diagrams': 'https://diagrams.romaine.life',
  'house-hunt': 'https://househunt.romaine.life',
  'investing': 'https://investing.romaine.life',
};

// ── GitHub App installation token ───────────────────────────────

function createAppJWT(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 600,
    iss: appId,
  })).toString('base64url');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(privateKey, 'base64url');
  return `${header}.${payload}.${signature}`;
}

async function getInstallationToken(appId, privateKey) {
  const jwt = createAppJWT(appId, privateKey);
  const headers = { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json' };

  const installRes = await fetch('https://api.github.com/app/installations', { headers });
  if (!installRes.ok) throw new Error(`Failed to list installations: HTTP ${installRes.status}`);
  const installations = await installRes.json();
  if (!installations.length) throw new Error('No GitHub App installations found');

  const tokenRes = await fetch(
    `https://api.github.com/app/installations/${installations[0].id}/access_tokens`,
    { method: 'POST', headers },
  );
  if (!tokenRes.ok) throw new Error(`Failed to create installation token: HTTP ${tokenRes.status}`);
  const { token, expires_at } = await tokenRes.json();
  return { token, expiresAt: Date.parse(expires_at) };
}

/**
 * CI Dashboard routes — webhook receiver + SSE broadcaster + version tracking.
 *
 * @param {object} opts
 * @param {string} opts.webhookSecret - GitHub webhook HMAC signing secret
 * @param {string} [opts.githubAppId] - GitHub App ID for generating installation tokens
 * @param {string} [opts.githubAppPrivateKey] - GitHub App private key (PEM)
 * @param {Record<string, string>} [opts.installedPackages] - route package versions from the host's package-lock
 */
export function createCIRoutes({ webhookSecret, githubAppId, githubAppPrivateKey, installedPackages }) {
  const router = Router();

  // In-memory state
  const runs = new Map();              // key: `${repo}/${runId}` → pipeline run
  const versions = new Map();          // key: repoName → latest published release version
  const packageVersions = new Map();   // key: repoName → latest published route package version
  const deployedVersions = new Map();  // key: repoName → deployed version info
  const versionErrors = new Map();    // key: repoName → error string
  const sseClients = new Set();
  let backfillPromise = null;
  let versionBackfillPromise = null;

  // Pre-populate deployed versions from host's package-lock (survives API restart)
  if (installedPackages && Object.keys(installedPackages).length > 0) {
    deployedVersions.set('api', {
      site: 'api.romaine.life',
      repo: 'api',
      versions: installedPackages,
      reportedAt: new Date().toISOString(),
    });
    console.log(`[ci] Pre-populated API deployed versions: ${Object.keys(installedPackages).length} packages`);
  }

  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      client.write(msg);
    }
  }

  async function extractGoModVersions(repoName, tag, deps) {
    const token = await getGitHubToken();
    if (!token) return;
    const res = await fetch(
      `https://api.github.com/repos/nelsong6/${repoName}/contents/go.mod?ref=${tag}`,
      { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) {
      // Picker has go.mod in frontend/ subdirectory
      const altRes = await fetch(
        `https://api.github.com/repos/nelsong6/${repoName}/contents/frontend/go.mod?ref=${tag}`,
        { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } },
      );
      if (!altRes.ok) return;
      const altData = await altRes.json();
      return parseGoMod(repoName, Buffer.from(altData.content, 'base64').toString(), deps);
    }
    const data = await res.json();
    parseGoMod(repoName, Buffer.from(data.content, 'base64').toString(), deps);
  }

  function parseGoMod(repoName, content, deps) {
    const extracted = {};
    for (const { module, field } of deps) {
      const match = content.match(new RegExp(`${module.replace(/\//g, '\\/')}\\s+(v[\\w.\\-+]+)`));
      if (match) extracted[field] = match[1];
    }
    if (Object.keys(extracted).length > 0) {
      const deployed = {
        site: `github.com/nelsong6/${repoName}`,
        repo: repoName,
        versions: extracted,
        reportedAt: new Date().toISOString(),
      };
      deployedVersions.set(repoName, deployed);
      broadcast('deployed', deployed);
      console.log(`[ci] Extracted go.mod deps for ${repoName}:`, extracted);
    }
  }

  async function fetchSiteVersion(repoName, siteUrl) {
    const res = await fetch(`${siteUrl}/version.json`);
    if (!res.ok) return;
    const data = await res.json();
    const deployed = {
      site: siteUrl.replace('https://', ''),
      repo: repoName,
      versions: data,
      reportedAt: data.deployedAt || new Date().toISOString(),
    };
    deployedVersions.set(repoName, deployed);
    broadcast('deployed', deployed);
    console.log(`[ci] Refreshed version.json for ${repoName}:`, data);
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

  // ── GitHub App token (cached with expiry, regenerated before it expires) ──
  //
  // GitHub App installation tokens live for 1 hour. Previously we cached the
  // token for the lifetime of the api process — so after an hour every
  // release-webhook's `extractGoModVersions` call silently 401'd and the
  // deployed map went stale until the container restarted. Now we track the
  // expires_at from GitHub's response and regenerate within 60s of expiry
  // (slack for clock skew + request latency). Matches @octokit/auth-app's
  // behavior.

  let cached = null; // { token, expiresAt: ms-epoch } | null

  async function getGitHubToken() {
    if (cached && Date.now() < cached.expiresAt - 60_000) {
      return cached.token;
    }
    if (!githubAppId || !githubAppPrivateKey) {
      console.warn('[ci] No GitHub App credentials configured — skipping backfill');
      return null;
    }
    try {
      cached = await getInstallationToken(githubAppId, githubAppPrivateKey);
      console.log(`[ci] Generated GitHub App installation token (expires ${new Date(cached.expiresAt).toISOString()})`);
      return cached.token;
    } catch (err) {
      console.error('[ci] Failed to generate GitHub App token:', err.message);
      cached = null;
      return null;
    }
  }

  // ── Backfill from GitHub API on cold start ────────────────────

  async function backfillFromGitHub() {
    if (backfillPromise) return backfillPromise;

    const token = await getGitHubToken();
    if (!token) return;

    backfillPromise = (async () => {
      console.log('[ci] Backfilling runs from GitHub API...');
      const headers = {
        Authorization: `token ${token}`,
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
      console.log(`[ci] Backfilled ${runs.size} runs across ${REPOS.length} repos`);
    })();

    return backfillPromise;
  }

  // ── Backfill versions (releases + site version.json) ──────────

  async function backfillVersions() {
    if (versionBackfillPromise) return versionBackfillPromise;

    const token = await getGitHubToken();
    if (!token) return;

    versionBackfillPromise = (async () => {
      const headers = {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
      };

      // Fetch latest published route package version from GitHub Packages API
      const packageFetches = Object.entries(ROUTE_PACKAGES).map(async ([repo, pkgName]) => {
        try {
          const shortName = pkgName.replace('@nelsong6/', '');
          const res = await fetch(
            `https://api.github.com/users/nelsong6/packages/npm/${shortName}/versions?per_page=1`,
            { headers },
          );
          if (!res.ok) {
            const msg = `Package API HTTP ${res.status}`;
            console.error(`[ci] ${msg} for ${repo} (${pkgName})`);
            versionErrors.set(repo, msg);
            return;
          }
          const data = await res.json();
          if (!data.length) return;
          packageVersions.set(repo, {
            repo: `nelsong6/${repo}`,
            repoName: repo,
            version: data[0].name,
            publishedAt: data[0].created_at,
            htmlUrl: `https://github.com/nelsong6/${repo}/packages`,
          });
        } catch (err) {
          console.error(`[ci] Package backfill failed for ${repo} (${pkgName}):`, err.message);
          versionErrors.set(repo, err.message);
        }
      });

      // Fetch latest GitHub release for each repo (404 = no releases, skip)
      const releaseFetches = REPOS.map(async (repo) => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/nelsong6/${repo}/releases/latest`,
            { headers },
          );
          if (res.status === 404) return; // no releases — expected
          if (!res.ok) {
            const msg = `Release fetch HTTP ${res.status}`;
            console.error(`[ci] ${msg} for ${repo}`);
            versionErrors.set(repo, msg);
            return;
          }
          const rel = await res.json();
          versions.set(repo, {
            repo: `nelsong6/${repo}`,
            repoName: repo,
            version: rel.tag_name,
            publishedAt: rel.published_at,
            htmlUrl: rel.html_url,
          });
        } catch (err) {
          console.error(`[ci] Release backfill failed for ${repo}:`, err.message);
          versionErrors.set(repo, err.message);
        }
      });

      // Fetch version.json from each site
      const siteFetches = Object.entries(SITE_URLS).map(async ([repo, siteUrl]) => {
        try {
          const res = await fetch(`${siteUrl}/version.json`);
          if (!res.ok) {
            const msg = `version.json HTTP ${res.status}`;
            console.error(`[ci] ${msg} for ${repo} (${siteUrl})`);
            versionErrors.set(repo, msg);
            return;
          }
          const data = await res.json();
          deployedVersions.set(repo, {
            site: siteUrl.replace('https://', ''),
            repo,
            versions: data,
            reportedAt: data.deployedAt || new Date().toISOString(),
          });
        } catch (err) {
          console.error(`[ci] version.json backfill failed for ${repo} (${siteUrl}):`, err.message);
          versionErrors.set(repo, err.message);
        }
      });

      await Promise.all([...packageFetches, ...releaseFetches, ...siteFetches]);

      // Extract Go dependencies from go.mod at the latest release tag
      const goDepFetches = Object.entries(GO_DEPS).map(async ([repo, deps]) => {
        const ver = versions.get(repo);
        if (!ver) return;
        try {
          await extractGoModVersions(repo, ver.version, deps);
        } catch (err) {
          console.error(`[ci] go.mod backfill failed for ${repo}:`, err.message);
        }
      });
      await Promise.all(goDepFetches);

      console.log(`[ci] Backfilled ${versions.size} published versions, ${deployedVersions.size} deployed versions`);
    })();

    return versionBackfillPromise;
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

        // Extract consumed Go dependencies from go.mod at the release tag
        const deps = GO_DEPS[repository.name];
        if (deps) {
          extractGoModVersions(repository.name, release.tag_name, deps).catch(err =>
            console.error(`[ci] go.mod extraction failed for ${repository.name}:`, err.message)
          );
        }

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

      // Prune runs older than 2 hours, but keep the latest run per repo
      const cutoff = Date.now() - 2 * 60 * 60 * 1000;
      const latestPerRepo = new Map();
      for (const [k, v] of runs) {
        const prev = latestPerRepo.get(v.repoName);
        if (!prev || new Date(v.updatedAt) > new Date(prev.updatedAt)) {
          latestPerRepo.set(v.repoName, { key: k, updatedAt: v.updatedAt });
        }
      }
      for (const [k, v] of runs) {
        if (new Date(v.updatedAt).getTime() < cutoff && latestPerRepo.get(v.repoName)?.key !== k) {
          runs.delete(k);
        }
      }

      broadcast('update', run);

      // When a deploy workflow completes successfully, re-fetch version.json
      if (run.status === 'completed' && run.conclusion === 'success') {
        const siteUrl = SITE_URLS[run.repoName];
        if (siteUrl) {
          fetchSiteVersion(run.repoName, siteUrl).catch(err =>
            console.error(`[ci] version.json refresh failed for ${run.repoName}:`, err.message)
          );
        }
      }

      return res.status(200).json({ received: true, key });
    }

    // Ignore other event types
    return res.status(200).json({ ignored: true, event });
  });

  // ── Published report — source repos report their published route package version ──

  router.post('/published', (req, res) => {
    const { repo, repoName, version } = req.body;
    if (!repoName || !version) {
      return res.status(400).json({ error: 'Missing repoName or version' });
    }

    const published = {
      repo: repo || `nelsong6/${repoName}`,
      repoName,
      version,
      publishedAt: new Date().toISOString(),
      htmlUrl: `https://github.com/nelsong6/${repoName}/packages`,
    };
    packageVersions.set(repoName, published);
    broadcast('packageVersion', published);
    res.status(200).json({ received: true, repoName, version });
  });


  // ── SSE endpoint ──────────────────────────────────────────────

  router.get('/events', async (req, res) => {
    // Backfill on first connection
    await Promise.all([backfillFromGitHub(), backfillVersions()]);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const snapshot = {
      runs: Array.from(runs.values()),
      versions: Array.from(versions.values()),
      packageVersions: Array.from(packageVersions.values()),
      deployed: Array.from(deployedVersions.values()),
      versionErrors: Object.fromEntries(versionErrors),
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
      releases: Array.from(versions.values()),
      packages: Array.from(packageVersions.values()),
      deployed: Array.from(deployedVersions.values()),
    });
  });

  return router;
}
