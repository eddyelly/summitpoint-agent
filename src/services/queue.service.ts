import BetterQueue from 'better-queue';
import SqliteStore from 'better-queue-sqlite';
import { generateBadgePdf } from './badge-generator';
import { generateZplLabel } from './zpl-generator';
import { HpPrinterService } from './hp-printer.service';
import { HoneywellPrinterService } from './honeywell-printer.service';
import { WebhookService } from './webhook.service';
import { DbService } from './db.service';
import type { PrintJob } from '../types/index';
import { config } from '../config';

export class QueueService {
  private queue: BetterQueue;
  private hpPrinter: HpPrinterService;
  private honeywellPrinter: HoneywellPrinterService;
  private webhook: WebhookService;
  private db: DbService;

  constructor(
    hpPrinter: HpPrinterService,
    honeywellPrinter: HoneywellPrinterService,
    webhook: WebhookService,
    db: DbService,
  ) {
    this.hpPrinter = hpPrinter;
    this.honeywellPrinter = honeywellPrinter;
    this.webhook = webhook;
    this.db = db;

    this.queue = new BetterQueue(
      async (job: PrintJob, cb: (err: Error | null, result?: any) => void) => {
        try {
          await this.processJob(job);
          cb(null, { success: true });
        } catch (err: any) {
          cb(err);
        }
      },
      {
        concurrent: config.queueConcurrency,
        store: new SqliteStore({
          path: config.sqlitePath.replace('.db', '-queue.db'),
        }) as any,
        priority: (job: PrintJob, cb: (err: null, priority: number) => void) => {
          cb(null, job.priority || 1);
        },
        retryDelay: 5000,
        maxRetries: 3,
      },
    );

    this.queue.on('task_finish', (taskId: string) => {
      console.log(`[Queue] Job ${taskId} completed`);
    });

    this.queue.on('task_failed', (taskId: string, err: any) => {
      console.error(`[Queue] Job ${taskId} failed:`, err?.message);
    });
  }

  async addJob(job: PrintJob): Promise<number> {
    this.db.saveJob({
      jobId: job.jobId,
      attendeeName: job.attendeeName,
      printerType: job.printerType,
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
    });

    this.webhook.reportStatus(job.jobId, 'QUEUED').catch(() => {});
    this.queue.push(job);

    return this.db.getStats().pending;
  }

  async addGateJob(job: PrintJob): Promise<number> {
    return this.addJob({ ...job, priority: 10 });
  }

  async addBulkJobs(jobs: PrintJob[]): Promise<void> {
    for (const job of jobs) {
      await this.addJob({ ...job, priority: 1 });
    }
  }

  private async processJob(job: PrintJob): Promise<void> {
    this.db.updateJobStatus(job.jobId, 'PRINTING');
    this.webhook.reportStatus(job.jobId, 'PRINTING').catch(() => {});

    let result: { success: boolean; error?: string };

    if (job.printerType === 'HP') {
      const pdfBuffer = await generateBadgePdf({
        attendeeName: job.attendeeName,
        qrCodeValue: job.qrCodeValue,
        serialNumber: job.serialNumber,
        template: job.template,
      });
      result = await this.hpPrinter.print(pdfBuffer, `badge-${job.attendeeName}`);
    } else {
      const zpl = generateZplLabel({
        attendeeName: job.attendeeName,
        qrCodeValue: job.qrCodeValue,
        serialNumber: job.serialNumber,
        organization: job.organization,
        template: job.template,
      });
      result = await this.honeywellPrinter.print(zpl);
    }

    if (result.success) {
      this.db.updateJobStatus(job.jobId, 'DONE', new Date().toISOString());
      this.webhook.reportStatus(job.jobId, 'DONE').catch(() => {});
    } else {
      this.db.updateJobStatus(job.jobId, 'FAILED', undefined, result.error);
      this.webhook.reportStatus(job.jobId, 'FAILED', result.error).catch(() => {});
      throw new Error(result.error);
    }
  }

  retryJob(jobId: string): boolean {
    const job = this.db.getJob(jobId);
    if (!job || job.status !== 'FAILED') return false;
    this.db.updateJobStatus(jobId, 'QUEUED');
    // Re-queue — note: we don't have the full template data in SQLite, so
    // the cloud should re-send the job via POST /print/badge for retries
    return true;
  }

  deleteJob(jobId: string) {
    this.db.deleteJob(jobId);
  }

  getStats() {
    return this.db.getStats();
  }

  getJobs(filter?: { status?: string; limit?: number; offset?: number }) {
    return this.db.getJobs(filter);
  }

  clearCompleted() {
    this.db.clearCompleted();
  }
}
