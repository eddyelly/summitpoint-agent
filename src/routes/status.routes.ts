import { Router } from 'express';
import type { QueueService } from '../services/queue.service';
import type { HpPrinterService } from '../services/hp-printer.service';
import type { HoneywellPrinterService } from '../services/honeywell-printer.service';
import { config } from '../config';

const startTime = Date.now();

export function statusRoutes(
  queue: QueueService,
  hpPrinter: HpPrinterService,
  honeywellPrinter: HoneywellPrinterService,
): Router {
  const router = Router();

  // Health check
  router.get('/health', (_req, res) => {
    const timeoutFalse = (ms: number) => new Promise<boolean>((r) => setTimeout(() => r(false), ms));
    Promise.all([
      Promise.race([hpPrinter.checkStatus(), timeoutFalse(2500)]),
      Promise.race([honeywellPrinter.checkStatus(), timeoutFalse(1000)]),
    ])
      .then(([hpConnected, honeywellConnected]) => {
        const stats = queue.getStats();
        res.json({
          status: 'ok',
          uptime: Math.floor((Date.now() - startTime) / 1000),
          printers: {
            hp: {
              connected: hpConnected,
              name: config.hpPrinterName,
              url: config.hpPrinterUrl,
            },
            honeywell: {
              connected: honeywellConnected,
              type: 'USB',
              devicePath: config.honeywellDevicePath || 'auto-detect',
            },
          },
          queue: stats,
        });
      })
      .catch(() => {
        res.json({ status: 'ok', printers: { hp: { connected: false }, honeywell: { connected: false } }, queue: queue.getStats() });
      });
  });

  // List jobs
  router.get('/jobs', (req, res) => {
    const status = req.query.status as string | undefined;
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    const result = queue.getJobs({ status, limit, offset });
    const stats = queue.getStats();

    res.json({
      ...result,
      pending: stats.pending,
      processing: stats.processing,
      completed: stats.completed,
      failed: stats.failed,
    });
  });

  // Delete single job
  router.delete('/jobs/:jobId', (req, res) => {
    queue.deleteJob(req.params.jobId);
    res.json({ success: true });
  });

  // Single job status
  router.get('/jobs/:jobId', (req, res) => {
    const allJobs = queue.getJobs({ limit: 10000 });
    const job = allJobs.jobs.find((j) => j.jobId === req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(job);
  });

  // Retry failed job
  router.post('/jobs/:jobId/retry', (req, res) => {
    const success = queue.retryJob(req.params.jobId);
    if (!success) {
      res.status(400).json({ error: 'Job not found or not in FAILED status' });
      return;
    }
    res.json({ success: true, message: 'Job re-queued. Re-send the print payload from cloud.' });
  });

  // Clear completed jobs
  router.delete('/jobs/clear', (_req, res) => {
    queue.clearCompleted();
    res.json({ success: true, message: 'Completed jobs cleared' });
  });

  return router;
}
