import axios from 'axios';
import { DbService } from './db.service';

export class WebhookService {
  private cloudUrl: string;
  private apiKey: string;
  private db: DbService;

  constructor(cloudUrl: string, apiKey: string, db: DbService) {
    this.cloudUrl = cloudUrl;
    this.apiKey = apiKey;
    this.db = db;
  }

  async reportStatus(jobId: string, status: string, errorMessage?: string): Promise<void> {
    const payload: Record<string, any> = { status };
    if (errorMessage) payload.errorMessage = errorMessage;
    if (status === 'DONE') payload.printedAt = new Date().toISOString();

    try {
      // `/agent/print/...`, not `/badges/print/...`. The old path matched no
      // route at all - the only one shaped like it lives under
      // `events/:eventId/badges/...`, and it requires a manager's JWT, which
      // a headless agent does not have. So every status report 404'd, jobs
      // stayed PRINTING in the cloud forever, and each failure was re-queued
      // into SQLite to be retried every 30 seconds indefinitely.
      await axios.patch(`${this.cloudUrl}/api/v1/agent/print/jobs/${jobId}/status`, payload, {
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });
    } catch {
      // Cloud unreachable - queue for retry
      console.warn(`Webhook failed for job ${jobId}, queuing for retry`);
      this.db.savePendingWebhook(jobId, status, errorMessage);
    }
  }

  async flushPendingWebhooks(): Promise<void> {
    const pending = this.db.getPendingWebhooks();
    if (pending.length === 0) return;

    console.log(`Flushing ${pending.length} pending webhooks...`);
    for (const webhook of pending) {
      try {
        await axios.patch(
          `${this.cloudUrl}/api/v1/badges/print/jobs/${webhook.jobId}/status`,
          {
            status: webhook.status,
            errorMessage: webhook.errorMessage,
            printedAt: webhook.status === 'DONE' ? webhook.createdAt : undefined,
          },
          {
            headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
            timeout: 5000,
          },
        );
        this.db.deletePendingWebhook(webhook.id);
      } catch {
        break; // Still offline, stop trying
      }
    }
  }
}
