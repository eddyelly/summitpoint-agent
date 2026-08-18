import { Router } from 'express';
import type { QueueService } from '../services/queue.service';
import type { SinglePrintRequest, BulkPrintRequest } from '../types/index';

export function printRoutes(queue: QueueService): Router {
  const router = Router();

  // Single badge print (gate registration - high priority)
  router.post('/print/badge', async (req, res) => {
    try {
      const body = req.body as SinglePrintRequest;

      if (!body.jobId || !body.attendeeName || !body.qrCodeValue || !body.template) {
        res.status(400).json({ success: false, error: 'Missing required fields' });
        return;
      }

      const queuePosition = await queue.addGateJob({
        jobId: body.jobId,
        attendeeName: body.attendeeName,
        qrCodeValue: body.qrCodeValue,
        printerType: body.printerType || 'HP',
        serialNumber: body.serialNumber,
        template: body.template,
        priority: 10,
      });

      res.json({
        success: true,
        jobId: body.jobId,
        status: 'QUEUED',
        queuePosition,
      });
    } catch (err: any) {
      console.error('[Print] Error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Bulk badge print
  router.post('/print/bulk', async (req, res) => {
    try {
      const body = req.body as BulkPrintRequest;

      if (!body.jobs || !Array.isArray(body.jobs) || body.jobs.length === 0 || !body.template) {
        res.status(400).json({ success: false, error: 'Missing jobs array or template' });
        return;
      }

      const jobs = body.jobs.map((j) => ({
        jobId: j.jobId,
        attendeeName: j.attendeeName,
        qrCodeValue: j.qrCodeValue,
        printerType: body.printerType || ('HP' as const),
        serialNumber: j.serialNumber,
        template: body.template,
        priority: 1,
      }));

      await queue.addBulkJobs(jobs);

      res.json({
        success: true,
        totalJobs: jobs.length,
        status: 'QUEUED',
        message: `${jobs.length} jobs queued for printing`,
      });
    } catch (err: any) {
      console.error('[Bulk] Error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
