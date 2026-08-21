import 'dotenv/config';
import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { DbService } from './services/db.service';
import { HpPrinterService } from './services/hp-printer.service';
import { HoneywellPrinterService } from './services/honeywell-printer.service';
import { warmPrinterCache } from './services/windows-raw-print';
import { WebhookService } from './services/webhook.service';
import { QueueService } from './services/queue.service';
import { printRoutes } from './routes/print.routes';
import { statusRoutes } from './routes/status.routes';
import { adminRoutes } from './routes/admin.routes';

// Ensure data directory exists
const dataDir = path.dirname(config.sqlitePath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const app = express();
app.use(express.json({ limit: '50mb' }));

// ─── Auth middleware ────────────────────────────────────────────
app.use((req, res, next) => {
  // Skip auth for admin UI and health check
  if (
    req.path === '/admin' ||
    req.path.startsWith('/admin/') ||
    req.path === '/health' ||
    req.path.startsWith('/jobs')
  ) {
    return next();
  }

  // Allow localhost requests without API key (admin dashboard)
  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const referer = req.headers.referer || '';
  if (isLocal && referer.includes('/admin')) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== config.apiKey) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  next();
});

// ─── Initialize services ───────────────────────────────────────
const db = new DbService(config.sqlitePath);
const hpPrinter = new HpPrinterService(config.hpPrinterUrl);
const honeywellPrinter = new HoneywellPrinterService(config.honeywellDevicePath || undefined);
const webhook = new WebhookService(config.cloudApiUrl, config.cloudApiKey, db);

// Populate the Windows printer list once at boot. `/health` races the
// Honeywell status check against a one-second timeout, and a cold PowerShell
// spawn loses that race - so without this the first health poll would report
// a healthy printer as disconnected. No-op off Windows.
warmPrinterCache();
const queue = new QueueService(hpPrinter, honeywellPrinter, webhook, db);

// ─── Flush pending webhooks every 30 seconds ───────────────────
setInterval(() => webhook.flushPendingWebhooks(), 30000);

// ─── Simple test route ─────────────────────────────────────────
app.get('/ping', (_req, res) => {
  res.json({ pong: true });
});

// ─── Routes ────────────────────────────────────────────────────
app.use(printRoutes(queue));
app.use(statusRoutes(queue, hpPrinter, honeywellPrinter));
app.use(adminRoutes());

// ─── Start ─────────────────────────────────────────────────────
app.listen(config.port, '0.0.0.0', () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   SummitPoint Print Agent                 ║
  ║   Running on http://0.0.0.0:${config.port}        ║
  ║   Admin UI: http://localhost:${config.port}/admin  ║
  ╚═══════════════════════════════════════════╝
  `);
});
