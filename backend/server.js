import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCIRoutes } from './routes/index.js';
import { fetchConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend', 'dist');

const app = express();
const PORT = process.env.PORT || 3000;
let serverReady = false;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
// GitHub webhook HMAC verification needs the raw body, so capture it
// alongside express.json's parse.
app.use(express.json({ limit: '10mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(morgan('combined'));

app.use((req, res, next) => {
  if (serverReady || req.path === '/health') return next();
  res.status(503).json({ error: 'Starting' });
});

app.get('/health', (req, res) => {
  if (!serverReady) return res.status(503).json({ status: 'starting' });
  res.json({ status: 'healthy' });
});

async function start() {
  const config = await fetchConfig();

  // CI routes handle /webhook, /events (SSE), /status, /versions, etc.
  // Mount at /ci so the public paths are /ci/webhook, /ci/events, ...
  app.use('/ci', createCIRoutes({
    webhookSecret: config.githubWebhookSecret,
    githubAppId: config.githubAppId,
    githubAppPrivateKey: config.githubAppPrivateKey,
  }));

  app.use(express.static(FRONTEND_DIR));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });

  serverReady = true;
  console.log(`[diagrams] ready on port ${PORT}`);
}

app.listen(PORT, () => {
  start().catch((err) => {
    console.error('[diagrams] fatal startup error:', err);
    process.exit(1);
  });
});

export default app;
