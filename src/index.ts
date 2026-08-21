import 'dotenv/config';
import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { DbService } from './services/db.service';
import { HpPrinterService } from './services/hp-printer.service';
import { HoneywellPrinterService } from './services/honeywell-printer.service';
import { warmPrinterCache } from './services/windows-raw-print';
import { JobPoller } from './services/job-poller';
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
/**
 * Headers a reverse proxy adds. Their presence is the tell that a request
 * did NOT originate at this machine, however local the socket looks.
 *
 * This matters because the agent is meant to sit behind a tunnel
 * (cloudflared/ngrok) so the cloud can reach it. The tunnel client runs ON
 * this PC and connects to localhost, so EVERY request arriving from the
 * internet has `req.ip === '127.0.0.1'`. A naive localhost check would hand
 * the whole API to the internet the moment the tunnel came up.
 */
const PROXY_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'forwarded',
  'x-forwarded-host',
];

/**
 * A request genuinely made from this machine - someone sitting at the venue
 * PC with the admin dashboard open - rather than one relayed through a tunnel.
 */
function isTrulyLocal(req: express.Request): boolean {
  if (PROXY_HEADERS.some((h) => req.headers[h])) return false;
  const ip = req.ip || req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

app.use((req, res, next) => {
  // Liveness only. Deliberately open so a tunnel or uptime monitor can probe
  // the agent without holding the key; it exposes printer names and queue
  // counts, never attendee data.
  if (req.path === '/health') return next();

  // The admin dashboard, for whoever is physically at this PC. No key needed
  // there because possession of the machine already outranks it.
  //
  // What used to be here was `isLocal && referer.includes('/admin')`, which
  // was no protection at all: `Referer` is set by the caller, and behind a
  // tunnel `isLocal` is true for the entire internet. Together they meant
  // anyone who found the URL could POST /print/badge - arbitrary badges with
  // arbitrary QR codes, at an event where that QR is what opens the door.
  if (isTrulyLocal(req)) return next();

  // Everything else needs the key - including /jobs and /admin. The old
  // `startsWith('/jobs')` skip ignored the HTTP METHOD, so it exempted
  // `DELETE /jobs/:id` and `POST /jobs/clear` as well as reading a queue that
  // carries attendee names, emails and QR values.
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

// Pull jobs from the cloud rather than waiting to be pushed to. A registration
// desk sits behind NAT on venue wifi, so the cloud cannot open a connection to
// it without a tunnel - but the agent can always reach out.
const jobPoller = new JobPoller(
  config.cloudApiUrl,
  config.cloudApiKey,
  queue,
  config.pollIntervalMs,
);
jobPoller.start();

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
